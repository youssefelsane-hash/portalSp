// أدوات مشتركة لاختبارات `test_live/` — سبب وجودها إن كل ملف كان بيكرّر قراءة الـOTP من مسار
// لوج **مكتوب بالإيد** لسيشن قديمة بعينها، فأي سيشن جديدة كانت بتلاقي الاختبارات دي بتفشل على
// `FileSystemException` مالهاش أي علاقة بالكود المختبَر. الملف ده بيدوّر على اللوج في المسارات
// المعروفة وبيقبل تجاوز صريح بـ`--dart-define=API_LOG_PATH=...`.
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'dart:math';

import 'package:customer_app/core/api_client.dart';

const _explicitLogPath = String.fromEnvironment('API_LOG_PATH');

const _knownApiLogPaths = <String>[
  // `apps/api/.dev-logs/api.out` هو المسار اللي `npm run start:dev` بيكتب فيه في البيئة دي،
  // فهو الأرجح وجودًا — لازم يتجرّب قبل المسارات القديمة.
  '/home/user/portalSp/apps/api/.dev-logs/api.out',
  '/tmp/claude-0/api.log',
  '/home/user/portalSp/.dev-logs/api.log',
];

/// ملف لوج الباك-إند الحالي، أو `null` لو مفيش. عام عمدًا: كل ملفات `test_live/` بتستعمله بدل
/// ما كل واحد يكتب مسار بإيده (المسارات المكتوبة بالإيد بتموت مع السيشن اللي اتكتبت فيها).
File? resolveApiLogFile() {
  final candidates = <String>[if (_explicitLogPath.isNotEmpty) _explicitLogPath, ..._knownApiLogPaths];
  for (final path in candidates) {
    final file = File(path);
    if (file.existsSync()) return file;
  }
  // آخر محاولة: أي لوج جوّه scratchpad السيشن الحالية (`.log` أو `.out`).
  final scratch = Directory('/tmp/claude-0');
  if (scratch.existsSync()) {
    final logs = scratch
        .listSync(recursive: true, followLinks: false)
        .whereType<File>()
        .where((f) => f.path.endsWith('.log') || f.path.endsWith('.out'))
        .toList()
      ..sort((a, b) => b.statSync().modified.compareTo(a.statSync().modified));
    if (logs.isNotEmpty) return logs.first;
  }
  return null;
}

/// آخر كود OTP اتطبع للرقم ده في لوج الباك-إند (وضع التطوير بس — الإنتاج مابيطبعهوش).
///
/// **بيقرا الذيل بس (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: النسخة القديمة كانت بتعمل
/// `readAsLines()` على الملف كله. لوج تطوير بيوصل لمئات الميجابايت بعد ساعات تشغيل (وأكتر
/// بكتير قبل إصلاح فيضان أخطاء الـworker)، فكل نداء OTP كان بيحمّل الملف كله في الذاكرة —
/// بطء شديد، وفي النهاية الاختبار بيموت برسالة **مضلّلة تمامًا**: «تعذر الاتصال بالخادم»
/// رغم إن السيرفر شغّال ١٠٠٪. الكود موجود في آخر الملف بحكم التعريف، فقراءة آخر ٢ ميجا كافية.
Future<String> latestOtpFor(String phoneNumber) async {
  final log = resolveApiLogFile();
  if (log == null) {
    throw StateError(
      'مالقيتش لوج الباك-إند. شغّل الـAPI وخلّي مخرجاته في apps/api/.dev-logs/api.out '
      'أو مرّر --dart-define=API_LOG_PATH=/path/to/api.log',
    );
  }
  const tailBytes = 2 * 1024 * 1024;
  final length = await log.length();
  final start = length > tailBytes ? length - tailBytes : 0;
  final bytes = await (log.openRead(start)).expand((chunk) => chunk).toList();
  final text = utf8.decode(bytes, allowMalformed: true);
  final matches = LineSplitter.split(text).where((line) => line.contains('[OTP]') && line.contains(phoneNumber));
  if (matches.isEmpty) {
    throw StateError('مالقيتش أي OTP للرقم $phoneNumber في آخر ٢ ميجا من ${log.path}');
  }
  return matches.last.split('→').last.trim();
}

