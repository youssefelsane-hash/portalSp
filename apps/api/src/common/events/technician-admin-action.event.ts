export const TECHNICIAN_ADMIN_ACTION_EVENT = 'technician.admin_action';

/**
 * docs/08 §64.هـ — الشق التاني من بلاغ المالك: «كذلك برضه الـnotifications بتاعت الصنايعي،
 * المفروض لما الأدمين يعمل أي أكشن، المفروض يوصل للصنايعي يوصله notification».
 *
 * انتقالات حالة التوثيق (approve/reject/suspend/interview/…) كان عندها أحداث خاصة بيها من قبل.
 * اللي كان **ساكت تمامًا** هو كل الباقي: علامة التوثيق، تغيير المستوى، فئة التسعير، مراجعة
 * مستند/شهادة — كلها بتتسجّل في `audit_log` وبس، والفني يكتشفها بالصدفة لو فتح بروفايله.
 *
 * زي `ProjectActivityEvent` بالظبط: حدث واحد بـ`kind`، عشان أي أكشن أدمن جديد يحتاج سطر emit
 * واحد بس مش listener جديد.
 */
export class TechnicianAdminActionEvent {
  constructor(
    /** يوزر الفني (مش profile id) — أو صاحب الشركة في أكشنات الشركات. */
    public readonly userId: string,
    public readonly kind: string,
    public readonly titleAr: string,
    public readonly bodyAr: string,
    public readonly referenceType: 'technician_profile' | 'technician_company',
    public readonly referenceId: string,
  ) {}
}
