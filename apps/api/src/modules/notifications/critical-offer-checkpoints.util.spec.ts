import { computeCriticalOfferCheckpoints } from './critical-offer-checkpoints.util';

describe('computeCriticalOfferCheckpoints', () => {
  const sentAt = new Date('2026-08-14T12:00:00.000Z');
  const expiresAt = new Date('2026-08-14T12:00:30.000Z'); // نافذة 30 ثانية (عرض طوارئ عادي)

  it('بيحسب checkpoints مرتبة تصاعديًا من نِسَب متعددة', () => {
    const checkpoints = computeCriticalOfferCheckpoints(sentAt, expiresAt, [0.5, 0.85]);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].getTime()).toBe(sentAt.getTime() + 15_000);
    expect(checkpoints[1].getTime()).toBe(sentAt.getTime() + 25_500);
  });

  it('بيرتّب النِسَب حتى لو جت في ترتيب عشوائي', () => {
    const checkpoints = computeCriticalOfferCheckpoints(sentAt, expiresAt, [0.85, 0.5]);
    expect(checkpoints[0].getTime()).toBeLessThan(checkpoints[1].getTime());
  });

  it('بيستبعد النِسَب برّه (0,1) — 0 أو 1 أو سالب أو أكبر من 1', () => {
    const checkpoints = computeCriticalOfferCheckpoints(sentAt, expiresAt, [0, 1, -0.2, 1.5, 0.5]);
    expect(checkpoints).toHaveLength(1);
  });

  it('نافذة صفر أو سالبة (expiresAt <= sentAt) بترجع مصفوفة فاضية بأمان', () => {
    expect(computeCriticalOfferCheckpoints(sentAt, sentAt, [0.5])).toEqual([]);
    expect(computeCriticalOfferCheckpoints(expiresAt, sentAt, [0.5])).toEqual([]);
  });

  it('مصفوفة نِسَب فاضية بترجع مصفوفة فاضية', () => {
    expect(computeCriticalOfferCheckpoints(sentAt, expiresAt, [])).toEqual([]);
  });
});
