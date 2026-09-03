import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/order.dart';

// docs/08 §60.2 (طلب مالك صريح) — العقد المالي للفني اتغيّر جوهريًا: الباك-إند بقى بيفلتر
// الأرقام قبل ما تخرج على السلك، فالتطبيق بيستقبل الصورة المسموحة بس (كاش مطلوب تحصيله،
// نصيب الفني، وواقعة "مدفوع أونلاين" بلا رقم).
//
// الاختبار ده بيقفل على الـparsing: أي رجوع للحقول القديمة (paid_amount_cents وأخواتها) لازم
// يفضل بلا أثر، والحقول الجديدة لازم تتقري صح.
void main() {
  test('جزء أونلاين + جزء كاش: الكاش بالرقم، الأونلاين واقعة، والإجمالي مش موجود', () {
    final order = Order.fromJson({
      'id': 'order-1',
      'order_number': 'ORD-6200',
      'order_status': 'work_completed',
      'problem_description': null,
      // ملحوظة: مفيش total_amount_cents — الباك-إند بيشيله لما يكون فيه دفع أونلاين.
      'cash_to_collect_cents': 527000,
      'cash_collected_cents': 0,
      'my_earning_cents': 450000,
      'has_online_payment': true,
      'fully_paid_online': false,
      'payment_status': 'paid',
      'booking_mode': 'individual',
    });

    expect(order.cashToCollectCents, 527000);
    expect(order.cashCollectedCents, 0);
    expect(order.myEarningCents, 450000);
    expect(order.hasOnlinePayment, isTrue);
    expect(order.fullyPaidOnline, isFalse);
    expect(order.totalAmountCents, isNull);
  });

  test('عربون أونلاين والباقي كاش: انتظار الدفع يظل يعرض فعل حصّلت الكاش', () {
    final order = Order.fromJson({
      'id': 'order-deposit-cash',
      'order_number': 'ORD-DEPOSIT-CASH',
      'order_status': 'awaiting_payment',
      'problem_description': null,
      'cash_to_collect_cents': 85000,
      'cash_collected_cents': 0,
      'my_earning_cents': 80000,
      'has_online_payment': true,
      'fully_paid_online': false,
      'payment_status': 'partially_paid',
      'booking_mode': 'individual',
    });

    expect(order.cashToCollectCents, greaterThan(0));
    expect(order.hasOnlinePayment, isTrue);
    expect(order.fullyPaidOnline, isFalse);
    expect(nextTechnicianAction[order.orderStatus], 'collect_cash');
  });

  // docs/08 §108-B — رجريشن على قصد: الباك-إند كان بيستثني الكاش الكامل ويرجّع total_amount_cents
  // ("هو نفسه اللي هيحصّله"). المالك ألغى الاستثناء ده صراحةً: الإجمالي مش بيترجع خالص من الـAPI
  // لأي فني بعد كده، حتى لو الطلب كاش بالكامل — cash_to_collect_cents كافي لوحده للقائد/الوحيد.
  test('كله كاش: الإجمالي مش بيترجع من الـAPI خالص، cash_to_collect_cents هو المصدر الوحيد', () {
    final order = Order.fromJson({
      'id': 'order-2',
      'order_number': 'ORD-CASH',
      'order_status': 'work_completed',
      'problem_description': null,
      // ملحوظة: مفيش total_amount_cents في الرد — دلوقتي ممنوع دايمًا، مش استثناء الكاش الكامل.
      'cash_to_collect_cents': 620000,
      'cash_collected_cents': 0,
      'my_earning_cents': 500000,
      'has_online_payment': false,
      'fully_paid_online': false,
      'payment_status': 'unpaid',
      'booking_mode': 'individual',
    });

    expect(order.totalAmountCents, isNull);
    expect(order.cashToCollectCents, 620000);
    expect(order.hasOnlinePayment, isFalse);
  });

  // docs/08 §108-B — عضو الطاقم (مش القائد) بياخد cash_to_collect_cents=0 من الباك-إند دايمًا،
  // حتى لو الطلب كاش بالكامل وفيه فلوس حقيقية مستنية تحصيل من القائد. النص لازم يتكلم عن دوره
  // هو ("مفيش عليك تحصّله")، مش يدّعي إن الطلب نفسه مجاني (كان بيوقع في نفس كذبة docs/08 §64.ب
  // بس بالعكس لو سبناها على النص الافتراضي).
  test('عضو الطاقم على طلب كاش بالكامل: نص واضح إن التحصيل مش شغله، مش "مفيش كاش مطلوب"', () {
    final order = Order.fromJson({
      'id': 'order-crew-member-cash',
      'order_number': 'ORD-CREW-CASH',
      'order_status': 'work_completed',
      'problem_description': null,
      'cash_to_collect_cents': 0,
      'cash_collected_cents': 0,
      'my_earning_cents': 40000,
      'has_online_payment': false,
      'fully_paid_online': false,
      'is_crew_share': true,
      'payment_status': 'unpaid',
      'booking_mode': 'team',
    });

    expect(
      technicianCashStatusLabel(
        cashToCollectCents: order.cashToCollectCents,
        cashCollectedCents: order.cashCollectedCents,
        hasOnlinePayment: order.hasOnlinePayment,
        fullyPaidOnline: order.fullyPaidOnline,
        isCrewShare: order.isCrewShare,
        formatEgp: (cents) => '${cents ~/ 100} ج.م.',
      ),
      'مفيش كاش عليك تحصّله من العميل — ده بيتحصّل عن طريق قائد الفريق',
    );
  });

  test('كله أونلاين (تقسيط معتمد مثلاً): مفيش كاش، ونصيبه بس هو اللي بيبان', () {
    final order = Order.fromJson({
      'id': 'order-3',
      'order_number': 'ORD-INSTALLMENT',
      'order_status': 'work_completed',
      'problem_description': null,
      'cash_to_collect_cents': 0,
      'cash_collected_cents': 0,
      'my_earning_cents': 500000,
      'has_online_payment': true,
      'fully_paid_online': true,
      'payment_status': 'unpaid',
      'booking_mode': 'individual',
    });

    expect(order.cashToCollectCents, 0);
    expect(order.fullyPaidOnline, isTrue);
    expect(order.myEarningCents, 500000);
    expect(order.totalAmountCents, isNull);
  });

  test('بعد تحصيل كاش طلب مختلط: يفضل الأونلاين ظاهرًا والكاش يظهر كمُحصّل لا كمطلوب', () {
    final order = Order.fromJson({
      'id': 'order-mixed-collected',
      'order_number': 'ORD-MIXED-COLLECTED',
      'order_status': 'completed',
      'problem_description': null,
      'cash_to_collect_cents': 0,
      'cash_collected_cents': 20000,
      'my_earning_cents': 96000,
      'has_online_payment': true,
      'fully_paid_online': false,
      'payment_status': 'paid',
      'booking_mode': 'individual',
    });

    expect(order.cashCollectedCents, 20000);
    expect(
      technicianCashStatusLabel(
        cashToCollectCents: order.cashToCollectCents,
        cashCollectedCents: order.cashCollectedCents,
        hasOnlinePayment: order.hasOnlinePayment,
        fullyPaidOnline: order.fullyPaidOnline,
        isCrewShare: order.isCrewShare,
        formatEgp: (cents) => '${cents ~/ 100} ج.م.',
      ),
      'تم تحصيل الكاش وتسجيله في التسوية: 200 ج.م.',
    );
  });

  test('رد قديم من سيرفر ما اتحدّثش: القيم بتقع على صفر بأمان بدل ما ترمي', () {
    final order = Order.fromJson({
      'id': 'order-4',
      'order_number': 'ORD-LEGACY',
      'order_status': 'accepted',
      'problem_description': null,
      'payment_status': 'unpaid',
      'booking_mode': 'individual',
    });

    expect(order.cashToCollectCents, 0);
    expect(order.myEarningCents, 0);
    expect(order.hasOnlinePayment, isFalse);
    expect(order.totalAmountCents, isNull);
  });

  // بلاغ مالك (2026-09-03): «مستحقك أنت زيرو» على طلب سعره شغّال. جزء من السبب كان في التطبيق
  // نفسه — `?? 0` على حقل **غايب** بيحوّل «ما وصلنيش الرقم» لـ«الرقم صفر»، والاتنين مختلفين
  // تمامًا بالنسبة للفني. الردود العامة (OrderResponseDto) مالهاش الحقول دي أصلاً.
  test('رد بلا العقد المالي للفني: الأرقام مش بتتقال كصفر، بتتقال كـ«لسه بتتحدّث»', () {
    final order = Order.fromJson({
      'id': 'order-2',
      'order_number': 'ORD-6201',
      'order_status': 'in_progress',
      'problem_description': null,
      'total_amount_cents': 50000,
      'payment_status': 'pending',
      'booking_mode': 'individual',
    });

    expect(order.hasMoneyView, isFalse);
    expect(
      technicianEarningLabel(
        myEarningCents: order.myEarningCents,
        earningPending: order.earningPending,
        isCrewShare: order.isCrewShare,
        formatEgp: (c) => '${c ~/ 100} ج.م',
        hasMoneyView: order.hasMoneyView,
      ),
      'نصيبك: بنحدّث الرقم…',
    );
    expect(
      technicianCashStatusLabel(
        cashToCollectCents: order.cashToCollectCents,
        cashCollectedCents: order.cashCollectedCents,
        hasOnlinePayment: order.hasOnlinePayment,
        fullyPaidOnline: order.fullyPaidOnline,
        isCrewShare: order.isCrewShare,
        formatEgp: (c) => '${c ~/ 100} ج.م',
        hasMoneyView: order.hasMoneyView,
      ),
      'التحصيل من العميل: بنحدّث الرقم…',
    );
  });

  test('رد فيه العقد المالي: الأرقام بتتعرض عادي', () {
    final order = Order.fromJson({
      'id': 'order-3',
      'order_number': 'ORD-6202',
      'order_status': 'in_progress',
      'problem_description': null,
      'cash_to_collect_cents': 500000,
      'my_earning_cents': 400000,
      'payment_status': 'pending',
      'booking_mode': 'individual',
    });

    expect(order.hasMoneyView, isTrue);
    expect(
      technicianEarningLabel(
        myEarningCents: order.myEarningCents,
        earningPending: order.earningPending,
        isCrewShare: order.isCrewShare,
        formatEgp: (c) => '${c ~/ 100} ج.م',
        hasMoneyView: order.hasMoneyView,
      ),
      'نصيبك: 4000 ج.م',
    );
  });
}
