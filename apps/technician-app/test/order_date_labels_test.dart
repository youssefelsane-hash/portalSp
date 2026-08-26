import 'package:flutter_test/flutter_test.dart';
import 'package:technician_app/features/orders/order_date_labels.dart';

void main() {
  test('موعد اليوم وبكرة لهما تسمية مختصرة', () {
    final now = DateTime(2026, 8, 26, 12);
    expect(formatScheduledDayAr('2026-08-26T10:00:00Z', now: now), 'النهاردة');
    expect(formatScheduledDayAr('2026-08-27T10:00:00Z', now: now), 'بكرة');
  });

  test('فرصة الأسبوع أو الشهر القادم تعرض التاريخ الحقيقي ولا تقول النهاردة', () {
    final label = formatScheduledDayAr(
      '2026-09-23T10:00:00Z',
      now: DateTime(2026, 8, 26, 12),
    );
    expect(label, '23/09/2026');
    expect(label, isNot('النهاردة'));
  });

  test('الطلب غير المجدول يتسمى موعد فوري بوضوح', () {
    expect(formatScheduledDayAr(null, now: DateTime(2026, 8, 26)), 'موعد فوري');
  });
}
