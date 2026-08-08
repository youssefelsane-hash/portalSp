// اختبار حي حقيقي لمسار عرض السعر أثناء التنفيذ (order-items.service.ts) ضد apps/api الشغال
// فعلاً — نفس أسلوب order_execution_live_test.dart بالظبط، بس بيغطي الجزء اللي مكانش مغطى هناك:
// الفني بيقترح بنود إضافية، العميل بيوافق، والمبلغ الإضافي بيتحصّل فعلياً وقت الدفع.
// شغّله بـ: flutter test test_live/quote_approval_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
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
  test('فني بيقترح عرض سعر، العميل بيوافق، والمبلغ الإضافي بيتحصّل فعلياً', () async {
    final customerToken = await _loginAs('+201000009999');
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': '019fde0d-07ca-70e5-a460-d47bdcdad16f',
        'address_id': '019fde0d-392b-7b81-b57b-20267dcd239f',
        'problem_description': 'اختبار حي لمسار عرض السعر',
      },
    );
    final orderId = order!['id'] as String;
    final baseTotalCents = order['total_amount_cents'] as int;

    final technicianToken = await _loginAs('+201000000011');
    await apiRequest('POST', '/technician/orders/$orderId/accept', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    final started = await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    expect(started!['order_status'], 'in_progress');

    final proposed = await apiRequest(
      'POST',
      '/technician/orders/$orderId/quote-items',
      accessToken: technicianToken,
      body: {
        'items': [
          {'item_type': 'spare_part', 'name_ar': 'اختبار حي — قطعة غيار', 'quantity': 1, 'unit_price_cents': 6000},
        ],
      },
    );
    final proposedOrder = proposed!['order'] as Map<String, dynamic>;
    expect(proposedOrder['order_status'], 'awaiting_quote_approval');
    final proposedItems = proposed['items'] as List<dynamic>;
    expect(proposedItems, hasLength(1));
    expect((proposedItems.first as Map<String, dynamic>)['is_customer_approved'], isFalse);

    final quoteItemsAsCustomer = await apiRequestList('/orders/$orderId/quote-items', accessToken: customerToken);
    expect(quoteItemsAsCustomer, hasLength(1));
    expect(quoteItemsAsCustomer.first['name_ar'], 'اختبار حي — قطعة غيار');

    final approveResult = await apiRequest(
      'POST',
      '/orders/$orderId/quote-items/approve',
      accessToken: customerToken,
    );
    final approvedOrder = approveResult!['order'] as Map<String, dynamic>;
    expect(approvedOrder['order_status'], 'in_progress');
    expect(approvedOrder['total_amount_cents'], baseTotalCents + 6000);

    final completed = await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final payment = await apiRequest(
      'POST',
      '/technician/orders/$orderId/collect-cash',
      accessToken: technicianToken,
    );
    expect(payment!['payment_method'], 'cash');
    expect(payment['payment_status'], 'succeeded');
    expect(payment['amount_cents'], baseTotalCents + 6000);
  });
}
