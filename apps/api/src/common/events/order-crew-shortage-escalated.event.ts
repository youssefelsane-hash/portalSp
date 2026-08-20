// تصعيد نقص الطاقم لطلب فريق قبل الموعد بمهلة قليلة (docs/08 §35.5، ADR-0021) — نفس نمط
// order-emergency-dispatch-struggling.event.ts/order-no-technician-found.event.ts بالحرف: حدث
// بيتصدّر مرة واحدة بس لكل طلب (بوابة `crew_shortage_escalated_at` في CrewShortageEscalationService
// بتمنع التكرار)، عشان الأدمن يتدخّل يدويًا (تجنيد إضافي/تعيين إجباري) قبل ما الموعد يوصل وطاقم لسه ناقص.
export const ORDER_CREW_SHORTAGE_ESCALATED_EVENT = 'order.crew_shortage_escalated';

export class OrderCrewShortageEscalatedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly scheduledAt: Date,
    public readonly missingTechnicians: number,
    public readonly missingAssistants: number,
  ) {}
}
