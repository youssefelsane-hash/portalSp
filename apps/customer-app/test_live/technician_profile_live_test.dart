// اختبار حي حقيقي لبروفايل الفني العام + إعادة الحجز ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/.
// شغّله بـ: flutter test test_live/technician_profile_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
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
  test('فني يحدّث نبذته الشخصية، عميل يشوف بروفايله العام، وإعادة الحجز بتحاول تعرضه حصرياً', () async {
    final technicianToken = await _loginAs('+201000000011');
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك: الـthrottle بيتعقّب بالرقم (٥ طلبات OTP في
    // الدقيقة)، و١٢ ملف اختبار كانوا بيسجّلوا دخول بنفس `+201000009999` — فكانوا بياكلوا
    // حصة بعض والنتيجة «حاولت كتير في وقت قصير» لأسباب مالهاش علاقة بالكود المختبَر.
    final customerToken = await registerCustomer(uniquePhone());

    final updated = await apiRequest(
      'PATCH',
      '/technician/profile',
      accessToken: technicianToken,
      body: {'bio': 'اختبار حي — فني سباكة محترف'},
    );
    expect(updated!['bio'], 'اختبار حي — فني سباكة محترف');
    final technicianId = updated['id'] as String;

    final profile = await apiRequest(
      'GET',
      '/technicians/$technicianId/profile',
      accessToken: customerToken,
    );
    expect(profile!['bio'], 'اختبار حي — فني سباكة محترف');
    expect(profile['zones'], isNotEmpty);
    expect(profile['services'], isNotEmpty);
    expect(profile['completed_orders_count'], greaterThan(0));

    // فني اترفض من نفس الـ endpoint (مقصور على @Roles(CUSTOMER)).
    ApiException? technicianError;
    try {
      await apiRequest('GET', '/technicians/$technicianId/profile', accessToken: technicianToken);
    } on ApiException catch (err) {
      technicianError = err;
    }
    expect(technicianError, isNotNull);
    expect(technicianError!.statusCode, 403);

    // إعادة الحجز — أول جولة مطابقة بتحاول تعرض على نفس الفني حصرياً (مش ضمان قبول، تفضيل بس).
    final serviceId = profile['services'][0]['id'] as String;
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': serviceId,
        'address_id': await ensureAddressFor(customerToken),
        'requested_technician_id': technicianId,
      },
    );
    expect(order!['order_status'], 'searching_technician');

    final accepted = await apiRequest(
      'POST',
      '/technician/orders/${order['id']}/accept',
      accessToken: technicianToken,
    );
    expect(accepted!['technician_id'], technicianId);

    await apiRequest('POST', '/orders/${order['id']}/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
  });
}
