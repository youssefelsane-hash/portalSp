// اختبار حي حقيقي لتدفق إنشاء عنوان + طلب كامل ضد apps/api الشغال فعلاً — نفس أسلوب
// otp_flow_live_test.dart (apiRequest مباشرة، مش AuthRepository، لنفس سبب تعارض
// flutter_secure_storage مع TestWidgetsFlutterBinding الموثّق هناك).
// شغّله بـ: flutter test test_live/order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
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
  test('عميل حقيقي يضيف عنوان جديد وينشئ طلب حقيقي ويلغيه', () async {
    final accessToken = await _loginAs('+201000009999');

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

    // بعض الفئات في القاعدة التطويرية دي مالهاش خدمات (فئات تجريبية من اختبارات تانية زي
    // Playwright) — بندوّر على أول فئة فيها خدمة فعلية بدل ما نفترض إن الأولى دايماً مليانة.
    final categories = await apiRequestList('/service-categories');
    expect(categories, isNotEmpty);
    String? serviceId;
    for (final category in categories) {
      final services = await apiRequestList('/services?category_id=${category['id']}');
      if (services.isNotEmpty) {
        serviceId = services.first['id'] as String;
        break;
      }
    }
    expect(serviceId, isNotNull, reason: 'محتاجين خدمة واحدة على الأقل مربوطة بفئة عشان نختبر إنشاء طلب');

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: accessToken,
      body: {
        'service_id': serviceId!,
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
      body: {'reason': 'تنظيف بيانات اختبار حي'},
    );
    expect(cancelled!['order_status'], 'cancelled_by_customer');

    // تنظيف: مسح العنوان التجريبي (delete فعلي، مش soft-delete بصمت من غير تأكيد)
    await apiRequest('DELETE', '/addresses/$addressId', accessToken: accessToken);
  });
}
