export const ORDER_CREATED_EVENT = 'order.created';

export class OrderCreatedEvent {
  constructor(public readonly orderId: string) {}
}