/// رقم موبايل فريد لكل تشغيلة — الأرقام المشتركة بتخلّي تشغيلتين متوازيتين تتعاركوا على نفس الحساب.
///
/// **البَقّة اللي اتصلحت هنا (تدقيق ماراثوني 2026-09-13، docs/08 §148)**: النسخة القديمة كانت
/// `millisecondsSinceEpoch % 100000000` وبتاخد أول ٦ خانات — والخانات دي بتتغيّر مرة كل ١٠٠
/// مللي تقريبًا. و`flutter test` بيشغّل ملفات الاختبار **بالتوازي**، فأكتر من ملف بيبدأ في نفس
/// النافذة بيولّدوا **نفس الرقم**. الـthrottle بيتعقّب بالرقم (`IdentityThrottlerGuard`) بسقف
/// ٥ طلبات OTP في الدقيقة، فالأرقام المتصادمة كانت بتستهلك حصة بعضها والنتيجة
/// «حاولت كتير في وقت قصير» — ١٨ اختبار من ٢١ بيسقطوا لسبب مالوش علاقة بالكود المختبَر.
///
/// دلوقتي: عشوائي آمن + خلط بالميكروثانية، فالتصادم بين ملفين متوازيين عمليًا مستحيل.
String uniquePhone([int seq = 0]) {
  final micros = DateTime.now().microsecondsSinceEpoch;
  final mixed = (_phoneRandom.nextInt(1000000) ^ (micros & 0xFFFFF)) % 1000000;
  return '+2011${mixed.toString().padLeft(6, '0')}${seq.toString().padLeft(2, '0')}';
}

final Random _phoneRandom = Random.secure();

/// **موعد صالح للحجز** — لازم يتبعت مع أي طلب لخدمة بدقة «يوم + ساعة وصول».
///
/// ### ليه موجود
///
/// migration 0340 (2026-09-15) خلّى `requires_start_time_only = true` هو الافتراضي لكل خدمات
/// الكتالوج. من اللحظة دي، أي إنشاء طلب بلا `scheduled_at` بيترفض بـ«لازم تحدد معاد بداية
/// الخدمة دي» — و**١٣ ملف اختبار حي** كانوا بيسقطوا على ده، كلهم مكتوبين قبل المايجريشن ومفترضين
/// السلوك القديم (يوم كامل بلا ساعة). السقوط مكانش ليه أي علاقة باللي بيقيسوه.
///
/// ### ليه القيمة دي بالتحديد
///
/// تلات قيود حقيقية في الباك-إند لازم تتحقق مع بعض:
///
/// 1. **نافذة الأيام** (`bookingDateWindowViolation`): اليوم لازم مايكونش فات، وفي حدود
///    `orders.max_advance_booking_days`. يومين قدام في النص تمامًا.
/// 2. **نافذة ساعات الحجز** (`isWithinBookingWindow`): ٥ص–٧م بتوقيت القاهرة.
/// 3. **التوقيت الصيفي**: القاهرة +٢ أو +٣ حسب الشهر، ومفيش مكتبة توقيتات في الاختبارات دي.
///    `08:00 UTC` بتطلع `10:00` أو `11:00` بالقاهرة — **الاتنين** جوّه النافذة، فالقيمة صالحة
///    طول السنة بلا أي حساب مناطق زمنية.
String bookableScheduledAt({int daysAhead = 2}) {
  final now = DateTime.now().toUtc();
  final day = DateTime.utc(now.year, now.month, now.day).add(Duration(days: daysAhead));
  return DateTime.utc(day.year, day.month, day.day, 8).toIso8601String();
}

/// **موعد «نفس اليوم» (طلب مستعجل)** — للاختبارات اللي بتقيس **دورة العرض والقبول**.
///
/// ### ليه لازم يبقى غير `bookableScheduledAt()`
///
/// الباك-إند بيفرّق بين مسارين للتوزيع:
///
///  - **طلب مجدول** (موعد في يوم جاي): `autoConfirmScheduledOrder` بتثبّت **أنسب فني فورًا بلا
///    أي جولة عرض** لو حمله خفيف (`tier == 'LIGHT'`، migration 0351). الطلب عمره ما يظهر في
///    `GET /technician/orders/available` لأي حد.
///  - **طلب نفس اليوم** (`isSameDayUrgent` = تاريخ الموعد = النهارده): بيمشي على **جولات عرض**
///    عادية، والفني بيقبل بنفسه.
///
/// الاختبارات اللي بتقيس القبول والتنفيذ لازم تستخدم الدالة دي. اتلقط بالقياس: طلب مجدول اتثبّت
/// على فني تاني خلال ٠٫٧ ثانية و`available` رجعت فاضية — واللي كان بيبان للمختبِر هو «الطلب مش
/// بيظهر في القايمة» وكأن التوزيع مكسور.
///
/// الساعة ١٠ صباحًا بتوقيت القاهرة تقريبًا (`08:00 UTC` = ١٠ أو ١١ حسب التوقيت الصيفي) — جوّه
/// نافذة الحجز ٥ص–٧م في الحالتين. النافذة بتتفحص على **الوقت المختار** مش على الوقت الحالي،
/// فالقيمة صالحة في أي ساعة الاختبار يتشغّل فيها.
String urgentScheduledAt() {
  final now = DateTime.now().toUtc();
  return DateTime.utc(now.year, now.month, now.day, 8).toIso8601String();
}

