import { LevelPremiumService } from './level-premium.service';

/**
 * ستَب فرق "الفني المميّز" (docs/08 §60.3) للسبيكات اللي بتبني `MatchingService` بـpositional
 * args بدل حاوية الـDI.
 *
 * الافتراضي صفر — أغلب سبيكات المطابقة بتختبر **اختيار الفني**، مش التسعير، فأي فرق سعر هنا
 * هيبقى ضوضاء. السبيكات اللي بتختبر الفرق نفسه بتبني الخدمة الحقيقية.
 */
export function levelPremiumServiceStub(premiumCents = 0): LevelPremiumService {
  return { applyOnAutoAssignment: async () => premiumCents } as unknown as LevelPremiumService;
}
