// إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) — حدث عام لأي تغيير (إضافة/إزالة/استبدال)،
// بعكس order-assistant-assigned-manually.event.ts اللي مقصور على "مساعد" بس (ADR-0008). الفرق
// المتعمّد: العضو المُضاف ميوافقش على الإضافة (زي "معاه مساعد؟")، فمفيش قرار يُنتظر منه — إشعار بس.
export const ORDER_CREW_CHANGED_EVENT = 'order.crew_changed';

export type CrewChangeType = 'added' | 'removed' | 'replaced';

export class OrderCrewChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly changeType: CrewChangeType,
    public readonly addedTechnicianProfileId: string | null,
    public readonly removedTechnicianProfileId: string | null,
  ) {}
}
