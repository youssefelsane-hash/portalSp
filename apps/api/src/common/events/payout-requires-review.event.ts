export const PAYOUT_REQUIRES_REVIEW_EVENT = 'payout.requires_review';

export class PayoutRequiresReviewEvent {
  constructor(
    public readonly payoutId: string,
    public readonly payoutNumber: string,
    public readonly amountCents: number,
  ) {}
}
