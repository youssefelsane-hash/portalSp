import 'package:customer_app/features/orders/models.dart';
import 'package:customer_app/features/orders/orders_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('payment channel keeps readiness reason instead of silently disappearing', () {
    final channel = PaymentChannelAvailability.fromJson({
      'method': 'card',
      'is_enabled': true,
      'is_configured': false,
      'is_available': false,
      'unavailable_reason': 'إعداد Paymob غير مكتمل: HMAC Secret',
    });

    expect(channel.enabled, isTrue);
    expect(channel.available, isFalse);
    expect(channel.unavailableReason, contains('HMAC'));
  });

  test('price preview reads the optional warranty as a separate amount', () {
    final preview = OrderPricePreview.fromJson({
      'base_price_cents': 100000,
      'inspection_fee_cents': 0,
      'min_price_cents': null,
      'max_price_cents': null,
      'emergency_surcharge_cents': 0,
      'emergency_sla_minutes': null,
      'addons': <dynamic>[],
      'addons_total_cents': 0,
      'warranty_price_cents': 30000,
      'subtotal_before_discount_cents': 100000,
      'discount_cents': 0,
      'discount_source': null,
      'total_amount_cents': 130000,
      'estimated_duration_days': null,
      'deposit_amount_cents': 39000,
      'due_now_cents': 39000,
      'remaining_amount_cents': 91000,
    });

    expect(preview.warrantyPriceCents, 30000);
    expect(preview.totalAmountCents, 130000);
    expect(preview.depositAmountCents, 39000);
  });
}
