export const ORDER_RESCHEDULED_EVENT = 'order.rescheduled';

// حدث مخصوص (مش ORDER_STATUS_CHANGED_EVENT العام) — إعادة الجدولة مابتغيّرش orderStatus خالص،
// فمفيش طريقة توصل عبر الحدث العام أصلاً. notifications module بيشترك فيه لإشعار الفني بشكل واضح
// (docs/08 §22 بند 9-12 — "إشعار الفني بشكل واضح").
export class OrderRescheduledEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly technicianProfileId: string,
    public readonly customerProfileId: string,
    public readonly previousScheduledAt: Date | null,
    public readonly newScheduledAt: Date,
  ) {}
}
