import type { TechnicianLevel, TechnicianVerificationStatus } from '@baytak/shared-types';

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

// مطابق للمسار الخطي في apps/api/.../technician-verification-state-machine.ts — كل حالة
// وسيطة وخطوتها الجاية في المسار (approve/reject لسه متاحين دايماً بشكل منفصل، مش هنا).
export const NEXT_VERIFICATION_STEP: Partial<Record<TechnicianVerificationStatus, { endpoint: string; label: string }>> = {
  pending: { endpoint: 'mark-documents-submitted', label: 'تسجيل استلام المستندات' },
  documents_submitted: { endpoint: 'mark-under-review', label: 'بدء المراجعة' },
  under_review: { endpoint: 'schedule-interview', label: 'جدولة مقابلة' },
  interview_scheduled: { endpoint: 'mark-test-passed', label: 'تسجيل نجاح الاختبار' },
};
