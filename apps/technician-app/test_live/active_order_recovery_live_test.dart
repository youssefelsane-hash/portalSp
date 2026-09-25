// اختبار حي حقيقي لـ GET /technician/orders/active (كانت فجوة موثّقة، اتقفلت) — استرجاع "الطلب
// النشط الحالي" للفني من غير ما يعرف الـ id مقدماً، عشان الشاشة الرئيسية تقدر ترجّعه تلقائياً
// لشاشة التنفيذ لو التطبيق اتقفل في نص الدورة. نفس أسلوب order_execution_live_test.dart بالظبط.
// شغّله بـ: flutter test test_live/active_order_recovery_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import 'package:technician_app/core/api_exception.dart';
import '_live_support.dart';


void main() {
  test('الفني يسترجع الطلب النشط الحالي في كل مرحلة من دورة التنفيذ', () async {
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    var technicianToken = await devTechnicianToken('+201000000045');

    // قبل أي طلب جديد — ممكن يكون فيه طلب نشط قديم من اختبار تاني، فبنقفله الأول عشان
    // الاختبار ده يبدأ من حالة معروفة (null فعلاً).
    // **حلقة** مش `if` واحدة: تشغيلة فاشلة بتسيب طلب نشط، وتشغيلتين فاشلتين بيسيبوا اتنين —
    // والـendpoint بيرجّع واحد في المرة. النسخة القديمة كانت بتنضّف واحد وتأكّد إن مفيش ولا
    // واحد، فبتفشل على بقايا التشغيلة اللي قبل السابقة (§148). السقف بيمنع حلقة لا نهائية لو
    // التنضيف نفسه بيفشل.
    for (var guard = 0; guard < 10; guard++) {
      final preExisting = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
      if (preExisting == null) break;
      final leftoverId = preExisting['id'] as String;
      final status = preExisting['order_status'] as String;
      final steps = ['accepted', 'technician_on_way', 'technician_arrived', 'in_progress'];
      for (final step in steps.skip(steps.indexOf(status))) {
        final action = {
          'accepted': 'depart',
          'technician_on_way': 'arrive',
          'technician_arrived': 'start',
          'in_progress': 'complete',
        }[step]!;
        // `complete` بيشترط صورة «بعد الشغل» — حتى في تنضيف طلب متروك من تشغيلة سابقة (§148).
        if (action == 'complete') await uploadAfterPhoto(leftoverId, technicianToken);
        await apiRequest('POST', '/technician/orders/$leftoverId/$action', accessToken: technicianToken);
      }
      await apiRequest('POST', '/technician/orders/$leftoverId/collect-cash', accessToken: technicianToken);
    }

    final noneActive = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(noneActive, isNull);

    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(servedByTechnicianToken: await devTechnicianToken('+201000000045'), sameDayCapable: true),
        // **نفس اليوم مقصود** — الاختبار ده بيقيس دورة العرض والقبول، وطلب **مجدول** بيتثبّت
        // على أنسب فني فورًا بلا أي جولة عرض (`autoConfirmScheduledOrder`, migration 0351).
        // الشرح الكامل في `urgentScheduledAt()`.
        'scheduled_at': urgentScheduledAt(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار حي لاسترجاع الطلب النشط',
      },
    );
    final orderId = order!['id'] as String;

    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع (تفاصيل فوق
    // `claimOrderAsTechnician`، §148).
    technicianToken = await claimOrderAsTechnician(orderId, '+201000000045');

    // **الفصل المقصود بين «مؤكّد قدامي» و«نشط دلوقتي»** (docs/08 §165) — والاختبار بقى بيثبته
    // صراحةً بدل ما يفترض غيابه.
    //
    // طلب **مجدول** بعد القبول مكانه `upcoming-confirmed`، ومابيدخلش `/active` غير أول ما الفني
    // يتحرّك (`technician_on_way`) — `findActiveOrdersForTechnician` فرعه الأول شرطه
    // `scheduledAt IS NULL` بالظبط عشان كده. الاختبار كان بيسأل `/active` بعد القبول وكان بيعدّي
    // بس لأن الطلبات القديمة مكانش ليها موعد؛ مع الموعد الإجباري (migration 0340) بقى مجدول فعلاً.
    final upcoming = await apiRequestList('/technician/orders/upcoming-confirmed', accessToken: technicianToken);
    final afterAccept = upcoming.firstWhere((o) => o['id'] == orderId, orElse: () => <String, dynamic>{});
    expect(afterAccept['id'], orderId, reason: 'الطلب المجدول المقبول لازم يظهر في «الشغل المؤكّد قدامي»');
    expect(afterAccept['order_status'], 'accepted');
    expect(
      await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken),
      isNull,
      reason: 'ولازم **ما يظهرش** في «النشط دلوقتي» قبل ما الفني يتحرّك — ده جوهر الفصل في §165',
    );

    await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    final afterDepart = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterDepart!['id'], orderId);
    expect(afterDepart['order_status'], 'technician_on_way');

    await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    final afterStart = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterStart!['order_status'], 'in_progress');

    await uploadAfterPhoto(orderId, technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    await apiRequest('POST', '/technician/orders/$orderId/collect-cash', accessToken: technicianToken);

    final afterCompletion = await apiRequest('GET', '/technician/orders/active', accessToken: technicianToken);
    expect(afterCompletion, isNull, reason: 'الطلب خلص، مفيش داعي يرجّع أي حاجة كـ"نشطة" تاني');

    // عميل مش فني — لازم يترفض 403
    await expectLater(
      apiRequest('GET', '/technician/orders/active', accessToken: customerToken),
      throwsA(isA<ApiException>()),
    );
  });
}
