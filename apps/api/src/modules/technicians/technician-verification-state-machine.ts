import { TechnicianVerificationStatus } from './entities/technician-profile.entity';

// نفس فلسفة orders/order-state-machine.ts و support/complaint-state-machine.ts —
// مصدر حقيقة واحد مقفول لانتقالات verification_status.
//
// ملحوظة تصميم مهمة: القاموس الأصلي بيعرّف حالات وسيطة (documents_submitted,
// under_review, interview_scheduled, test_passed) بس مفيش endpoints بنتها لسه
// لنقل الفني بينهم يدوياً (مقابلة، اختبار، ...) — دلوقتي الأدمن عنده قرارين بس:
// approve أو reject (admin-technicians.controller.ts). فالـ state machine هنا
// بتسمح بالانتقال المباشر لـ APPROVED/REJECTED من أي حالة وسيطة، عشان القرارين
// المتاحين فعلياً في الـ API يشتغلوا من أي نقطة يوصلها الفني. الحالات الوسيطة
// نفسها لسه من غير endpoints تحدّثها (موثّق كفجوة في technicians/README.md).
export const TECHNICIAN_VERIFICATION_TRANSITIONS: Record<
  TechnicianVerificationStatus,
  TechnicianVerificationStatus[]
> = {
  [TechnicianVerificationStatus.PENDING]: [
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.DOCUMENTS_SUBMITTED]: [
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.UNDER_REVIEW]: [
    TechnicianVerificationStatus.APPROVED,
    TechnicianVerificationStatus.REJECTED,
  ],
  [TechnicianVerificationStatus.INTERVIEW_SCHEDULED]: [
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
