import { TechnicianVerificationStatus } from './entities/technician-profile.entity';

// نفس فلسفة orders/order-state-machine.ts و support/complaint-state-machine.ts —
// مصدر حقيقة واحد مقفول لانتقالات verification_status.
//
// كانت فجوة موثّقة صراحة: القاموس الأصلي بيعرّف حالات وسيطة (documents_submitted,
// under_review, interview_scheduled, test_passed) بس مفيش endpoints بنتها لسه لنقل
// الفني بينهم يدوياً (مقابلة، اختبار، ...) — اتقفلت (admin-technicians.controller.ts:
// mark-documents-submitted/mark-under-review/schedule-interview/mark-test-passed).
// القاموس مالوش أي قاعدة آلية "امتى" يتحرك الفني بين الحالات دي (مفيش تاريخ مقابلة ولا
// درجة اختبار كأعمدة فعلية في technician_profiles) — فالانتقال قرار أدمن يدوي بالكامل،
// بالظبط زي approve/reject/suspend، مش مؤتمت. المسار الخطي تحت (pending→documents_submitted→
// under_review→interview_scheduled→test_passed) هو التسلسل المنطقي الوحيد المعقول من ترتيب
// الحالات في القاموس نفسه، مش اختراع قاعدة عمل جديدة — بس الأدمن يقدر برضه يقفز مباشرة
// لـ APPROVED/REJECTED من أي نقطة (نفس السلوك القديم اتحفظ بالكامل، مفيش كسر توافق).
export const TECHNICIAN_VERIFICATION_TRANSITIONS: Record<
  TechnicianVerificationStatus,
  TechnicianVerificationStatus[]
> = {
  [TechnicianVerificationStatus.PENDING]: [
    TechnicianVerificationStatus.DOCUMENTS_SUBMITTED,
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.DOCUMENTS_SUBMITTED]: [
    TechnicianVerificationStatus.UNDER_REVIEW,
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.UNDER_REVIEW]: [
    TechnicianVerificationStatus.INTERVIEW_SCHEDULED,
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.INTERVIEW_SCHEDULED]: [
    TechnicianVerificationStatus.TEST_PASSED,
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.TEST_PASSED]: [
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.APPROVED]: [
    TechnicianVerificationStatus.SUSPENDED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.REJECTED]: [TechnicianVerificationStatus.PENDING],
  [TechnicianVerificationStatus.SUSPENDED]: [
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
};

export function canTransitionVerification(
  from: TechnicianVerificationStatus,
  to: TechnicianVerificationStatus,
): boolean {
  return TECHNICIAN_VERIFICATION_TRANSITIONS[from].includes(to);
}