/// **رمز الدخول الموحّد لكل الاختبارات الحية** (ADR-0109).
///
/// مش متسلسل ومش كله نفس الرقم عشان يعدّي `isWeakPin` في الباك-إند. ثابت واحد مشترك: كل حساب
/// اختبار بيتعمل برقم فريد (`uniquePhone()`) فالرمز المشترك مالوش أي أثر أمني، وفي المقابل
/// بيخلّي `loginCustomer(phone)` تفضل بنفس التوقيع بالظبط اللي كل الملفات بتنادي بيه.
const String kLiveTestPin = '417253';

/// تسجيل عميل جديد بالكامل عبر مسار رمز الدخول الحقيقي؛ بيرجّع `access_token`.
///
/// **قبل ADR-0109** كان: طلب OTP → استنى ٦٠٠ مللي → اقرا آخر ٢ ميجا من لوج الباك-إند → استخرج
/// الكود → تحقق. أربع نقاط فشل مالهاش أي علاقة بالحاجة المُختبَرة (اللوج مش موجود، مش بيتكتب
/// فيه، الـ٦٠٠ مللي مش كفاية، حصة الـthrottle خلصت). دلوقتي نداء واحد بلا لوج وبلا انتظار.
Future<String> registerCustomer(String phoneNumber, {String fullName = 'عميل اختبار حي'}) async {
  final tokens = await apiRequest('POST', '/auth/pin/register', body: {
    'phone_number': phoneNumber,
    'pin': kLiveTestPin,
    'full_name': fullName,
    'user_type': 'customer',
  });
  return tokens!['access_token'] as String;
}

/// تسجيل دخول لحساب موجود بالفعل.
Future<String> loginCustomer(String phoneNumber, {String pin = kLiveTestPin}) async {
  final tokens = await apiRequest('POST', '/auth/pin/login', body: {
    'phone_number': phoneNumber,
    'pin': pin,
  });
  return tokens!['access_token'] as String;
}

/// توكن أدمن للتطوير — موقّع محليًا بـ`JWT_ACCESS_SECRET` بتاع `apps/api/.env`.
///
/// **ليه لازم (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: MFA بقى **إجباري** لأي حساب
/// High-Privilege (ADR-0011)، فـ`POST /auth/otp/verify` لأدمن بيرجّع `{mfa_required: true}`
/// من غير `access_token` خالص. كل اختبار حي كان بيسجّل دخول أدمن بالـOTP بقى بيقع على
/// `type 'Null' is not a subtype of type 'String'` — سقوط سببه تغيير أمني **مقصود ومطلوب**،
/// مش بَقّة. المسار ده **مابيتجاوزش** الحارس الأمني ولا بيلمس دورة الـOTP: هو بس بيوقّع توكن
/// تطوير محليًا بنفس طريقة `apps/admin/test/operations-center.e2e.mjs` المعتمدة، ومش هيشتغل
/// خالص من غير الوصول للسر المحلي (يعني مالوش أي معنى خارج جهاز التطوير).
Future<String> devAdminToken(String phoneNumber) => _devTokenFor(phoneNumber, 'admin');

/// نفس الفكرة لحساب فني — بس السبب هنا **مش** MFA: الفنيين مش high-privilege فمسار الدخول
/// العادي بيشتغل معاهم. السبب إن تمن ملفات اختبار بتسجّل دخول بنفس رقم الفني، والـthrottle
/// بيتعقّب بالرقم ⇒ «حاولت كتير في وقت قصير». الملفات اللي **مسار الدخول نفسه** هو المُختبَر
/// فيها بتفضل على المسار الحقيقي عمدًا.
Future<String> devTechnicianToken(String phoneNumber) => _devTokenFor(phoneNumber, 'technician');

Future<String> _devTokenFor(String phoneNumber, String userType) async {
  final env = _readApiEnv();
  final secret = Platform.environment['JWT_ACCESS_SECRET'] ?? env['JWT_ACCESS_SECRET'];
  if (secret == null || secret.isEmpty) {
    throw StateError('JWT_ACCESS_SECRET مش موجود في apps/api/.env');
  }
  // مفيش قيمة افتراضية مكتوبة هنا عمدًا: أي رابط قاعدة بيانات مكتوب في كود Dart بيعدّي فحص
  // الأسرار (`scripts/security-audit.js` ز-٣) وبيبقى سابقة غلط. القيمة بتتقرا من `apps/api/.env`
  // بس، والغياب بيفشل بصوت عالي.
  final databaseUrl = env['DATABASE_URL'];
  if (databaseUrl == null || databaseUrl.isEmpty) {
    throw StateError('DATABASE_URL مش موجود في apps/api/.env');
  }
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc',
     "SELECT id FROM users WHERE phone_number='$phoneNumber' AND deleted_at IS NULL LIMIT 1"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  final userId = (result.stdout as String).trim().split('\n').first.trim();
  if (userId.isEmpty) {
    throw StateError('مفيش مستخدم بالرقم $phoneNumber — شغّل scripts/seed-dev-accounts.js');
  }
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return _signHs256(
    {'sub': userId, 'userType': userType, 'amr': ['otp'], 'iat': now, 'exp': now + 3600},
    secret,
  );
}

