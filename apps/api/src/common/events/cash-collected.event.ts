export const CASH_COLLECTED_EVENT = 'payment.cash_collected';

export class CashCollectedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly amountCents: number,
    public readonly technicianUserId: string,
  ) {}
}
