// اختبار حي حقيقي لاختيار إضافات كتالوج وقت إنشاء الطلب (addon_ids في CreateOrderScreen) ضد
// apps/api الشغال فعلاً — نفس أسلوب order_creation_live_test.dart.
// شغّله بـ: flutter test test_live/addon_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
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
  test('عميل حقيقي يشوف إضافات الخدمة ويختار واحدة وقت إنشاء الطلب', () async {
    final accessToken = await _loginAs('+201000009999');
    const serviceId = '019fde0d-07ca-70e5-a460-d47bdcdad16f';
    const addressId = '019fde0d-392b-7b81-b57b-20267dcd239f';

    final addons = await apiRequestList('/services/$serviceId/addons');
    expect(addons, isNotEmpty, reason: 'محتاجين إضافة نشطة واحدة على الأقل على الخدمة دي');
    final addon = addons.firstWhere((a) => a['name_ar'] == 'ضمان إضافي 6 شهور');
    final addonId = addon['id'] as String;
    final addonPriceCents = addon['price_cents'] as int;

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: accessToken,
      body: {
        'service_id': serviceId,
        'address_id': addressId,
        'problem_description': 'اختبار حي لاختيار إضافة وقت الحجز',
        'addon_ids': [addonId],
      },
    );
    expect(order, isNotNull);
    final orderId = order!['id'] as String;
    final estimatedPriceCents = order['estimated_price_cents'] as int;
    expect(order['total_amount_cents'], estimatedPriceCents + addonPriceCents);

    final items = await apiRequestList('/orders/$orderId/quote-items', accessToken: accessToken);
    expect(items, hasLength(1));
    expect(items.first['item_type'], 'addon');
    expect(items.first['is_customer_approved'], isTrue);
    expect(items.first['total_price_cents'], addonPriceCents);

    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: accessToken, body: {
      'reason': 'تنظيف بيانات اختبار حي',
    });
  });
}