Map<String, String> _readApiEnv() {
  for (final path in const ['/home/user/portalSp/apps/api/.env', 'apps/api/.env', '../api/.env']) {
    final file = File(path);
    if (!file.existsSync()) continue;
    final pairs = <String, String>{};
    for (final line in file.readAsLinesSync()) {
      final match = RegExp(r'^([A-Z0-9_]+)=(.*)$').firstMatch(line.trim());
      if (match != null) pairs[match.group(1)!] = match.group(2)!;
    }
    return pairs;
  }
  return const {};
}

String _b64url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

String _signHs256(Map<String, dynamic> payload, String secret) {
  final header = _b64url(utf8.encode(jsonEncode({'alg': 'HS256', 'typ': 'JWT'})));
  final body = _b64url(utf8.encode(jsonEncode(payload)));
  final signature = Hmac(sha256, utf8.encode(secret)).convert(utf8.encode('$header.$body'));
  return '$header.$body.${_b64url(signature.bytes)}';
}

/// عنوان صالح للعميل صاحب التوكن ده — بيرجّع أول عنوان موجود، وبيعمل واحد لو مفيش.
///
/// **ليه موجود (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: إحدى عشر ملف اختبار كانوا بيحطّوا
/// **UUID عنوان مكتوب بالإيد** (`019fde0d-…`) اتعمل في سيشن قديمة. أي قاعدة تطوير نضيفة بترد
/// «العنوان غير موجود» — نفس فئة العطب بتاعة مسار اللوج المكتوب بالإيد. العنوان دلوقتي بيتعمل
/// من أول مدينة/منطقة **حقيقية** راجعة من الـAPI، فبيفضل صالح مهما اتغيّرت البيانات.
Future<String> ensureAddressFor(String accessToken) async {
  final existing = await apiRequestList('/addresses', accessToken: accessToken);
  if (existing.isNotEmpty) return existing.first['id'] as String;

  final cities = await apiRequestList('/cities');
  if (cities.isEmpty) {
    throw StateError('مفيش ولا مدينة قابلة للحجز — شغّل scripts/seed-dev-geo.js');
  }
  final cityId = cities.first['id'] as String;
  final areas = await apiRequestList('/cities/$cityId/areas');
  if (areas.isEmpty) {
    throw StateError('المدينة $cityId مفيهاش مناطق مُطلَقة — شغّل scripts/seed-dev-geo.js');
  }
  final address = await apiRequest('POST', '/addresses', accessToken: accessToken, body: {
    'city_id': cityId,
    'area_id': areas.first['id'],
    'street_name': 'شارع اختبار حي',
    'building_number': '1',
    'latitude': 30.0444,
    'longitude': 31.2357,
    'label': 'اختبار حي',
  });
  return address!['id'] as String;
}

