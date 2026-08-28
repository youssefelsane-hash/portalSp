import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/models.dart';

// **بلاغ مالك حقيقي (docs/08 §85، ADR-0048 §4)**: «الطلب بيخش أوتوماتيك على هاي الطوارئ، وأحيانًا
// ممكن يكون بكرة، وفي الطوارئ ما بيظهرش معاد».
//
// السبب الجذري مكانش شكل الكارت — كان إن `GET /technician/available-orders` مكانش بيرجّع
// `booking_mode` ولا `scheduled_at` أصلاً، فالتطبيق **مستحيل** يفرّق. الاختبارات دي بتقفل الفجوة
// دي عند حدود الـAPI نفسها: لو حد شال الحقلين من الاستعلام تاني، ده بيفشل هنا مش في عين المالك.
void main() {
  Map<String, dynamic> payload({String? bookingMode, String? scheduledAt}) => {
        'assignment_id': 'a1',
        'order_id': 'o1',
        'order_number': 'ORD-1001',
        'service_name_ar': 'سباكة',
        'problem_description': null,
        'street_name': 'شارع 9',
        'landmark': null,
        'distance_km': '3.2',
        'expires_at': '2026-08-28T12:00:00Z',
        if (bookingMode != null) 'booking_mode': bookingMode,
        if (scheduledAt != null) 'scheduled_at': scheduledAt,
      };

  group('AvailableOrder — التفرقة بين الطوارئ والشغل القريب', () {
    test('طوارئ: isEmergency صح ومفيش معاد (وده الصح)', () {
      final order = AvailableOrder.fromJson(payload(bookingMode: 'emergency'));
      expect(order.isEmergency, isTrue);
      expect(order.scheduledAt, isNull);
    });

    test('شغل قريب عادي: isEmergency غلط والمعاد موجود', () {
      final order = AvailableOrder.fromJson(
        payload(bookingMode: 'individual', scheduledAt: '2026-08-29T06:00:00Z'),
      );
      expect(order.isEmergency, isFalse);
      expect(order.scheduledAt, '2026-08-29T06:00:00Z');
    });

    test('حجز فريق قريب: برضه مش طوارئ — الحجم مش استعجال', () {
      final order = AvailableOrder.fromJson(
        payload(bookingMode: 'team', scheduledAt: '2026-08-30T06:00:00Z'),
      );
      expect(order.isEmergency, isFalse);
    });

    // نسخة سيرفر قديمة (قبل ADR-0048) مابترجّعش الحقلين. التطبيق لازم يفضل شغّال — الشاشة دي هي
    // شاشة الشغل الرئيسية للفني، ووقوعها بـcast error معناه إنه مش شايف شغله خالص.
    test('سيرفر قديم بلا الحقلين: بيرجع للسلوك القديم بأمان بدل ما يقع', () {
      final order = AvailableOrder.fromJson(payload());
      expect(order.isEmergency, isTrue);
      expect(order.scheduledAt, isNull);
    });
  });
}
