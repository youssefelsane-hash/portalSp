import { bookingDateWindowViolation } from './booking-date-window';

describe('bookingDateWindowViolation', () => {
  // 11:00 صباح 28 أغسطس بتوقيت القاهرة؛ التوقيت ثابت في الاختبارات حتى لا يعتمد على ساعة الجهاز.
  const now = new Date('2026-08-28T09:00:00Z');

  it('يرفض تاريخ الأمس بدل تحويله لطوارئ', () => {
    expect(
      bookingDateWindowViolation({ scheduledAt: '2026-08-27T12:00:00+03:00', maxAdvanceDays: 90, now }),
    ).toBe('past');
  });

  it('يقبل اليوم الحالي وحد الأفق بالضبط', () => {
    expect(bookingDateWindowViolation({ scheduledAt: '2026-08-28T23:30:00+03:00', maxAdvanceDays: 90, now })).toBeNull();
    expect(bookingDateWindowViolation({ scheduledAt: '2026-11-26T12:00:00+02:00', maxAdvanceDays: 90, now })).toBeNull();
  });

  it('يرفض يومًا بعد أفق الحجز', () => {
    expect(
      bookingDateWindowViolation({ scheduledAt: '2026-11-27T12:00:00+02:00', maxAdvanceDays: 90, now }),
    ).toBe('too_far');
  });

  it('يفحص طرفي نطاق الأيام المرن حتى لا يمرر نهاية بعيدة أو ماضية', () => {
    expect(
      bookingDateWindowViolation({
        scheduledAt: '2026-08-29T12:00:00+03:00',
        scheduledAtRangeEnd: '2026-11-27T12:00:00+02:00',
        maxAdvanceDays: 90,
        now,
      }),
    ).toBe('too_far');
  });
});
