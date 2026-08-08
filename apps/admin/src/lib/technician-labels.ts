import type { TechnicianLevel, TechnicianVerificationStatus } from '@baytak/shared-types';

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
