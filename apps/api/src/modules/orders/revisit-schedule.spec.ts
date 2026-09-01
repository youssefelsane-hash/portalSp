import {
  defaultRevisitScheduledAt,
  REVISIT_EARLIEST_VISIT_DAYS,
  REVISIT_LATEST_VISIT_DAYS,
} from './revisit-schedule';

describe('defaultRevisitScheduledAt', () => {
  it('يحدد إعادة الزيارة بعد ثلاثة أيام كاملة من إنشاء الطلب', () => {
    const createdAt = new Date('2026-08-29T08:30:00.000Z');

    expect(defaultRevisitScheduledAt(createdAt)).toEqual(new Date('2026-09-01T08:30:00.000Z'));
    expect(REVISIT_EARLIEST_VISIT_DAYS).toBe(3);
    expect(REVISIT_LATEST_VISIT_DAYS).toBe(7);
  });
});
