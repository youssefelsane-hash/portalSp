// اختبار حي حقيقي لدورة تنفيذ الطلب كاملة (قبول → انطلاق → وصول → بدء → خلاص → تحصيل كاش)
// ضد apps/api الشغال فعلاً — نفس أسلوب technician_orders_live_test.dart بالظبط.
// شغّله بـ: flutter test test_live/order_execution_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';

Future<String> _latestOtpFor(String phoneNumber) async {
  final log = File(
    '/tmp/claude-0/-home-user-portalSp/164813e6-b3a9-5e7c-be97-5f3dc168fd13/scratchpad/server.log',
  );
  final lines = await log.readAsLines();
  final match = lines.lastWhere((line) => line.contains('OTP') && line.contains(phoneNumber));
  return match.split('→').last.trim();
}

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
    final customerToken = await _loginAs('+201000009999');
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
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
