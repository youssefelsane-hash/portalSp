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
    // **الخدمة لازم تكون من خدمات الفني ده بالتحديد.** التعليق فوق كان بيفترض إن «الفني المزروع
    // مؤهّل لكل الخدمات النشطة» — الافتراض بيكسر أول ما أي أداة تانية تسيب خدمة اختبار في
    // الكتالوج (`seed-technician-screens.js` بيعمل واحدة كل تشغيلة)، وساعتها الطلب بيتعمل على
    // خدمة الفني مش مؤهّل ليها والعرض عمره ما يوصله.
    final serviceId = await pickBookableServiceId(servedByTechnicianToken: technicianToken);
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': serviceId,
        // ADR-0060 §4 / migration 0340 — كل خدمات الكتالوج بقت بدقة «يوم + ساعة وصول»،
        // فالموعد إجباري. القيمة من `bookableScheduledAt()` — الشرح هناك.
        'scheduled_at': bookableScheduledAt(),
        'address_id': await ensureAddressFor(customerToken),
        'requested_technician_id': technicianId,
      },
    );
    expect(order!['order_status'], 'searching_technician');

    // **التوزيع بيتم بشكل غير متزامن، وله مسارين شرعيين** — الاختبار لازم يقبل الاتنين.
    //
    //  ١) **جولة عرض**: الفني بياخد عرض وبيدوس «اقبل» (الخدمات التقيلة).
    //  ٢) **تأكيد مباشر**: خدمة من فئة `LIGHT` مع `requested_technician_id` بتتأكّد على الفني
    //     **فورًا بلا جولة عرض** (`confirmTechnicianForOrder` — `matching.service.ts`).
    //
    // النسخة القديمة كانت بتفترض المسار الأول بس، وبتـ`expect` على نجاح نداء «اقبل» بتاعها هي.
    // على خدمة `LIGHT` الطلب بيبقى متأكّد **قبل** ما النداء يوصل، فبيرجع 409 «الطلب اتاخد من فني
    // تاني أو مبقاش متاح» — والاختبار بيسقط رغم إن النتيجة اللي بيقيسها **تحققت بالفعل وأقوى**.
    //
    // اللي بيتقاس فعلاً هو **إن الطلب رسى على الفني المطلوب حصريًا**، وده اللي بنتحقق منه تحت
    // بغض النظر عن المسار اللي وصلنا بيه.
    Map<String, dynamic>? settledOrder;
    Object? lastError;
    for (var attempt = 0; attempt < 25 && settledOrder == null; attempt++) {
      try {
        await apiRequest(
          'POST',
          '/technician/orders/${order['id']}/accept',
          accessToken: technicianToken,
        );
      } catch (err) {
        lastError = err;
      }
      final current = await apiRequest('GET', '/orders/${order['id']}', accessToken: customerToken);
      if (current != null && current['technician_id'] != null) {
        settledOrder = current;
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    expect(
      settledOrder,
      isNotNull,
      reason: 'الطلب ما رساش على أي فني — الجولة الأولى ما عرضتش على الفني المطلوب: $lastError',
    );
    expect(
      settledOrder!['technician_id'],
      technicianId,
      reason: 'الطلب رسى على فني غير المطلوب — الحصرية للفني المطلوب مكسورة',
    );

    await apiRequest('POST', '/orders/${order['id']}/cancel', accessToken: customerToken, body: {'reason': 'اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
  });
}
