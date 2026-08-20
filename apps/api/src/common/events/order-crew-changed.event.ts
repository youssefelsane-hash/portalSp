// إدارة طاقم الطلب من الأدمن (Script 4 §22-29، §38-41) — حدث عام لأي تغيير (إضافة/إزالة/استبدال)،
// بعكس order-assistant-assigned-manually.event.ts اللي مقصور على "مساعد" بس (ADR-0008). الفرق
// المتعمّد: العضو المُضاف ميوافقش على الإضافة (زي "معاه مساعد؟")، فمفيش قرار يُنتظر منه — إشعار بس.
export const ORDER_CREW_CHANGED_EVENT = 'order.crew_changed';

export type CrewChangeType = 'added' | 'removed' | 'replaced';

// مين عمل الإضافة/الاستبدال — بيتحكم في نص الإشعار بس (docs/08 §31: تجنيد ذاتي من الفني القائد،
// بعكس §22-29 اللي كانت أدمن بس). افتراضي 'admin' في كل نداءات الأدمن الموجودة (تمرير صريح تحت).
export type CrewChangeActorType = 'admin' | 'technician';

export class OrderCrewChangedEvent {
  constructor(
    public readonly orderId: string,
    public readonly changeType: CrewChangeType,
    public readonly addedTechnicianProfileId: string | null,
    public readonly removedTechnicianProfileId: string | null,
    public readonly addedByType: CrewChangeActorType = 'admin',
  ) {}
}