/// أول خدمة حقيقية قابلة للحجز **بلا أي مدخلات إضافية** من الكتالوج الحي.
///
/// **ليه موجود (تدقيق ماراثوني 2026-09-14، §148)**: عشر ملفات كانت بتحط **UUID خدمة مكتوب
/// بالإيد** (`019fde0d-07ca-…`) اتعمل في سيشن قديمة — نفس فئة العطب بتاعة مسار اللوج والعنوان.
///
/// وشرطين مش تفاصيل:
///  • **بلا حقول تسعير إجبارية** — وإلا الطلب بيترفض بـ«الحقل "المساحة" مطلوب».
///  • **دقة الموعد مش `start_time`** — وإلا بيترفض بـ«لازم تحدد معاد بداية الخدمة دي».
/// الاتنين بيخلّوا الاختبار يفشل لسبب مالوش أي علاقة باللي بيختبره، والأسوأ إن النتيجة
/// بتتغيّر حسب ترتيب الكتالوج فبتنجح لوحدها وتفشل في السويتة.
/// `sameDayCapable` بيطلب خدمة بتقبل «نفس اليوم» (`allows_emergency`) — لازم للاختبارات اللي
/// بتقيس دورة العرض والقبول (شوف `urgentScheduledAt`). `scripts/seed-dev-data.js` بيضمن وجود
/// واحدة على الأقل.
Future<String> pickBookableServiceId({
  String? servedByTechnicianToken,
  bool sameDayCapable = false,
}) async {
  final services = await apiRequestList('/services');

  // **الخدمة لازم تكون في قايمة خدمات الفني كمان** (تدقيق 2026-09-25).
  //
  // البَقّة اللي القيد ده اتضاف عشانها: الدالة كانت بترجّع أول خدمة في الكتالوج بلا حقول تسعير
  // إجبارية — و`GET /services` **مش مرتّب بتاريخ الإنشاء**، فأي خدمة اختبار سايبة من أداة تانية
  // (زي `scripts/seed-technician-screens.js` اللي بيعمل خدمة جديدة كل تشغيلة) بتطلع في الأول.
  // النتيجة: الطلب بيتعمل على خدمة الفني المطلوب **مش مؤهّل** ليها، والاختبار بيسقط بـ«الفني غير
  // مؤهل للخدمة أو نطاق الطلب» — سبب مالوش أي علاقة باللي بيتقاس، و**ستة اختبارات** كانوا
  // بيسقطوا عليه.
  //
  // القيد هنا هو العقد الحقيقي للدالة: «خدمة أقدر أكمّل عليها دورة تنفيذ بالفني ده».
  Set<String>? technicianServiceIds;
  if (servedByTechnicianToken != null) {
    final own = await apiRequestList('/technician/services', accessToken: servedByTechnicianToken);
    technicianServiceIds = own.map((e) => (e['service_id'] ?? e['id']) as String).toSet();
  }

  String? fallback;
  for (final service in services) {
    final id = service['id'] as String;
    if (technicianServiceIds != null && !technicianServiceIds.contains(id)) continue;
    final fields = await apiRequestList('/services/$id/pricing-fields');
    if (fields.any((f) => f['is_required'] == true)) continue;
    final detail = await apiRequest('GET', '/services/$id');
    if (detail == null) continue;
    if (sameDayCapable && detail['allows_emergency'] != true) continue;
    fallback ??= id;
    if (detail['schedule_precision'] != 'start_time') return id;
  }
  if (fallback != null) return fallback;
  throw StateError(
    technicianServiceIds == null
        ? 'مفيش خدمة نشطة بلا حقول تسعير إجبارية${sameDayCapable ? ' وبتقبل نفس اليوم' : ''} — شغّل scripts/seed-dev-data.js'
        : 'مفيش خدمة نشطة بلا حقول تسعير إجبارية${sameDayCapable ? ' وبتقبل نفس اليوم' : ''} **والفني ده بيخدمها** — شغّل scripts/seed-dev-data.js وseed-dev-accounts.js',
  );
}

/// أول سبب إلغاء متاح للعميل، أو `null` لو الأدمن مش معرّف أي سبب.
///
/// **ليه لازم (تدقيق §148)**: اختيار سبب الإلغاء بقى **إجباري** لما الأدمن يكون معرّف أسباب
/// (ثغرة حقيقية اتقفلت في §112 — اللي بيدفع الرسوم كان بيقدر يهرب منها بإنه مايختارش سبب).
/// الاختبارات اللي بتلغي بنص حر بس بقت بتترفض بـ«لازم تختار سبب الإلغاء من القايمة».
Future<String?> pickCustomerCancellationReasonId() async {
  final reasons = await apiRequestList('/cancellation-reasons?applies_to=customer');
  if (reasons.isEmpty) return null;
  return reasons.first['id'] as String;
}

/// توكن step-up (تأكيد Passkey حديث) لعمليات الأدمن الحساسة — **صف حقيقي** في
/// `step_up_tokens` بيتستهلك مرة واحدة، زي ما `scripts/lib/live-harness.js` بتعمل بالظبط.
///
/// **ليه لازم (تدقيق §148)**: كتابات الأدمن الحساسة (تعديل إعداد، إنشاء سبب إلغاء) محمية
/// بـ`StepUpGuard`، فبترجّع «العملية دي محتاجة تأكيد Passkey حديث» من غير الهيدر. الاختبار
/// **مابيتجاوزش الحارس**: هو بيعدّي عليه بنفس الآلية اللي الواجهة بتستعملها (توكن مخزّن في
/// القاعدة)، فالحارس فعليًا لسه بيتنفّذ ولسه بيرفض أي نداء بلا توكن.
Future<String> devStepUpToken(String adminPhoneNumber) async {
  final env = _readApiEnv();
  final databaseUrl = env['DATABASE_URL'];
  if (databaseUrl == null || databaseUrl.isEmpty) {
    throw StateError('DATABASE_URL مش موجود في apps/api/.env');
  }
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc',
     "INSERT INTO step_up_tokens (user_id, expires_at) "
     "SELECT id, now() + interval '30 minutes' FROM users "
     "WHERE phone_number='$adminPhoneNumber' AND deleted_at IS NULL LIMIT 1 RETURNING id"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  // **أول سطر بس**: `psql` بيطبع سطر حالة (`INSERT 0 1`) بعد صف الـRETURNING، فـ`.trim()`
  // لوحدها بتسيب «uuid\nINSERT 0 1». القيمة دي بتروح كـheader، وأي سطر جديد جوّه قيمة هيدر
  // بيخلّي عميل HTTP يرمي استثناء — واللي بيوصل للمختبِر رسالة **مضلّلة تمامًا**: «تعذر
  // الاتصال بالخادم» رغم إن السيرفر شغّال (تدقيق §148).
  final token = (result.stdout as String).trim().split('\n').first.trim();
  if (token.isEmpty) {
    throw StateError('مقدرتش أعمل توكن step-up لـ$adminPhoneNumber — شغّل scripts/seed-dev-accounts.js');
  }
  return token;
}

