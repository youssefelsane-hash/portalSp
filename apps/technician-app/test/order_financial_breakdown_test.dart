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

  test('كله كاش: الإجمالي بيرجع من الـAPI وبيساوي الكاش المطلوب تحصيله', () {
    final order = Order.fromJson({
      'id': 'order-2',
      'order_number': 'ORD-CASH',
      'order_status': 'work_completed',
      'problem_description': null,
      'total_amount_cents': 620000,
      'cash_to_collect_cents': 620000,
      'cash_collected_cents': 0,
      'my_earning_cents': 500000,
      'has_online_payment': false,
      'fully_paid_online': false,
      'payment_status': 'unpaid',
      'booking_mode': 'individual',
    });

    expect(order.totalAmountCents, 620000);
    expect(order.cashToCollectCents, 620000);
    expect(order.hasOnlinePayment, isFalse);
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
}
