// اختبار حي حقيقي لتدفق رمز الدخول كامل (تسجيل → دخول → تدوير توكن) ضد apps/api الشغال فعلاً.
// بيستخدم apiRequest() مباشرة (مش AuthRepository) عشان AuthRepository محتاج
// flutter_secure_storage (platform channel) اللي بيحتاج TestWidgetsFlutterBinding، والـ binding
// ده بالذات هو اللي بيفعّل قيد "أي HTTP request يرجع 400" في اختبارات Flutter — تعارض حقيقي بين
// الاتنين. الجزء الحساس أمنياً (تدوير التوكنات) مغطّى هنا كامل، تخزين التوكن الآمن (Keychain/
// Keystore) نفسه مش قابل للاختبار في بيئة CI/sandbox من غير جهاز حقيقي — فجوة موثّقة صراحة.
//
// **بديل `otp_flow_live_test.dart`** (ADR-0109). الفرق الجوهري: مفيش لوج بيتقرا ومفيش انتظار —
// التسجيل والدخول نداء واحد لكل واحد.
// شغّله بـ: flutter test test_live/pin_flow_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';

void main() {
  test('تسجيل + دخول برمز حقيقيين بيرجعوا access_token/refresh_token صالحين', () async {
    final phoneNumber = uniquePhone();
    final registerToken = await registerCustomer(phoneNumber, fullName: 'عميل اختبار تدفق الرمز');
    expect(registerToken, isA<String>());

    // الحساب الجديد لازم يطلع **وهو معاه رمز** — من غير ده `_AuthGate` هيحاصره في شاشة تعيين
    // رمز رغم إنه لسه اختاره بإيده في نفس الثانية.
    final meAfterRegister = await apiRequest('GET', '/auth/me', accessToken: registerToken);
    expect(meAfterRegister!['pin_set'], isTrue,
        reason: 'التسجيل بالرمز لازم يسيب الحساب وهو معاه رمز');
    // ADR-0109 §4 — التسجيل بالرمز **مابيثبتش** ملكية الرقم، فالعمود بيفضل فاضي عمدًا.
    expect(meAfterRegister['phone_verified'], isFalse,
        reason: 'ADR-0109 §4: الرمز سر، مش إثبات ملكية للرقم');

    final tokens = await apiRequest('POST', '/auth/pin/login', body: {
      'phone_number': phoneNumber,
      'pin': kLiveTestPin,
    });
    expect(tokens, isNotNull);
    expect(tokens!['access_token'], isA<String>());
    expect(tokens['refresh_token'], isA<String>());

    final me = await apiRequest('GET', '/auth/me', accessToken: tokens['access_token'] as String);
    expect(me, isNotNull);
    expect(me!['phone_number'], phoneNumber);

    // تدوير التوكن — نفس عقد مسار الـOTP القديم بالحرف.
    final rotated = await apiRequest('POST', '/auth/refresh',
        body: {'refresh_token': tokens['refresh_token'] as String});
    expect(rotated!['access_token'], isA<String>());
    expect(rotated['refresh_token'], isA<String>());
    expect(rotated['refresh_token'], isNot(tokens['refresh_token']),
        reason: 'التدوير لازم يطلّع refresh token جديد');
  });

  test('رمز غلط بيترفض، والرسالة مابتفرّقش بين رقم مش مسجّل ورمز غلط', () async {
    final phoneNumber = uniquePhone();
    await registerCustomer(phoneNumber, fullName: 'عميل اختبار رمز غلط');

    String messageFor(Object err) => ApiException.from(err).message;

    // رمز غلط لحساب **موجود**
    String? wrongPinMessage;
    try {
      await apiRequest('POST', '/auth/pin/login',
          body: {'phone_number': phoneNumber, 'pin': '905142'});
      fail('رمز غلط لازم يترفض');
    } catch (err) {
      wrongPinMessage = messageFor(err);
    }

    // نفس الرمز لرقم **مش موجود خالص**
    String? unknownPhoneMessage;
    try {
      await apiRequest('POST', '/auth/pin/login',
          body: {'phone_number': uniquePhone(9), 'pin': '905142'});
      fail('رقم مش مسجّل لازم يترفض');
    } catch (err) {
      unknownPhoneMessage = messageFor(err);
    }

    // **منع تعداد الحسابات (ADR-0109 §5)**: لو الرسالتين اختلفوا، أي حد يقدر يعرف إن رقم
    // معيّن عنده حساب على المنصة بنداء واحد — تسريب بيانات شخصية بلا أي مصادقة.
    expect(wrongPinMessage, unknownPhoneMessage,
        reason: 'الرد لازم يبقى متطابق بالحرف وإلا الرقم بيبقى قابل للتعداد');
  });
}
