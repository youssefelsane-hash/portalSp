// اختبار حي حقيقي للشات الداخلي (مدير↔فنيين، أدمن↔فنيين) ضد apps/api الشغال فعلاً — نفس أسلوب
// باقي test_live/. منفصل تماماً عن شات الدعم للعملاء (support_chat في apps/customer-app).
// شغّله بـ: flutter test test_live/internal_chat_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_exception.dart';
import '_live_support.dart';

// مسار اللوج بيتحدد وقت التشغيل (`_live_support.dart`) — كان مكتوب بالإيد لسيشن قديمة فمات معاها.
Future<String> _latestOtpFor(String phoneNumber) => latestOtpFor(phoneNumber);

Future<String> _loginAs(String phoneNumber) async {
  await apiRequest('POST', '/auth/otp/request', body: {'phone_number': phoneNumber, 'purpose': 'login'});
  await Future<void>.delayed(const Duration(milliseconds: 500));
  final otp = await _latestOtpFor(phoneNumber);
  final tokens = await apiRequest('POST', '/auth/otp/verify', body: {
    'phone_number': phoneNumber,
    'otp_code': otp,
  });
  return tokens!['access_token'] as String;
}

void main() {
  test('فني يبدأ محادثة مع أدمن، الاتنين يتبادلوا رسائل، وفني تاني وعميل يتترفضوا', () async {
    final adminToken = await _loginAs('+201000000030');
    final technicianToken = await _loginAs('+201000000011');

    // الفني بيشوف الأدمن في قايمة جهات الاتصال بتاعته.
    final contacts = await apiRequestList('/internal-chat/contacts', accessToken: technicianToken);
    expect(contacts.every((c) => c['user_type'] == 'admin'), isTrue);

    final adminMe = await apiRequest('GET', '/auth/me', accessToken: adminToken);
    final adminUserId = adminMe!['id'] as String;

    final thread = await apiRequest(
      'POST',
      '/internal-chat/threads',
      accessToken: technicianToken,
      body: {'peer_user_id': adminUserId},
    );
    final threadId = thread!['id'] as String;

    // idempotent — نداء تاني بنفس الطرفين لازم يرجّع نفس الخيط.
    final second = await apiRequest(
      'POST',
      '/internal-chat/threads',
      accessToken: technicianToken,
      body: {'peer_user_id': adminUserId},
    );
    expect(second!['id'], threadId);

    await apiRequest(
      'POST',
      '/internal-chat/threads/$threadId/messages',
      accessToken: technicianToken,
      body: {'content': 'صباح الخير، عندي استفسار عن الطلب'},
    );
    await apiRequest(
      'POST',
      '/internal-chat/threads/$threadId/messages',
      accessToken: adminToken,
      body: {'content': 'اتفضل، قولّي مشكلتك'},
    );

    final history = await apiRequestList('/internal-chat/threads/$threadId/messages', accessToken: technicianToken);
    expect(history.length, 2);
    expect(history[0]['content'], 'صباح الخير، عندي استفسار عن الطلب');
    expect(history[1]['content'], 'اتفضل، قولّي مشكلتك');

    // فني تاني مش طرف في المحادثة دي.
    final otherTechnicianToken = await _loginAs('+201000000012');
    ApiException? otherTechnicianError;
    try {
      await apiRequest('GET', '/internal-chat/threads/$threadId/messages', accessToken: otherTechnicianToken);
    } on ApiException catch (err) {
      otherTechnicianError = err;
    }
    expect(otherTechnicianError, isNotNull);
    expect(otherTechnicianError!.statusCode, 403);

    // عميل ممنوع من الشات الداخلي كله (مقصور على admin/technician).
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    ApiException? customerError;
    try {
      await apiRequest('GET', '/internal-chat/contacts', accessToken: customerToken);
    } on ApiException catch (err) {
      customerError = err;
    }
    expect(customerError, isNotNull);
    expect(customerError!.statusCode, 403);

    // فني↔فني مرفوض — النطاق المسموح بس admin↔admin أو admin↔technician.
    ApiException? technicianPairError;
    try {
      await apiRequest(
        'POST',
        '/internal-chat/threads',
        accessToken: technicianToken,
        body: {'peer_user_id': (await apiRequest('GET', '/auth/me', accessToken: otherTechnicianToken))!['id']},
      );
    } on ApiException catch (err) {
      technicianPairError = err;
    }
    expect(technicianPairError, isNotNull);
    expect(technicianPairError!.statusCode, 400);
  });
}
