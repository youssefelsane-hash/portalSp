// اختبار حي حقيقي لدورة تنفيذ الطلب كاملة (قبول → انطلاق → وصول → بدء → خلاص → تحصيل كاش)
// ضد apps/api الشغال فعلاً — نفس أسلوب technician_orders_live_test.dart بالظبط.
// شغّله بـ: flutter test test_live/order_execution_live_test.dart --dart-define=API_BASE_URL=http://localhost:3000/api/v1
import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/core/api_client.dart';
import '_live_support.dart';


void main() {
  test('فني حقيقي يقبل طلب حقيقي وينفّذه لحد التحصيل', () async {
    // العميل بيطلب في نطاق "اختبار المهلة" (القاهرة) — الفني ده بس المتاح فيه، فمفيش لبس
    // في مين هياخد الطلب لما نجيب /technician/orders/available.
    // عميل جديد لكل تشغيلة بدل رقم ثابت مشترك — الـthrottle بيتعقّب بالرقم (٥ OTP/دقيقة)
    // فملفات متعددة على نفس الرقم كانت بتاكل حصة بعض. (تدقيق §148)
    final customerToken = await registerCustomer(uniquePhone());
    // توكن الفني **قبل** إنشاء الطلب: اختيار الخدمة محتاجه عشان يتأكد إن الفني ده بيخدمها.
    var technicianToken = await devTechnicianToken('+201000000042');
    final order = await apiRequest(
      'POST',
      '/orders',
      accessToken: customerToken,
      body: {
        'service_id': await pickBookableServiceId(servedByTechnicianToken: technicianToken, sameDayCapable: true),
        // **نفس اليوم مقصود** — الاختبار ده بيقيس دورة العرض والقبول، وطلب **مجدول** بيتثبّت
        // على أنسب فني فورًا بلا أي جولة عرض (`autoConfirmScheduledOrder`, migration 0351).
        // الشرح الكامل في `urgentScheduledAt()`.
        'scheduled_at': urgentScheduledAt(),
        'address_id': await ensureAddressFor(customerToken),
        'problem_description': 'اختبار حي لدورة تنفيذ الفني',
      },
    );
    final orderId = order!['id'] as String;
    expect(order['order_status'], 'searching_technician');

    // **التأكيد القديم اتشال**: كان بيتوقّع إن الطلب يظهر في قايمة عروض `+201000000042`
    // بالتحديد، بحجة إن «الفني ده بس المتاح في النطاق». الافتراض ده مات أول ما البذور ضافت
    // فنيين كتير لنفس النطاق — القياس: **١٠ عروض** اتبعتت في الجولة الأولى ومحدش منهم كان
    // الفني ده. التأكيد كان بيختبر **تفضيلات محرك المطابقة**، وهو مش موضوع الاختبار ده أصلاً.
    //
    // `claimOrderAsTechnician` تحت بتغطّي اللي محتاجينه فعلاً: بتجرّب الفني المفضّل، ولو العرض
    // راح لحد تاني بتلاقيه وتكمّل بيه، وبترمي رسالة واضحة لو التوزيع نفسه مااشتغلش.

    // الفني اللي العرض راح له فعلاً — المنصّة هي اللي بتوزّع (تفاصيل فوق
    // `claimOrderAsTechnician`، §148).
    technicianToken = await claimOrderAsTechnician(orderId, '+201000000042');
    // **الطلب المجدول المقبول مكانه «الشغل المؤكّد قدامي» مش «الطلب النشط»** (docs/08 §165).
    //
    // `GET /technician/orders/active` بيستثني عمدًا الطلبات اللي ليها `scheduled_at` ولسه الفني
    // ما اتحرّكش ليها (`findActiveOrdersForTechnician` — الفرع الأول شرطه `scheduledAt IS NULL`).
    // الطلب بيدخل «النشط» أول ما يبقى `technician_on_way` أو بعدها.
    //
    // الاختبار كان بيسأل `/active` بعد القبول على طول، وكان بيعدّي بس لأن الطلبات القديمة مكانش
    // ليها موعد أصلاً. مع الموعد الإجباري (migration 0340) الطلب بقى مجدول فعلاً، فبنسأله من
    // مكانه الصح.
    final upcoming = await apiRequestList('/technician/orders/upcoming-confirmed', accessToken: technicianToken);
    final accepted = upcoming.firstWhere((o) => o['id'] == orderId, orElse: () => <String, dynamic>{});
    expect(accepted['order_status'], 'accepted');

    final departed =
        await apiRequest('POST', '/technician/orders/$orderId/depart', accessToken: technicianToken);
    expect(departed!['order_status'], 'technician_on_way');

    final arrived =
        await apiRequest('POST', '/technician/orders/$orderId/arrive', accessToken: technicianToken);
    expect(arrived!['order_status'], 'technician_arrived');

    final started = await apiRequest('POST', '/technician/orders/$orderId/start', accessToken: technicianToken);
    expect(started!['order_status'], 'in_progress');

    await uploadAfterPhoto(orderId, technicianToken);
    final completed =
        await apiRequest('POST', '/technician/orders/$orderId/complete', accessToken: technicianToken);
    expect(completed!['order_status'], 'work_completed');

    final payment = await apiRequest(
      'POST',
      '/technician/orders/$orderId/collect-cash',
      accessToken: technicianToken,
    );
    expect(payment!['payment_method'], 'cash');
    expect(payment['payment_status'], 'succeeded');
  });
}
