// اختبار حي حقيقي لاختيار إضافات كتالوج وقت إنشاء الطلب (addon_ids في CreateOrderScreen) ضد
// apps/api الشغال فعلاً — نفس أسلوب order_creation_live_test.dart.
// شغّله بـ: flutter test test_live/addon_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('عميل حقيقي يشوف إضافات الخدمة ويختار واحدة وقت إنشاء الطلب', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final accessToken = await registerCustomer(uniquePhone());
    final serviceId = await pickBookableServiceId();
    final addressId = await ensureAddressFor(accessToken);

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
      'cancellation_reason_id': await pickCustomerCancellationReasonId(),
    });
  });
}
