import { computeScheduledJobCheckpoints } from './scheduled-job-checkpoints.util';

// كل الأوقات UTC (نفس اتفاقية المشروع).
function utc(y: number, m: number, d: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(y, m, d, hour, minute, 0));
}

const SETTINGS = { afterMinutes: 60, dayBeforeHourUtc: 8, preAppointmentMinutes: 120 };

describe('scheduled-job-checkpoints.util', () => {
  it('موعد بعيد (أسبوع) — التلاتة checkpoints موجودين ومرتبين', () => {
    const createdAt = utc(2026, 0, 1, 10, 0);
    const targetAt = utc(2026, 0, 8, 14, 0); // بعد أسبوع، 2pm
    const checkpoints = computeScheduledJobCheckpoints(createdAt, targetAt, SETTINGS);

    expect(checkpoints).toHaveLength(3);
    expect(checkpoints[0]).toEqual(utc(2026, 0, 1, 11, 0)); // +60 دقيقة من الإنشاء
    expect(checkpoints[1]).toEqual(utc(2026, 0, 7, 8, 0)); // صبح يوم قبل الموعد، 8am UTC
    expect(checkpoints[2]).toEqual(utc(2026, 0, 8, 12, 0)); // قبل الموعد بساعتين
  });

  it('موعد قريب جدًا (بعد 30 دقيقة) — كل الـcheckpoints بره النطاق، مفيش تذكيرات خالص', () => {
    const createdAt = utc(2026, 0, 1, 10, 0);
    const targetAt = utc(2026, 0, 1, 10, 30);
    expect(computeScheduledJobCheckpoints(createdAt, targetAt, SETTINGS)).toHaveLength(0);
  });

  it('موعد بكرة (يوم واحد بس) — checkpoint اليوم اللي قبله ممكن يكون فات، بس الباقي موجود', () => {
    const createdAt = utc(2026, 0, 1, 10, 0);
    const targetAt = utc(2026, 0, 2, 9, 0); // بكرة الساعة 9 الصبح
    const checkpoints = computeScheduledJobCheckpoints(createdAt, targetAt, SETTINGS);

    // checkpoint "اليوم اللي قبله 8am" = utc(2026,0,1,8,0) — قبل createdAt (10am) فعلاً، بيتفلتر.
    expect(checkpoints.some((c) => c.getUTCDate() === 1 && c.getUTCHours() === 8)).toBe(false);
    // +60 دقيقة من الإنشاء (11am) و"قبل الموعد بساعتين" (7am بكرة) لسه موجودين ومرتبين.
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toEqual(utc(2026, 0, 1, 11, 0));
    expect(checkpoints[1]).toEqual(utc(2026, 0, 2, 7, 0));
  });

  it('checkpoint بره النطاق [الإنشاء, الموعد) بيتفلتر — الترتيب دايمًا تصاعدي', () => {
    const createdAt = utc(2026, 0, 1, 10, 0);
    const targetAt = utc(2026, 0, 3, 10, 0);
    const checkpoints = computeScheduledJobCheckpoints(createdAt, targetAt, SETTINGS);
    for (let i = 1; i < checkpoints.length; i++) {
      expect(checkpoints[i].getTime()).toBeGreaterThan(checkpoints[i - 1].getTime());
    }
    for (const c of checkpoints) {
      expect(c.getTime()).toBeGreaterThan(createdAt.getTime());
      expect(c.getTime()).toBeLessThan(targetAt.getTime());
    }
  });
});
