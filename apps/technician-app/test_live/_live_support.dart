// أدوات مشتركة لاختبارات `test_live/` في تطبيق الفني — النسخة المقابلة لـ
// `apps/customer-app/test_live/_live_support.dart`.
//
// **ليه موجود**: كل ملف اختبار هنا كان بيكرّر قراءة الـOTP من مسار لوج **مكتوب بالإيد** لسيشن
// قديمة بعينها (`/tmp/claude-0/<uuid>/scratchpad/server.log`). المسار ده بيموت مع السيشن، فأي
// سيشن جديدة كانت بتلاقي الاختبارات دي بتفشل على `FileSystemException` مالهاش أي علاقة بالكود
// المختبَر — وده بالظبط اللي حصل في التدقيق الماراثوني (docs/08 §148).
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:technician_app/core/api_client.dart';

const _explicitLogPath = String.fromEnvironment('API_LOG_PATH');

const _knownApiLogPaths = <String>[
  '/home/user/portalSp/apps/api/.dev-logs/api.out',
  '/tmp/claude-0/api.log',
  '/home/user/portalSp/.dev-logs/api.log',
];

/// ملف لوج الباك-إند الحالي، أو `null` لو مفيش.
File? resolveApiLogFile() {
  final candidates = <String>[if (_explicitLogPath.isNotEmpty) _explicitLogPath, ..._knownApiLogPaths];
  for (final path in candidates) {
    final file = File(path);
    if (file.existsSync()) return file;
  }
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

/// نفس الفكرة لحساب فني — بس السبب هنا **مش** MFA: الفنيين مش high-privilege فالـOTP بيشتغل
/// معاهم عادي. السبب إن تمن ملفات اختبار بتسجّل دخول بنفس رقم الفني، والـthrottle بيتعقّب
/// بالرقم (٥ طلبات OTP/دقيقة) ⇒ «حاولت كتير في وقت قصير». الملفات اللي **مسار الـOTP نفسه**
/// هو المُختبَر فيها (زي `technician_orders_live_test.dart`) بتفضل على الـOTP الحقيقي عمدًا.
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
Future<String> pickBookableServiceId() async {
  final services = await apiRequestList('/services');
  String? fallback;
  for (final service in services) {
    final id = service['id'] as String;
    final fields = await apiRequestList('/services/$id/pricing-fields');
    if (fields.any((f) => f['is_required'] == true)) continue;
    final detail = await apiRequest('GET', '/services/$id');
    if (detail == null) continue;
    fallback ??= id;
    if (detail['schedule_precision'] != 'start_time') return id;
  }
  if (fallback != null) return fallback;
  throw StateError('مفيش خدمة نشطة بلا حقول تسعير إجبارية — شغّل بذور الكتالوج الأول');
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

/// رقم موبايل فريد لكل تشغيلة — الأرقام المشتركة بتخلّي ملفين متوازيين يتعاركوا على نفس حصة
/// الـthrottle (٥ طلبات OTP في الدقيقة بالرقم).
String uniquePhone([int seq = 0]) {
  final micros = DateTime.now().microsecondsSinceEpoch;
  final mixed = (_phoneRandom.nextInt(1000000) ^ (micros & 0xFFFFF)) % 1000000;
  return '+2011${mixed.toString().padLeft(6, '0')}${seq.toString().padLeft(2, '0')}';
}

final Random _phoneRandom = Random.secure();

/// تسجيل عميل جديد بالكامل عبر مسار OTP الحقيقي؛ بيرجّع `access_token`.
Future<String> registerCustomer(String phoneNumber, {String fullName = 'عميل اختبار حي'}) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'register'});
  await Future<void>.delayed(const Duration(milliseconds: 600));
  final otp = await latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/register', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
    'full_name': fullName,
    'user_type': 'customer',
  });
  return tokens!['access_token'] as String;
}

/// صورة «بعد الشغل» — شرط إجباري قبل `complete` في الباك-إند («لازم ترفع صورة واحدة على الأقل
/// بعد الشغل قبل ما تقفل الطلب»). اختبارات قديمة كانت بترفعها **بعد** القفل أو ما ترفعهاش
/// خالص، فكانت بتترفض لسبب مالوش علاقة بالمُختبَر (تدقيق §148).
Future<void> uploadAfterPhoto(String orderId, String technicianToken) async {
  final bytes = await File('test_live/fixtures/test-1x1.png').readAsBytes();
  await apiUpload(
    '/technician/orders/$orderId/media',
    fileBytes: bytes,
    filename: 'after.png',
    fields: {'media_type': 'after_photo'},
    accessToken: technicianToken,
  );
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
  final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
    'service_id': await pickBookableServiceId(),
    'address_id': await ensureAddressFor(customerToken),
    // وصف فريد: حارس تكرار الطلب بيرجّع نفس الصف لطلبين متطابقين في نفس النافذة.
    'problem_description': '$problemDescription ${DateTime.now().microsecondsSinceEpoch}',
  });
  final orderId = order!['id'] as String;

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
  final order = await apiRequest('POST', '/orders', accessToken: customerToken, body: {
    'service_id': await pickBookableServiceId(),
    'address_id': await ensureAddressFor(customerToken),
    'problem_description': '$problemDescription ${DateTime.now().microsecondsSinceEpoch}',
  });
  final orderId = order!['id'] as String;

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

/// بيشحن محفظة الفني **عبر SQL مباشر** — تجهيز بيئة، نفس `live-harness.fundWallet` بالظبط.
///
/// **ليه (تدقيق §148)**: رصيد الفني بييجي من طلبات مدفوعة أونلاين، وبناء التاريخ ده جوّه
/// اختبار الصرف بيخلط اختبارين في واحد. تراكم الأرباح نفسه مغطّى في تدقيقات المسارات المالية
/// (`money-paths-audit` ١٣١/١٣١)، واللي بيتختبر هنا هو **مسار الصرف** — فبنجهّز الرصيد صراحةً.
Future<void> fundTechnicianWallet(String technicianToken, int cents) async {
  final me = await apiRequest('GET', '/auth/me', accessToken: technicianToken);
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
     "INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ('$userId','technician',$cents) "
     "ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  if (result.exitCode != 0) throw StateError('مقدرتش أشحن محفظة الفني: ${result.stderr}');
}
