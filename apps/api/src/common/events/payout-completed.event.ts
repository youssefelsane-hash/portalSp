export const PAYOUT_COMPLETED_EVENT = 'payout.completed';

export class PayoutCompletedEvent {
  constructor(
    public readonly payoutId: string,
    public readonly payoutNumber: string,
    public readonly netAmountCents: number,
  ) {}
}
