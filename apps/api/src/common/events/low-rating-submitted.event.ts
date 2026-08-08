export const LOW_RATING_SUBMITTED_EVENT = 'rating.low_rating_submitted';

export class LowRatingSubmittedEvent {
  constructor(
    public readonly ratingId: string,
    public readonly orderId: string,
    public readonly overallRating: number,
    public readonly ratedUserId: string,
    public readonly comment: string | null,
  ) {}
}
