// اختبار حي حقيقي لدورة تنفيذ الطلب كاملة (قبول → انطلاق → وصول → بدء → خلاص → تحصيل كاش)
// ضد apps/api الشغال فعلاً — نفس أسلوب technician_orders_live_test.dart بالظبط.
// شغّله بـ: flutter test test_live/order_execution_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
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
  test('فني حقيقي يقبل طلب حقيقي وينفّذه لحد التحصيل', () async {
    // العميل بيطلب في نطاق "اختبار المهلة" (القاهرة) — الفني ده بس المتاح فيه، فمفيش لبس
    // في مين هياخد الطلب لما نجيب /technician/orders/available.
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار حي لدورة تنفيذ الفني',
      },
    );
    final orderId = order!['id'] as String;
    expect(order['order_status'], 'searching_technician');

    final technicianToken = await _loginAs('+201000000011');

    final available = await apiRequestList('/technician/orders/available', accessToken: technicianToken);
    expect(available.any((a) => a['order_id'] == orderId), isTrue,
        reason: 'الطلب المُنشأ لازم يظهر في قايمة الفني المتاح في نفس النطاق');

    final accepted = await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);
    expect(accepted!['order_status'], 'accepted');

    final departed =
        await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    expect(departed!['order_status'], 'technician_on_way');

    final arrived =
        await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    expect(arrived!['order_status'], 'technician_arrived');

    final started = await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    expect(started!['order_status'], 'in_progress');

    final completed =
        await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final payment = await apiRequest(
      'POST',
      '/technician/orders/$orderId/collect-cash',
      accessToken: technicianToken,
    );
    expect(payment!['payment_method'], 'cash');
    expect(payment['payment_status'], 'succeeded');
  });
}
