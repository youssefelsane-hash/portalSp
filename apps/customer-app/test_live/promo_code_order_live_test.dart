// اختبار حي حقيقي لتطبيق كود خصم فعلي وقت إنشاء طلب ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/. بيعمل كود خصم تجريبي عبر مسار الأدمن أولاً (مفيش أكواد فعّالة دايماً في القاعدة
// التطويرية)، يستخدمه، ثم يعطّله بعد الاختبار.
// شغّله بـ: flutter test test_live/promo_code_order_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
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
  test('عميل حقيقي يتحقق من كود خصم حقيقي وينشئ طلب مخصوم بيه', () async {
    final adminToken = await _loginAs('+201000000001');
    final code = 'LIVETEST${DateTime.now().millisecondsSinceEpoch}';
    final now = DateTime.now().toUtc();
    final promo = await apiRequest(
      'POST',
      '/admin/promo-codes',
      accessToken: adminToken,
      body: {
        'code': code,
        'name_ar': 'اختبار حي',
        'discount_type': 'fixed_amount',
        'discount_value': 50,
        'usage_limit_total': 5,
        'usage_limit_per_user': 1,
        'valid_from': now.subtract(const Duration(days: 1)).toIso8601String(),
        'valid_until': now.add(const Duration(days: 1)).toIso8601String(),
      },
    );
    expect(promo, isNotNull);
    expect(promo!['is_active'], isTrue);

    final customerToken = await _loginAs('+201000009999');
    const serviceId = '019fde0d-07ca-70e5-a460-d47bdcdad16f';
    const addressId = '019fde0d-392b-7b81-b57b-20267dcd239f';

    final validation = await apiRequest(
      'GET',
      '/promo-codes/$code/validate?service_id=$serviceId&address_id=$addressId',
      accessToken: customerToken,
    );
    expect(validation, isNotNull);
    expect(validation!['discount_cents'], 5000);

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {'service_id': serviceId, 'address_id': addressId, 'promo_code': code},
    );
    expect(order, isNotNull);
    expect(order!['discount_amount_cents'], 5000);
    expect(order['promo_code_id'], isNotNull);
    final expectedTotal = (order['estimated_price_cents'] as int) - 5000;
    expect(order['total_amount_cents'], expectedTotal);
    final orderId = order['id'] as String;

    // نفس الكود تاني على طلب جديد لازم يترفض (usage_limit_per_user=1)
    ApiException? secondAttemptError;
    try {
      await apiRequest(
        'POST',
        '/orders',
        accessToken: customerToken,
        body: {'service_id': serviceId, 'address_id': addressId, 'promo_code': code},
      );
    } on ApiException catch (err) {
      secondAttemptError = err;
    }
    expect(secondAttemptError, isNotNull);

    // نظافة: نلغي الطلب ونعطّل الكود التجريبي
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي'});
    await apiRequest('POST', '/admin/promo-codes/${promo['id']}/deactivate', accessToken: adminToken);
  });
}
