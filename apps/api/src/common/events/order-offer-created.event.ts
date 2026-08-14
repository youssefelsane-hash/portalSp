// عرض طلب جديد اتبعت لفني (docs/08 §17.16) — يتصدّر لكل صف order_assignments جديد اتعمل في
// MatchingService.dispatchNextRound()، عادي كان أو طوارئ (isEmergency). المستمع (notifications
// module) هو المسؤول عن قرار القناة/الأولوية الفعلية — MatchingService مالوش أي معرفة بالإشعارات.
export const ORDER_OFFER_CREATED_EVENT = 'matching.order_offer_created';

export class OrderOfferCreatedEvent {
  constructor(
    public readonly assignmentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly technicianId: string,
    public readonly isEmergency: boolean,
    public readonly sentAt: Date,
    public readonly expiresAt: Date,
  ) {}
}
