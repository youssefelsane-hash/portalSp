// عرض طلب اتحل (docs/08 §17.16) — بيتصدّر مرة لكل order_assignment لما مصيره يتحدد: قبول، رفض،
// اترفض تلقائي لأن فني تاني قبل قبله (cancelled_offer_taken)، أو انتهت مهلته من غير رد (expired).
// المستمع (notifications module) بيستخدمه عشان يوقف أي دورة تذكير critical_offer شغالة لهذا العرض
// فورًا (idempotent — safe no-op لو مفيش workflow أصلاً، وهو الغالب للعروض العادية غير الطارئة).
export const ORDER_OFFER_RESOLVED_EVENT = 'matching.order_offer_resolved';

export type OrderOfferResolution = 'accepted' | 'rejected' | 'cancelled_offer_taken' | 'expired';

export class OrderOfferResolvedEvent {
  constructor(
    public readonly assignmentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly technicianId: string,
    public readonly resolution: OrderOfferResolution,
  ) {}
}
