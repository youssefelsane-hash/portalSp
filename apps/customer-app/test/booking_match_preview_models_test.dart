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
    // الترشيح التلقائي بيختار شركة ⇒ معرّفها مكانه خانة الشركة مش خانة الفني (ADR-0118).
    expect(preview.isCompany, isTrue);
  });

  test('معاينة من غير provider_kind (رد قديم) = فني', () {
    final preview = BookingMatchPreview.fromJson({
      'match_preview_id': '019fddf7-0000-0000-0000-000000000003',
      'expires_at': '2026-09-08T12:00:00.000Z',
      'selection_mode': 'auto',
      'provider': {
        'id': '019fddf7-0000-0000-0000-000000000004',
        'full_name': 'أسطى',
        'avatar_url': null,
        'current_level': 'professional',
        'average_rating': 4.8,
        'total_ratings_count': 20,
        'completed_orders_count': 40,
        'distance_km': null,
      },
      'pricing': {'total_amount_cents': 30000},
    });
    expect(preview.isCompany, isFalse);
  });

  group('حالة الإتاحة في قايمة الاختيار (ADR-0118)', () {
    TechnicianBookingListItem item(String status) =>
        TechnicianBookingListItem.fromJson({
          'id': 'x',
          'full_name': 'فني',
          'average_rating': 4.5,
          'total_ratings_count': 3,
          'availability_status': status,
        });

    test('«متاح» بس هو اللي يتحجز', () {
      expect(item('available').isUnavailable, isFalse);
      expect(item('schedule_conflicted').isUnavailable, isTrue);
      expect(item('not_eligible').isUnavailable, isTrue);
      expect(item('not_eligible').isNotEligible, isTrue);
    });

    test('أي حالة جديدة مش معروفة بتتقفل افتراضيًا — مش بتتعرض «متاح»', () {
      expect(item('some_future_status').isUnavailable, isTrue);
    });
  });
}
