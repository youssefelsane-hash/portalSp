// اختبار حي حقيقي لبروفايل الفني العام + إعادة الحجز ضد apps/api الشغال فعلاً — نفس أسلوب باقي
// test_live/.
// شغّله بـ: flutter test test_live/technician_profile_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import 'package:customer_app/core/api_exception.dart';
import '_live_support.dart';


void main() {
  test('فني يحدّث نبذته الشخصية، عميل يشوف بروفايله العام، وإعادة الحجز بتحاول تعرضه حصرياً', () async {
    // **الاختبار بيجهّز شرطه بنفسه (تدقيق §148)**: `completed_orders_count > 0` كان بيعتمد على
    // تاريخ فني مُجهّز من سيشن قديمة. دلوقتي بنمشّي دورة تنفيذ كاملة الأول، وبنكمّل الاختبار
    // **على الفني اللي نفّذها فعلاً** — فالرقم اللي بنتحقق منه ليه مصدر حقيقي في نفس التشغيلة.
    final historyCustomer = await registerCustomer(uniquePhone());
    final completedOrderId = await completeOrderThroughTechnician(
      historyCustomer,
      technicianPhone: '+201000000016',
      problemDescription: 'طلب اختبار بروفايل الفني',
    );
    final completedOrder = await apiRequest('GET', '/orders/$completedOrderId', accessToken: historyCustomer);
    final executingTechnicianId = completedOrder!['technician_id'] as String;
    final technicianToken = await devTokenForTechnicianProfile(executingTechnicianId);
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
    // أول خدمة في بروفايل الفني ممكن تكون محتاجة معاد بداية أو حقول تسعير، فالطلب بيترفض
    // لسبب مالوش علاقة بالمُختبَر (إعادة الحجز). الفني المزروع مؤهّل لكل الخدمات النشطة،
    // فبناخد خدمة قابلة للحجز مباشرةً (§148).
    expect(profile['services'], isNotEmpty);
    final serviceId = await pickBookableServiceId();
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

    // التوزيع بيتم **بشكل غير متزامن** بعد إنشاء الطلب، فالعرض ممكن ما يكونش اتبعت لسه لحظة
    // ما الاختبار يدوس «اقبل» — وساعتها بيرجع «العرض ده مبقاش متاح» وهو مجرد سباق توقيت.
    // بنعيد المحاولة لحد ما الجولة الأولى تخرج (وهي الجولة اللي بتعرض على الفني المطلوب
    // حصريًا — ده اللي بنختبره أصلاً).
    Map<String, dynamic>? accepted;
    Object? lastError;
    for (var attempt = 0; attempt < 25 && accepted == null; attempt++) {
      try {
        accepted = await apiRequest(
          'POST',
          '/technician/orders/${order['id']}/accept',
          accessToken: technicianToken,
        );
      } catch (err) {
        lastError = err;
        await Future<void>.delayed(const Duration(milliseconds: 400));
      }
    }
    expect(accepted, isNotNull, reason: 'الجولة الأولى ما عرضتش على الفني المطلوب: $lastError');
    expect(accepted!['technician_id'], technicianId);

    await apiRequest('POST', '/orders/${order['id']}/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
  });
}
