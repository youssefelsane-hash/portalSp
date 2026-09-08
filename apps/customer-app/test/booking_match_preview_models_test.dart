import 'package:customer_app/features/technicians/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('معاينة حجز شركة تقبل عدم وجود مستوى فني فردي', () {
    final preview = BookingMatchPreview.fromJson({
      'match_preview_id': '019fddf7-0000-0000-0000-000000000001',
      'expires_at': '2026-09-08T12:00:00.000Z',
      'selection_mode': 'manual',
      'provider_kind': 'company',
      'provider': {
        'id': '019fddf7-0000-0000-0000-000000000002',
        'full_name': 'شركة الصانع',
        'avatar_url': null,
        'current_level': null,
        'average_rating': 0,
        'total_ratings_count': 0,
        'completed_orders_count': 0,
        'distance_km': 2.5,
      },
      'pricing': {'total_amount_cents': 45000},
    });

    expect(preview.provider.fullName, 'شركة الصانع');
    expect(preview.provider.currentLevel, isNull);
    expect(preview.totalAmountCents, 45000);
  });
}