/// الهيدر الجاهز للاستعمال مع `apiRequest(..., extraHeaders: await stepUpHeader(phone))`.
Future<Map<String, String>> stepUpHeader(String adminPhoneNumber) async =>
    {'X-Step-Up-Token': await devStepUpToken(adminPhoneNumber)};

/// بيوصل طلب جديد لحالة `completed` **عبر المسار الحقيقي بالكامل** (فني بيقبل، ينطلق، يوصل،
/// يبدأ، يرفع صورة بعد الشغل، يقفل، يحصّل كاش) وبيرجّع `orderId`.
///
/// **ليه موجود (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: اختبارات زي التقييم كانت بتدوّر
/// على طلب `completed` **موجود أصلاً** لعميل ثابت — يعني بتعتمد على بيانات سيشن قديمة، وفي
/// قاعدة نضيفة بتسقط على «Expected: non-empty» اللي مش بيقول السبب. دلوقتي الاختبار بيجهّز
/// شرطه بنفسه، وبالمناسبة بيغطي دورة التنفيذ كاملة من طرف العميل كمان.
Future<String> completeOrderThroughTechnician(
  String customerToken, {
  String technicianPhone = '+201000000011',
  String problemDescription = 'طلب اختبار حي — دورة تنفيذ كاملة',
}) async {
  // توكن الفني المفضّل **قبل** إنشاء الطلب: اختيار الخدمة محتاجه عشان يتأكد إن الفني ده بيخدمها.
  // `devTechnicianToken` مش `loginWithPin` — توكن موقّع محليًا، فمفيش throttle ولا اعتماد على رمز.
  final preferredTechnicianToken = await devTechnicianToken(technicianPhone);
  final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
    'service_id': await pickBookableServiceId(servedByTechnicianToken: preferredTechnicianToken),
    // ADR-0060 §4 / migration 0340 — كل خدمات الكتالوج بقت بدقة «يوم + ساعة وصول»،
    // فالموعد إجباري. القيمة من `bookableScheduledAt()` — الشرح هناك.
    'scheduled_at': bookableScheduledAt(),
    'address_id': await ensureAddressFor(customerToken),
    // وصف فريد: حارس تكرار الطلب بيرجّع نفس الصف لطلبين متطابقين في نفس النافذة.
    'problem_description': '$problemDescription ${DateTime.now().microsecondsSinceEpoch}',
  });
  final orderId = order!['id'] as String;

  // **التوكن الراجع مش بالضرورة بتاع `technicianPhone`**: لو العرض راح لفني تاني،
  // `claimOrderAsTechnician` بتكمّل بيه وبترجّع توكنه. خطوات التنفيذ لازم تمشي بالتوكن ده.
  final technicianToken = await claimOrderAsTechnician(orderId, technicianPhone);
  for (final step in ['depart', 'arrive', 'start']) {
    await apiRequest('POST', '/technician/orders/$orderId/$step', accessToken: technicianToken);
  }
  await uploadAfterPhotoAs(orderId, technicianToken);
  await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
  await apiRequest('POST', '/technician/orders/$orderId/collect-cash', accessToken: technicianToken);
  return orderId;
}

/// صورة «بعد الشغل» — شرط إجباري قبل `complete` في الباك-إند.
Future<void> uploadAfterPhotoAs(String orderId, String technicianToken) async {
  final fixture = File('test_live/fixtures/test-1x1.png');
  final bytes = fixture.existsSync()
      ? await fixture.readAsBytes()
      : base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
  await apiUpload(
    '/technician/orders/$orderId/media',
    fileBytes: bytes,
    filename: 'after.png',
    fields: {'media_type': 'after_photo'},
    accessToken: technicianToken,
  );
}

