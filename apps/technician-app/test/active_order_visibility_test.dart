import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/active_order_visibility.dart';
import 'package:technician_app/features/orders/order.dart';

void main() {
  Order order(String id, {String status = 'in_progress'}) => Order(
    id: id,
    orderNumber: 'ORD-$id',
    orderStatus: status,
    problemDescription: null,
    cashToCollectCents: 0,
    myEarningCents: 100,
    hasOnlinePayment: false,
    fullyPaidOnline: false,
    paymentStatus: 'pending',
    bookingMode: 'individual',
  );

  test('keeps every concurrent active order while replacing stale copies', () {
    final first = order('first');
    final second = order('second');
    final refreshedFirst = order('first', status: 'work_completed');

    final visible = rememberActiveOrder(
      rememberActiveOrder([first], second),
      refreshedFirst,
    );

    expect(visible.map((item) => item.id), ['first', 'second']);
    expect(visible.first.orderStatus, 'work_completed');
  });

  test('does not repeat an active order in the upcoming section', () {
    final active = order('active');
    final upcoming = order('upcoming', status: 'accepted');

    expect(
      excludeActiveOrders([active, upcoming], [active]).map((item) => item.id),
      ['upcoming'],
    );
  });
}
