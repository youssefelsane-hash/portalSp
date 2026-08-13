// تعيين مساعد يدوي من الأدمن بعد تصعيد مطابقة المساعد التلقائية (ADR-0008، يمتد ADR-0007 §7).
// حدث منفصل عن assistant_matching.personal_assigned (ADR-0007) عمداً — الرسالة المناسبة
// للفني مختلفة (اتعيّن من الإدارة، مش من قائد الطلب عبر رابط شخصي).
export const ORDER_ASSISTANT_ASSIGNED_MANUALLY_EVENT = 'order.assistant_assigned_manually';

export class OrderAssistantAssignedManuallyEvent {
  constructor(
    public readonly orderId: string,
    public readonly assistantTechnicianProfileId: string,
  ) {}
}
