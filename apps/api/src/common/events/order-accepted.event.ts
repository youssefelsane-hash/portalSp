export const ORDER_ACCEPTED_EVENT = 'order.accepted';

export class OrderAcceptedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly technicianId: string,
    /** موعد الطلب المستهدف لو محجوز مقدمًا (Scheduler، docs/08 §2) — null لطلب ASAP عادي. */
    public readonly scheduledAt: Date | null = null,
  ) {}
}
