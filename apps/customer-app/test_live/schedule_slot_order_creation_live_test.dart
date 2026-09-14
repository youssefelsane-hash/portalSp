// اختبار حي حقيقي لربط الجدولة الحقيقية للفني (docs/08 §2-§3) بمسار إنشاء الطلب — كانت
// TechnicianScheduleService.bookSlot() جاهزة ومختبرة في الباك-إند بلا أي caller خالص. مختلف عن
// باقي test_live بإنه بيسجّل فني/عميل حقيقيين ويبني سلوت بنفسه (نفس فلسفة
// pricing_engine_order_creation_live_test.dart — استقرار عبر السيشنز المختلفة).
// شغّله بـ: flutter test test_live/schedule_slot_order_creation_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:customer_app/core/api_client.dart';
import '_live_support.dart';



void main() {
  test('عميل حقيقي يحجز سلوت فاضي من جدول فني بعينه، ويترفض سباق نفس السلوت من عميل تاني', () async {
    // **الأدوار بقت صريحة (تدقيق §148)**: الاختبار كان بيسجّل دخول بـ`+201000000102` كـ«فني»،
    // وهو في بذور التطوير **عميل** — فكل نداء `/technician/...` كان بيترفض ٤٠٣ «مش مسموح لك
    // تعمل العملية دي»، وده سلوك صح للحارس مش بَقّة. الفني دلوقتي فني مزروع فعلاً، والعميلين
    // بيتعملوا جدد كل تشغيلة فمفيش تصادم جداول بين التشغيلات.
    //
    // فني مخصّص لجدولة هذا الاختبار (`+201000000012`) مش الفني الرئيسي — عشان السلوتات اللي
    // بتتعمل هنا ما تزاحمش الاختبارات اللي بتشتغل على `+201000000011`.
    const technicianPhone = '+201000000012';
    final technicianToken = await devTechnicianToken(technicianPhone);
    final customerAToken = await registerCustomer(uniquePhone());
    final customerBToken = await registerCustomer(uniquePhone());

    final me = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    // مش محتاجين نتيجته فعليًا، بس بيتأكد التوكن شغال — لو فشل، هيرمي ApiException واضح.
    expect(me, anyOf(isNull, isA<Map<String, dynamic>>()));

    // **تاريخ فريد لكل تشغيلة + تنضيف قبل الإنشاء (تدقيق §148)**: أي تشغيلة فشلت في النص
    // بتسيب سلوت وراها (التنضيف في آخر الاختبار مابيوصلش)، والتشغيلة اللي بعدها بتترفض بـ
    // «السلوت ده بيتداخل مع سلوت موجود بالفعل في نفس اليوم» — فشل سببه بقايا مش الكود.
    final slotDate = DateTime.now()
        .add(Duration(days: 2 + DateTime.now().microsecondsSinceEpoch % 21))
        .toIso8601String()
        .substring(0, 10);

    // `/technician/schedule` (جدول الفني لنفسه) مش `/technicians/:id/schedule` (العرض العام
    // للعميل) — التاني بيترفض ٤٠٣ لتوكن فني، وهو سلوك صح للحارس.
    final existingSlots = await apiRequestList('/technician/schedule', accessToken: technicianToken);
    for (final stale in existingSlots.where((slot) => slot['slot_date'] == slotDate)) {
      await apiRequest('DELETE', '/technician/schedule/${stale['id']}', accessToken: technicianToken);
    }

    final slot = await apiRequest('POST', '/technician/schedule', accessToken: technicianToken, body: {
      'slot_date': slotDate,
      'start_time': '09:00:00',
      'end_time': '11:00:00',
      'notes_ar': 'اختبار Dart حي لربط الجدولة',
    });
    final slotId = slot!['id'] as String;

    // الجدول العام بمنظور العميل — نفس endpoint اللي TechnicianProfileScreen بيستخدمه.
    final technicianProfileId = slot['technician_id'] as String;
    final publicSchedule = await apiRequestList('/technicians/$technicianProfileId/schedule', accessToken: customerAToken);
    expect(publicSchedule.any((s) => s['id'] == slotId && s['is_available'] == true), isTrue);

    // نفس الخدمة اللي الفني ده مؤهّل ليها فعليًا (technician_services) — أي خدمة تانية هتخلّي
    // matching يرفض الفني ده أصلاً حتى لو السلوت اتحجز صح، فمش هيثبت الربط المطلوب اختباره.
    final technicianProfile = await apiRequest('GET', '/technicians/$technicianProfileId/profile', accessToken: customerAToken);
    final technicianServices = (technicianProfile!['services'] as List<dynamic>).cast<Map<String, dynamic>>();
    expect(technicianServices, isNotEmpty, reason: 'محتاجين الفني يكون مؤهّل لخدمة حقيقية واحدة على الأقل');

    // **الخدمة لازم تكون بلا حقول تسعير إجبارية كمان**: أول خدمة مؤهّل لها الفني ممكن تكون
    // محتاجة «عدد الساعات» أو «المساحة»، فالطلب بيترفض لسبب مالوش علاقة بالمُختبَر — اللي
    // بنختبره هنا هو **ربط السلوت**، مش إدخال حقول التسعير (§148).
    String? pickedServiceId;
    for (final service in technicianServices) {
      final id = service['id'] as String;
      final fields = await apiRequestList('/services/$id/pricing-fields');
      if (fields.every((f) => f['is_required'] != true)) {
        pickedServiceId = id;
        break;
      }
    }
    expect(pickedServiceId, isNotNull, reason: 'محتاجين خدمة مؤهّل لها الفني وبلا حقول تسعير إجبارية');
    final serviceId = pickedServiceId!;

    // **عنوان لكل عميل (تدقيق §148)**: العناوين مملوكة لصاحبها، فالعميل التاني كان بياخد
    // «العنوان غير موجود» لما يستخدم عنوان الأول — سلوك صح للحارس، والاختبار كان مبني على
    // افتراض إن الاتنين بيشاركوا عنوان مُجهّز مسبقًا.
    final cities = await apiRequestList('/cities');
    final areas = await apiRequestList('/cities/${cities.first['id']}/areas');
    final address = await apiRequest('POST', '/addresses', accessToken: customerAToken, body: {
      'city_id': cities.first['id'],
      'area_id': areas.first['id'],
      'street_name': 'شارع اختبار الجدولة',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'اختبار Dart حي — جدولة',
    });
    final addressB = await apiRequest('POST', '/addresses', accessToken: customerBToken, body: {
      'city_id': cities.first['id'],
      'area_id': areas.first['id'],
      'street_name': 'شارع اختبار الجدولة ب',
      'latitude': 30.0444,
      'longitude': 31.2357,
      'label': 'اختبار Dart حي — جدولة ب',
    });
    final addressBId = addressB!['id'] as String;

    // خدمة بدقة «يوم + ساعة» بتطلب `scheduled_at` صراحةً حتى مع السلوت — السلوت بيحدد اليوم
    // والنافذة، والوقت الفعلي لسه مطلوب. بنبنيه من بداية السلوت نفسه.
    final scheduledAt = DateTime.parse('${slotDate}T09:00:00Z').toIso8601String();
    final addressId = address!['id'] as String;

    // العميل التاني بيحاول يحجز نفس السلوت في نفس اللحظة تقريبًا — لازم يترفض بوضوح
    // (bookSlot() الذرّي جوّه transaction إنشاء الطلب)، مش يعدّي بصمت على سلوت اتحجز بالفعل.
    Map<String, dynamic>? orderA;
    Map<String, dynamic>? orderB;
    Object? errorA;
    Object? errorB;

    await Future.wait([
      apiRequest('POST', '/orders', accessToken: customerAToken, body: {
        'service_id': serviceId,
        'address_id': addressId,
        'schedule_slot_id': slotId,
        'scheduled_at': scheduledAt,
      }).then((v) => orderA = v).catchError((Object err) {
        errorA = err;
        return null;
      }),
      apiRequest('POST', '/orders', accessToken: customerBToken, body: {
        'service_id': serviceId,
        'address_id': addressBId,
        'schedule_slot_id': slotId,
        'scheduled_at': scheduledAt,
      }).then((v) => orderB = v).catchError((Object err) {
        errorB = err;
        return null;
      }),
    ]);

    final succeeded = [orderA, orderB].where((o) => o != null).toList();
    expect(
      succeeded,
      hasLength(1),
      reason: 'سلوت واحد لازم يتحجز مرة واحدة بس — مش الاتنين ولا صفر. '
          'الأخطاء: A=$errorA | '
          'B=$errorB',
    );
    expect([errorA, errorB].where((e) => e != null), hasLength(1), reason: 'الطرف اللي متأخر لازم يترفض بخطأ واضح');

    final createdOrder = succeeded.first!;
    expect(createdOrder['scheduled_at'], isNotNull);
    final orderId = createdOrder['id'] as String;
    final winnerToken = orderA != null ? customerAToken : customerBToken;

    // تنظيف — الإلغاء بيحرر السلوت تاني (ScheduleSlotReleaseListener)
    await apiRequest('POST', '/orders/$orderId/cancel', accessToken: winnerToken, body: {'reason': 'تنظيف اختبار حي', 'cancellation_reason_id': await pickCustomerCancellationReasonId()});
    final freedSchedule = await apiRequestList('/technicians/$technicianProfileId/schedule', accessToken: customerAToken);
    expect(freedSchedule.firstWhere((s) => s['id'] == slotId)['is_available'], isTrue);

    await apiRequest('DELETE', '/technician/schedule/$slotId', accessToken: technicianToken);
    await apiRequest('DELETE', '/addresses/$addressId', accessToken: customerAToken);
    await apiRequest('DELETE', '/addresses/$addressBId', accessToken: customerBToken);
  });
}
