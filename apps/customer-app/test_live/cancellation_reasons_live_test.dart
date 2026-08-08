// اختبار حي حقيقي لميزة أسباب الإلغاء + رسوم الإلغاء (كانت فجوة موثّقة في apps/api، اتقفلت،
// والواجهة هنا اتوصّلت بيها في نفس الجلسة). نفس نمط order_creation_live_test.dart — apiRequest
// مباشرة، مش AuthRepository/OrdersRepository، لنفس سبب تعارض flutter_secure_storage.
// شغّله بـ: flutter test test_live/cancellation_reasons_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';

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
  test('عميل حقيقي يشوف أسباب الإلغاء ويلغي طلب برسوم حقيقية من محفظته', () async {
    final adminToken = await _loginAs('+201000000001');
    final customerToken = await _loginAs('+201000009999');

    // 1) القايمة العامة (مفيش accessToken هنا عمداً — @Public() في الباك-إند)
    final customerReasons = await apiRequestList('/cancellation-reasons?applies_to=customer');
    expect(customerReasons, isNotEmpty, reason: 'لازم يكون فيه سبب واحد على الأقل من الجلسات السابقة');
    final feeReason = customerReasons.firstWhere(
      (r) => r['charges_fee'] == true,
      orElse: () => throw StateError('محتاجين سبب فيه رسوم لاختبار الحساب'),
    );
    final feePercentage = (feeReason['fee_percentage'] as num).toDouble();

    final technicianReasons = await apiRequestList('/cancellation-reasons?applies_to=technician');
    expect(technicianReasons, isNotEmpty);
    expect(technicianReasons.every((r) => r['applies_to'] == 'technician'), isTrue);

    // 2) نافذة الإلغاء المجاني اتصغّرت لصفر مؤقتاً عشان الرسوم تتطبّق فوراً وقت الاختبار
    final windowBefore = await apiRequest(
      'GET',
      '/admin/settings/orders.cancellation_free_window_min',
      accessToken: adminToken,
    );
    final originalWindow = windowBefore!['value'];
    await apiRequest(
      'PATCH',
      '/admin/settings/orders.cancellation_free_window_min',
      accessToken: adminToken,
      body: {'value': 0},
    );

    try {
      final services = await apiRequestList('/services');
      final serviceId = services.first['id'] as String;
      final myOrders = await apiRequestList('/orders', accessToken: customerToken);
      final existingAddressOrder = myOrders.firstWhere((o) => o['address_id'] != null);
      final addressId = existingAddressOrder['address_id'] as String;

      final walletBefore = await apiRequest('GET', '/wallet', accessToken: customerToken);
      final balanceBefore = walletBefore!['balance_cents'] as int;

      final order = await apiRequest(
        'POST',
        '/orders',
        accessToken: customerToken,
        body: {'service_id': serviceId, 'address_id': addressId},
      );
      final orderId = order!['id'] as String;
      final totalCents = order['total_amount_cents'] as int;
      final expectedFee = (totalCents * feePercentage / 100).round();

      final cancelled = await apiRequest(
        'POST',
        '/orders/$orderId/cancel',
        accessToken: customerToken,
        body: {'cancellation_reason_id': feeReason['id'], 'reason': 'اختبار حي من الواجهة'},
      );
      expect(cancelled!['order_status'], 'cancelled_by_customer');
      expect(cancelled['cancellation_fee_cents'], expectedFee);
      expect(cancelled['cancellation_reason_id'], feeReason['id']);

      final walletAfter = await apiRequest('GET', '/wallet', accessToken: customerToken);
      final balanceAfter = walletAfter!['balance_cents'] as int;
      expect(balanceAfter, balanceBefore - expectedFee);

      // سبب applies_to=technician مرفوض لإلغاء عميل
      final order2 = await apiRequest(
        'POST',
        '/orders',
        accessToken: customerToken,
        body: {'service_id': serviceId, 'address_id': addressId},
      );
      final order2Id = order2!['id'] as String;
      await expectLater(
        apiRequest(
          'POST',
          '/orders/$order2Id/cancel',
          accessToken: customerToken,
          body: {'cancellation_reason_id': technicianReasons.first['id']},
        ),
        throwsA(isA<ApiException>()),
      );
      // تنظيف الطلب اللي فضل مفتوح بسبب المحاولة المرفوضة
      await apiRequest('POST', '/orders/$order2Id/cancel', accessToken: customerToken, body: {'reason': 'تنظيف'});
    } finally {
      await apiRequest(
        'PATCH',
        '/admin/settings/orders.cancellation_free_window_min',
        accessToken: adminToken,
        body: {'value': originalWindow},
      );
    }
  });
}
