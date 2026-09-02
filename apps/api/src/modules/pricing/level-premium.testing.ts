import { LevelPremiumService } from './level-premium.service';

/**
 * ستَب فرق "الفني المميّز" (docs/08 §60.3) للسبيكات اللي بتبني `MatchingService` بـpositional
 * args بدل حاوية الـDI.
 *
 * الافتراضي صفر — أغلب سبيكات المطابقة بتختبر **اختيار الفني**، مش التسعير، فأي فرق سعر هنا
 * هيبقى ضوضاء. السبيكات اللي بتختبر الفرق نفسه بتبني الخدمة الحقيقية.
 */
export function levelPremiumServiceStub(premiumCents = 0): LevelPremiumService {
  return {
    applyOnAutoAssignment: async () => premiumCents,
    // ADR-0066 §3/§4 — المسارين التانيين لازم يبقوا هنا كمان، وإلا أي سبيك بتستخدم الستَب ده
    // بتفشل بـ«is not a function» بدل ما تفشل بمعنى. الستَب بيحاكي الواجهة كاملة، مش جزء منها.
    applyOnProviderSelection: async () => premiumCents,
    reverseOnProviderLost: async () => 0,
  } as unknown as LevelPremiumService;
}