/// بيوصل طلب لحالة **قابلة للدفع** (`work_completed` وغير مدفوع) وبيرجّع `orderId`:
/// نفس دورة `completeOrderThroughTechnician` بس **من غير تحصيل كاش**.
Future<String> completeOrderAwaitingPayment(
  String customerToken, {
  String technicianPhone = '+201000000011',
  String problemDescription = 'طلب اختبار حي — بانتظار الدفع',
}) async {
  // توكن الفني المفضّل **قبل** إنشاء الطلب: اختيار الخدمة محتاجه عشان يتأكد إن الفني ده بيخدمها.
  // `devTechnicianToken` مش `loginWithPin` — توكن موقّع محليًا، فمفيش throttle ولا اعتماد على رمز.
  final preferredTechnicianToken = await devTechnicianToken(technicianPhone);
  final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
    'service_id': await pickBookableServiceId(servedByTechnicianToken: preferredTechnicianToken),
    // ADR-0060 §4 / migration 0340 — كل خدمات الكتالوج بقت بدقة «يوم + ساعة وصول»،
    // فالموعد إجباري. القيمة من `bookableScheduledAt()` — الشرح هناك.
    'scheduled_at': bookableScheduledAt(),
    'address_id': await ensureAddressFor(customerToken),
    'problem_description': '$problemDescription ${DateTime.now().microsecondsSinceEpoch}',
  });
  final orderId = order!['id'] as String;

  // **التوكن الراجع مش بالضرورة بتاع `technicianPhone`**: لو العرض راح لفني تاني،
  // `claimOrderAsTechnician` بتكمّل بيه وبترجّع توكنه. خطوات التنفيذ لازم تمشي بالتوكن ده.
  final technicianToken = await claimOrderAsTechnician(orderId, technicianPhone);
  for (final step in ['depart', 'arrive', 'start']) {
    await apiRequest('POST', '/technician/orders/$orderId/$step', accessToken: technicianToken);
  }
  await uploadAfterPhotoAs(orderId, technicianToken);
  await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
  return orderId;
}

/// بيشحن محفظة العميل بمبلغ كافي **عبر SQL مباشر** — مفيش endpoint لشحن محفظة عميل تجريبي،
/// ونفس الطريقة بالظبط اللي `scripts/lib/live-harness.js` بتستعملها (`fundWallet`).
///
/// **مهم**: الشحن ده بيعدّل `balance_cents` من غير قيد في `wallet_transactions` عمدًا — هو
/// **تجهيز بيئة** مش عملية مالية، والتدقيقات المالية بتقيس القيود اللي بتتولّد من المسارات
/// الحقيقية بعد كده. في بيئة تطوير محلية بس.
Future<void> fundCustomerWallet(String customerToken, int cents) async {
  final me = await apiRequest('GET', '/auth/me', accessToken: customerToken);
  final userId = me!['id'] as String;
  final env = _readApiEnv();
  final databaseUrl = env['DATABASE_URL'];
  if (databaseUrl == null || databaseUrl.isEmpty) {
    throw StateError('DATABASE_URL مش موجود في apps/api/.env');
  }
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc',
     "INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ('$userId','customer',$cents) "
     "ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  if (result.exitCode != 0) {
    throw StateError('مقدرتش أشحن المحفظة: ${result.stderr}');
  }
}

/// توكن تطوير لفني **بمعرّف البروفايل** (مش بالموبايل) — بيلزم لما المنصّة هي اللي بتختار
/// الفني (توزيع تلقائي) والاختبار محتاج يكمّل بنفس اللي اتعيّن فعلاً.
Future<String> devTokenForTechnicianProfile(String technicianProfileId) async {
  final env = _readApiEnv();
  final databaseUrl = env['DATABASE_URL'];
  if (databaseUrl == null || databaseUrl.isEmpty) {
    throw StateError('DATABASE_URL مش موجود في apps/api/.env');
  }
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc',
     "SELECT u.phone_number FROM technician_profiles tp JOIN users u ON u.id = tp.user_id "
     "WHERE tp.id = '$technicianProfileId' LIMIT 1"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  final phone = (result.stdout as String).trim().split('\n').first.trim();
  if (phone.isEmpty) throw StateError('مالقيتش فني بالمعرّف $technicianProfileId');
  return devTechnicianToken(phone);
}

