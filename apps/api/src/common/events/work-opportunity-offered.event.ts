// فرصة عمل اختيارية جديدة اتعرضت على فني (docs/08 §36.1، بَقّة حقيقية اتلقطت 2026-08-20) — كانت
// فجوة موثّقة صراحة: technician_work_opportunities كان بيتعمله INSERT (matching.service.ts's
// autoConfirmScheduledOrder() لفرصة تعيين عادية context='assignment'، order-team.service.ts's
// recruitMember() لفرصة تجنيد فريق context='crew_recruit') من غير أي حدث يتصدّر خالص — عكس عرض
// order_assignments العادي (ORDER_OFFER_CREATED_EVENT فوق) اللي بيبعت push فورًا. يعني الفني
// مالوش أي إشعار حقيقي إن فرصة جديدة موجودة — لازم يفتح/يحدّث شاشة الطلبات المتاحة بنفسه عشان
// يشوفها، بعكس تجربة "طلب جديد" العادية. المستمع (notifications module) هو المسؤول عن قرار
// القناة/النص الفعلي — MatchingService/OrderTeamService مالهمش أي معرفة بالإشعارات.
export const WORK_OPPORTUNITY_OFFERED_EVENT = 'matching.work_opportunity_offered';

export class WorkOpportunityOfferedEvent {
  constructor(
    public readonly opportunityId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly technicianId: string,
    public readonly context: 'assignment' | 'crew_recruit',
    public readonly capacityTier: 'LIGHT' | 'MEANINGFUL' | 'HEAVY' | 'BLOCKED',
    public readonly scheduledAt: Date | null = null,
  ) {}
}
