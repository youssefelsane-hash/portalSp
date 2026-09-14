// اختبار حي حقيقي لشات الدعم العام (support_chat) ضد apps/api الشغال فعلاً — نفس أسلوب
// chat_live_test.dart. بيغطي get-or-create للعميل، قراءة/رد الأدمن (عبر resolveParticipant
// الموسّع)، ورفض الفني وأدمن من غير صلاحية support_tickets.manage.
// شغّله بـ: flutter test test_live/support_chat_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
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
  test('عميل بيفتح شات دعم عام، أدمن عنده الصلاحية بيرد، وغير المصرح لهم بيتترفضوا', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final customerToken = await registerCustomer(uniquePhone());

    final first = await apiRequest('GET', '/chat/support-thread', accessToken: customerToken);
    final threadId = first!['id'] as String;
    expect(first['thread_type'], 'support_chat');

    // idempotent — نداء تاني لازم يرجّع نفس الـ thread.
    final second = await apiRequest('GET', '/chat/support-thread', accessToken: customerToken);
    expect(second!['id'], threadId);

    await apiRequest(
      'POST',
      '/chat/threads/$threadId/messages',
      accessToken: customerToken,
      body: {'content': 'اختبار حي — عندي سؤال عن الفاتورة'},
    );

    // أدمن عنده support_tickets.manage (super_admin) — يشوف الخيط في القايمة ويرد.
    // MFA بقى إجباري لحسابات الأدمن (ADR-0011)، فمسار الـOTP بيرجّع `mfa_required` من غير
    // توكن. التوقيع المحلي هو نفس الطريقة المعتمدة في اختبارات الأدمن الحية — تفاصيل في
    // `_live_support.dart`.
    final adminToken = await devAdminToken('+201000000001');
    final threads = await apiRequestList('/admin/support-chat-threads', accessToken: adminToken);
    expect(threads.any((t) => t['id'] == threadId), isTrue);

    final messages = await apiRequestList('/chat/threads/$threadId/messages', accessToken: adminToken);
    expect(messages.last['content'], 'اختبار حي — عندي سؤال عن الفاتورة');

    final reply = await apiRequest(
      'POST',
      '/chat/threads/$threadId/messages',
      accessToken: adminToken,
      body: {'content': 'رد اختبار حي من الأدمن'},
    );
    expect(reply!['sender_user_id'], isNotNull);

    // فني — مش طرف في خيط دعم عام خالص.
    final technicianToken = await _loginAs('+201000000011');
    ApiException? technicianError;
    try {
      await apiRequest('GET', '/chat/threads/$threadId/messages', accessToken: technicianToken);
    } on ApiException catch (err) {
      technicianError = err;
    }
    expect(technicianError, isNotNull);
    expect(technicianError!.statusCode, 403);

    // أدمن مالوش support_tickets.manage (finance role) — يترفض من القايمة ومن الخيط نفسه.
    final financeAdminToken = await devAdminToken('+201000000031');
    ApiException? financeListError;
    try {
      await apiRequest('GET', '/admin/support-chat-threads', accessToken: financeAdminToken);
    } on ApiException catch (err) {
      financeListError = err;
    }
    expect(financeListError, isNotNull);
    expect(financeListError!.statusCode, 403);

    ApiException? financeThreadError;
    try {
      await apiRequest('GET', '/chat/threads/$threadId/messages', accessToken: financeAdminToken);
    } on ApiException catch (err) {
      financeThreadError = err;
    }
    expect(financeThreadError, isNotNull);
    expect(financeThreadError!.statusCode, 403);
  });
}
