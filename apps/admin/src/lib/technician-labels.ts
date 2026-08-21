import type { TechnicianCapacityTier, TechnicianLevel, TechnicianPricingTier, TechnicianVerificationStatus } from '@baytak/shared-types';

// تصريح مهارات ذاتي (Script 4 §2-7)
export const SKILL_LEVEL_LABELS: Record<string, string> = {
  beginner: 'مبتدئ',
  standard: 'متوسط',
  expert: 'خبير',
};

export const VERIFICATION_STATUS_LABELS: Record<TechnicianVerificationStatus, string> = {
  pending: 'قيد الانتظار',
  documents_submitted: 'مستندات مُرسلة',
  under_review: 'قيد المراجعة',
  interview_scheduled: 'مقابلة مجدولة',
  test_passed: 'اجتاز الاختبار',
  approved: 'معتمد',
  rejected: 'مرفوض',
  suspended: 'موقوف',
};

export const LEVEL_LABELS: Record<TechnicianLevel, string> = {
  new: 'جديد',
  verified: 'موثّق',
  professional: 'محترف',
  premium: 'مميّز',
  team_leader: 'قائد فريق',
};

export const ALL_LEVELS: TechnicianLevel[] = ['new', 'verified', 'professional', 'premium', 'team_leader'];

// فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — منفصلة تمامًا عن LEVEL_LABELS/ALL_LEVELS فوق.
export const PRICING_TIER_LABELS: Record<TechnicianPricingTier, string> = {
  standard: 'قياسي',
  expert: 'خبير',
  senior: 'كبير',
  premium: 'مميّز',
};

export const ALL_PRICING_TIERS: TechnicianPricingTier[] = ['standard', 'expert', 'senior', 'premium'];

// لغة بصرية موحّدة لتصنيف القدرة الاستيعابية (LIGHT/MEANINGFUL/HEAVY/BLOCKED) — نُقلت هنا من
// operations/page.tsx (docs/08 §36.3) عشان تُستخدَم كمان في مفتّش المطابقة بصفحة تفاصيل الطلب
// (§36.5) بلا تكرار — نفس النغمات في كل شاشة تعرض التصنيف ده (تمهيدًا لـ§36.14).
export const CAPACITY_TIER_LABELS: Record<TechnicianCapacityTier, string> = {
  LIGHT: 'خفيف',
  MEANINGFUL: 'متوسط',
  HEAVY: 'مشغول',
  BLOCKED: 'محظور',
};

export function capacityTierBadgeClass(tier: TechnicianCapacityTier): string {
  if (tier === 'LIGHT') return 'border-transparent bg-success-bg text-success';
  if (tier === 'MEANINGFUL') return 'border-transparent bg-muted text-muted-foreground';
  if (tier === 'HEAVY') return 'border-transparent bg-warning-bg text-warning';
  return 'border-transparent bg-danger-bg text-danger';
}

// مطابق للمسار الخطي في apps/api/.../technician-verification-state-machine.ts — كل حالة
// وسيطة وخطوتها الجاية في المسار (approve/reject لسه متاحين دايماً بشكل منفصل، مش هنا).
export const NEXT_VERIFICATION_STEP: Partial<Record<TechnicianVerificationStatus, { endpoint: string; label: string }>> = {
  pending: { endpoint: 'mark-documents-submitted', label: 'تسجيل استلام المستندات' },
  documents_submitted: { endpoint: 'mark-under-review', label: 'بدء المراجعة' },
  under_review: { endpoint: 'schedule-interview', label: 'جدولة مقابلة' },
  interview_scheduled: { endpoint: 'mark-test-passed', label: 'تسجيل نجاح الاختبار' },
};
