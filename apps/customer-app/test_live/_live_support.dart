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
Future<String> latestOtpFor(String phoneNumber) async {
  final log = resolveApiLogFile();
  if (log == null) {
    throw StateError(
      'مالقيتش لوج الباك-إند. شغّل الـAPI وخلّي مخرجاته في /tmp/claude-0/api.log '
      'أو مرّر --dart-define=API_LOG_PATH=/path/to/api.log',
    );
  }
  final lines = await log.readAsLines();
  final matches = lines.where((line) => line.contains('[OTP]') && line.contains(phoneNumber));
  if (matches.isEmpty) {
    throw StateError('مالقيتش أي OTP للرقم $phoneNumber في ${log.path}');
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

/// تسجيل دخول لحساب موجود بالفعل.
Future<String> loginCustomer(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 600));
  final otp = await latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
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
  final databaseUrl = env['DATABASE_URL'] ?? 'postgres://baytak:baytak@localhost:5432/baytak_main';
  final dbName = databaseUrl.split('/').last.split('?').first;
  final result = await Process.run(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', dbName, '-Atc',
     "SELECT id FROM users WHERE phone_number='$phoneNumber' AND deleted_at IS NULL LIMIT 1"],
    environment: {'PGPASSWORD': 'baytak'},
  );
  final userId = (result.stdout as String).trim();
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

/// أول خدمة حقيقية قابلة للحجز **بلا حقول تسعير إجبارية** من الكتالوج الحي.
///
/// **ليه موجود (تدقيق ماراثوني 2026-09-14، §148)**: عشر ملفات كانت بتحط **UUID خدمة مكتوب
/// بالإيد** (`019fde0d-07ca-…`) اتعمل في سيشن قديمة — نفس فئة العطب بتاعة مسار اللوج والعنوان.
///
/// وشرط «بلا حقول إجبارية» مش تفصيلة: أول خدمة في الكتالوج ممكن تكون خدمة formula محتاجة
/// «المساحة»، فالطلب بيترفض بـ«الحقل "المساحة" مطلوب» والاختبار بيفشل لسبب مالوش علاقة بيه.
Future<String> pickBookableServiceId() async {
  final services = await apiRequestList('/services');
  for (final service in services) {
    final id = service['id'] as String;
    final fields = await apiRequestList('/services/$id/pricing-fields');
    if (fields.every((f) => f['is_required'] != true)) return id;
  }
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