/// بيرجّع توكن **الفني اللي العرض راح له فعلاً** ويقبل الطلب بيه.
///
/// **ليه (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: الفني مايقدرش يقبل طلب إلا لو **العرض
/// اتبعتله هو** في جولة توزيع (`order_assignments`)، والمنصّة هي اللي بتختار مين. الاختبارات
/// كانت بتفترض إن الفني بتاعها هو اللي هياخد العرض — وده بيحصل لما الفنيين المتاحين قليلين،
/// فكانت تنجح لوحدها وتفشل جوّه السويتة الكاملة بـ«العرض ده مبقاش متاح». الفشل ده **توقيت
/// وتوزيع**، مش كود مكسور. الحل: الاختبار بيسأل مين ماسك العرض دلوقتي ويكمّل بيه — بيختبر
/// نفس المسار الحقيقي من غير ما يفترض نتيجة التوزيع.
Future<String> claimOrderAsTechnician(String orderId, String preferredTechnicianPhone) async {
  final preferred = await devTechnicianToken(preferredTechnicianPhone);
  try {
    await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: preferred);
    return preferred;
  } catch (_) {
    // العرض راح لفني تاني — نجيبه من `order_assignments` ونكمّل بيه.
    for (var attempt = 0; attempt < 25; attempt++) {
      final holder = await _technicianHoldingOrder(orderId);
      if (holder != null) {
        final token = await devTokenForTechnicianProfile(holder.profileId);
        if (holder.alreadyAssigned) return token;
        try {
          await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: token);
          return token;
        } catch (_) {
          // جولة جديدة راحت لحد تاني — نعيد السؤال.
        }
      }
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    rethrow;
  }
}

class _OrderHolder {
  _OrderHolder(this.profileId, this.alreadyAssigned);
  final String profileId;
  final bool alreadyAssigned;
}

/// الفني المعيَّن على الطلب، أو صاحب آخر عرض حي عليه.
Future<_OrderHolder?> _technicianHoldingOrder(String orderId) async {
  final rows = await _psql(
    "SELECT COALESCE(o.technician_id::text, '') || '|' || "
    "COALESCE((SELECT a.technician_id::text FROM order_assignments a "
    "          WHERE a.order_id = o.id AND a.assignment_status = 'sent' AND a.expires_at > now() "
    "          ORDER BY a.sent_at DESC LIMIT 1), '') "
    "FROM orders o WHERE o.id = '$orderId'",
  );
  if (rows.isEmpty) return null;
  final parts = rows.first.split('|');
  final assigned = parts.isNotEmpty ? parts[0].trim() : '';
  final offered = parts.length > 1 ? parts[1].trim() : '';
  if (assigned.isNotEmpty) return _OrderHolder(assigned, true);
  if (offered.isNotEmpty) return _OrderHolder(offered, false);
  return null;
}

/// تنفيذ استعلام قراءة على قاعدة التطوير — نفس أسلوب باقي هيلبرز `test_live/`.
Future<List<String>> _psql(String sql) async {
  final env = _readApiEnv();
  final databaseUrl = env['DATABASE_URL'];
  if (databaseUrl == null || databaseUrl.isEmpty) {
    throw StateError('DATABASE_URL مش موجود في apps/api/.env');
  }
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc', sql],
    environment: {'PGPASSWORD': 'baytak'},
  );
  return (result.stdout as String).trim().split('\n').where((line) => line.trim().isNotEmpty).toList();
}


/// محادثة الطلب بعد ما فني يقبله — **بانتظار محدود**، مش نداء واحد.
///
/// **بَقّة اختبار حقيقية اتلقطت تحت حمل كامل (2026-09-25)**: `chat_live_test` و
/// `chat_image_live_test` كانوا بيتأكدوا إن حالة الطلب بقت `accepted` وبعدها **فورًا** بيجيبوا
/// المحادثة. بس المحادثة بيعملها **مستمع حدث** بيتفاعل مع القبول — يعني أثر جانبي
/// eventually-consistent، مش جزء من نفس الـtransaction. القبول بيكون متثبّت في القاعدة والمستمع
/// لسه ما اشتغلش، فالنداء بيرجع `404 «مفيش محادثة للطلب ده لسه»`.
///
/// الملفين كانوا بيعدّوا لوحدهم وبيسقطوا بالتبادل في التشغيلة الكاملة (١٢٣ اختبار) — علامة
/// سباق توقيت، مش كسر حقيقي. نفس النمط المستخدم في `technician_profile_live_test` للتوزيع.
///
/// **ملحوظة للتطبيق نفسه**: نفس الـ404 ممكن يشوفه عميل حقيقي بيدوس على «محادثة» بعد ثانية من
/// ما شاف «اتقبل». الشاشة لازم تتعامل معاه كـ«جاري التحضير» مش كخطأ.
Future<Map<String, dynamic>> waitForOrderChatThread(
  String orderId,
  String accessToken, {
  int attempts = 25,
  Duration interval = const Duration(milliseconds: 400),
}) async {
  Object? lastError;
  for (var attempt = 0; attempt < attempts; attempt++) {
    try {
      final thread = await apiRequest('GET', '/chat/orders/$orderId/thread', accessToken: accessToken);
      if (thread != null) return thread;
    } catch (err) {
      lastError = err;
    }
    await Future<void>.delayed(interval);
  }
  throw StateError('محادثة الطلب $orderId ما اتعملتش خلال ${attempts * interval.inMilliseconds}ms: $lastError');
}
