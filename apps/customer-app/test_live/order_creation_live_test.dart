// اختبار حي حقيقي لتدفق إنشاء عنوان + طلب كامل ضد apps/api الشغال فعلاً — نفس أسلوب
// otp_flow_live_test.dart (apiRequest مباشرة، مش AuthRepository، لنفس سبب تعارض
// flutter_secure_storage مع TestWidgetsFlutterBinding الموثّق هناك).
// شغّله بـ: flutter test test_live/order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('عميل حقيقي يضيف عنوان جديد وينشئ طلب حقيقي ويلغيه', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final accessToken = await registerCustomer(uniquePhone());

    final cities = await apiRequestList('/cities');
    expect(cities, isNotEmpty);
    final cityId = cities.first['id'] as String;

    final areas = await apiRequestList('/cities/$cityId/areas');
    expect(areas, isNotEmpty);
    final areaId = areas.first['id'] as String;

    final address = await apiRequest(
      'POST',
      '/addresses',
      accessToken: accessToken,
      body: {
        'city_id': cityId,
        'area_id': areaId,
        'street_name': 'شارع اختبار حي',
        'latitude': 30.0444,
        'longitude': 31.2357,
        'label': 'اختبار flutter live',
      },
    );
    expect(address, isNotNull);
    final addressId = address!['id'] as String;
    expect(address['street_name'], 'شارع اختبار حي');

    // أول خدمة **بلا حقول تسعير إجبارية**: فيه فئات بلا خدمات، وفيه خدمات formula محتاجة
    // «المساحة» فالطلب بيترفض لسبب مالوش علاقة بالمُختبَر (§148).
    final serviceId = await pickBookableServiceId();

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: accessToken,
      body: {
        'service_id': serviceId,
        // ADR-0060 §4 / migration 0340 — كل خدمات الكتالوج بقت بدقة «يوم + ساعة وصول»،
        // فالموعد إجباري. القيمة من `bookableScheduledAt()` — الشرح هناك.
        'scheduled_at': bookableScheduledAt(),
        'address_id': addressId,
        'problem_description': 'اختبار حي من customer-app',
      },
    );
    expect(order, isNotNull);
    expect(order!['order_status'], 'searching_technician');
    final orderId = order['id'] as String;

    final fetchedOrder = await apiRequest('GET', '/orders/$orderId', accessToken: accessToken);
    expect(fetchedOrder!['id'], orderId);

    final orders = await apiRequestList('/orders', accessToken: accessToken);
    expect(orders.any((o) => o['id'] == orderId), isTrue);

    final cancelled = await apiRequest(
      'POST',
      '/orders/$orderId/cancel',
      accessToken: accessToken,
      body: {'reason': 'تنظيف بيانات اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()},
    );
    expect(cancelled!['order_status'], 'cancelled_by_customer');

    // تنظيف: مسح العنوان التجريبي (delete فعلي، مش soft-delete بصمت من غير تأكيد)
    await apiRequest('DELETE', '/addresses/$addressId', accessToken: accessToken);
  });
}
