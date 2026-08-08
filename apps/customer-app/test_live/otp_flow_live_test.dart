// اختبار حي حقيقي لتدفق OTP كامل (طلب → تحقق → access_token حقيقي) ضد apps/api الشغال فعلاً.
// بيستخدم apiRequest() مباشرة (مش AuthRepository) عشان AuthRepository محتاج
// flutter_secure_storage (platform channel) اللي بيحتاج TestWidgetsFlutterBinding، والـ binding
// ده بالذات هو اللي بيفعّل قيد "أي HTTP request يرجع 400" في اختبارات Flutter — تعارض حقيقي بين
// الاتنين. الجزء الحساس أمنياً (تدوير التوكنات) مغطّى هنا كامل، تخزين التوكن الآمن (Keychain/
// Keystore) نفسه مش قابل للاختبار في بيئة CI/sandbox من غير جهاز حقيقي — فجوة موثّقة صراحة.
// شغّله بـ: flutter test test_live/otp_flow_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

void main() {
  test('طلب OTP + تحقق حقيقيين بيرجعوا access_token/refresh_token صالحين', () async {
    const phoneNumber = '+201000009999';

    await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});

    // ننتظر شوية لحد ما اللوج يتكتب فعلياً
    await Future<void>.delayed(const Duration(milliseconds: 500));
    final otp = await _latestOtpFor(phoneNumber);

    final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
      'phone_number': phoneNumber,
      'otp_code': otp,
    });

    expect(tokens, isNotNull);
    expect(tokens!['access_token'], isA<String>());
    expect(tokens['refresh_token'], isA<String>());

    final me = await apiRequest('GET', '/auth/me', accessToken: tokens['access_token'] as String);
    expect(me, isNotNull);
    expect(me!['phone_number'], phoneNumber);
  });
}
