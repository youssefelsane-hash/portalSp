export const SUPPORT_TICKET_CREATED_EVENT = 'support_ticket.created';

// الحدث ده لتحديث واجهة الإدارة فقط بعد نجاح الحفظ. لا يحمل أي قرار أعمال ولا يعيد تنفيذ
// إنشاء التذكرة، لذلك تعثر مستمع مثل Socket.IO لا يمكنه أن يغيّر نتيجة طلب العميل.
export class SupportTicketCreatedEvent {
  constructor(
    public readonly ticketId: string,
    public readonly ticketNumber: string,
  ) {}
}
