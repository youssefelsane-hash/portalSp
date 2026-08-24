import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/order.dart';

void main() {
  test(
    'technician order parses deposit totals without showing the full order as collectible',
    () {
      final order = Order.fromJson({
        'id': 'order-1',
        'order_number': 'ORD-6200',
        'order_status': 'work_completed',
        'problem_description': null,
        'total_amount_cents': 620000,
        'paid_amount_cents': 93000,
        'financed_order_amount_cents': 0,
        'refunded_amount_cents': 0,
        'installment_outstanding_cents': 0,
        'amount_due_to_technician_cents': 527000,
        'payment_status': 'paid',
        'booking_mode': 'individual',
      });

      expect(order.totalAmountCents, 620000);
      expect(order.paidAmountCents, 93000);
      expect(order.amountDueToTechnicianCents, 527000);
    },
  );

  test('approved financing is separate from cash collectible amount', () {
    final order = Order.fromJson({
      'id': 'order-2',
      'order_number': 'ORD-INSTALLMENT',
      'order_status': 'work_completed',
      'problem_description': null,
      'total_amount_cents': 620000,
      'paid_amount_cents': 0,
      'financed_order_amount_cents': 620000,
      'refunded_amount_cents': 0,
      'installment_outstanding_cents': 682000,
      'amount_due_to_technician_cents': 0,
      'payment_status': 'unpaid',
      'booking_mode': 'individual',
    });

    expect(order.financedOrderAmountCents, 620000);
    expect(order.installmentOutstandingCents, 682000);
    expect(order.amountDueToTechnicianCents, 0);
  });
}
