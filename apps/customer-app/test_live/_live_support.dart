// أدوات مشتركة لاختبارات `test_live/` — سبب وجودها إن كل ملف كان بيكرّر قراءة الـOTP من مسار
// لوج **مكتوب بالإيد** لسيشن قديمة بعينها، فأي سيشن جديدة كانت بتلاقي الاختبارات دي بتفشل على
// `FileSystemException` مالهاش أي علاقة بالكود المختبَر. الملف ده بيدوّر على اللوج في المسارات
// المعروفة وبيقبل تجاوز صريح بـ`--dart-define=API_LOG_PATH=...`.
import 'dart:io';

import 'package:customer_app/core/api_client.dart';

const _explicitLogPath = String.fromEnvironment('API_LOG_PATH');

const _knownApiLogPaths = <String>[
  '/tmp/claude-0/api.log',
  '/home/user/portalSp/.dev-logs/api.log',
];

File? _resolveApiLog() {
  final candidates = <String>[if (_explicitLogPath.isNotEmpty) _explicitLogPath, ..._knownApiLogPaths];
  for (final path in candidates) {
    final file = File(path);
    if (file.existsSync()) return file;
  }
  // آخر محاولة: أي `*.log` جوّه scratchpad السيشن الحالية.
  final scratch = Directory('/tmp/claude-0');
  if (scratch.existsSync()) {
    final logs = scratch
        .listSync(recursive: true, followLinks: false)
        .whereType<File>()
        .where((f) => f.path.endsWith('.log'))
        .toList()
      ..sort((a, b) => b.statSync().modified.compareTo(a.statSync().modified));
    if (logs.isNotEmpty) return logs.first;
  }
  return null;
}

/// آخر كود OTP اتطبع للرقم ده في لوج الباك-إند (وضع التطوير بس — الإنتاج مابيطبعهوش).
Future<String> latestOtpFor(String phoneNumber) async {
  final log = _resolveApiLog();
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
String uniquePhone([int seq = 0]) {
  final stamp = DateTime.now().millisecondsSinceEpoch % 100000000;
  return '+2011${stamp.toString().padLeft(8, '0').substring(0, 6)}${seq.toString().padLeft(2, '0')}';
}

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
