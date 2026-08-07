export const ORDER_ACCEPTED_EVENT = 'order.accepted';

export class OrderAcceptedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly technicianId: string,
  ) {}
}
