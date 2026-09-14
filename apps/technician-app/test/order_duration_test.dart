import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/models.dart';
import 'package:technician_app/features/orders/order.dart';

void main() {
  test('reads and formats the execution duration from a technician order', () {
    final order = Order.fromJson({
      'id': 'order-1',
      'order_number': 'ORD-1',
      'order_status': 'accepted',
      'cash_to_collect_cents': 0,
      'my_earning_cents': 0,
      'has_online_payment': false,
      'fully_paid_online': false,
      'payment_status': 'pending',
      'booking_mode': 'individual',
      'duration_minutes': 120,
      'estimated_duration_days': 1,
    });

    expect(order.durationMinutes, 120);
    expect(order.estimatedDurationDays, 1);
    expect(
      formatOrderDurationAr(
        durationMinutes: order.durationMinutes,
        estimatedDurationDays: order.estimatedDurationDays,
      ),
      'ساعتان',
    );
  });

  test('uses the day estimate for multi-day work', () {
    expect(
      formatOrderDurationAr(durationMinutes: 2880, estimatedDurationDays: 2),
      'يومان',
    );
  });

  test('reads duration on an offer before the technician accepts it', () {
    final offer = AvailableOrder.fromJson({
      'assignment_id': 'assignment-1',
      'order_id': 'order-1',
      'order_number': 'ORD-1',
      'service_name_ar': 'سباكة',
      'street_name': 'شارع الاختبار',
      'distance_km': 1.5,
      'expires_at': '2026-09-14T12:00:00.000Z',
      'booking_mode': 'individual',
      'duration_minutes': 90,
      'estimated_duration_days': 1,
    });

    expect(offer.durationMinutes, 90);
    expect(offer.estimatedDurationDays, 1);
    expect(
      formatOrderDurationAr(
        durationMinutes: offer.durationMinutes,
        estimatedDurationDays: offer.estimatedDurationDays,
      ),
      '90 دقيقة',
    );
  });
}
