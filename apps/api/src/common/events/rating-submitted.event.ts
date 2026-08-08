import { RatingType } from '../../modules/ratings/entities/rating.entity';

// بيتصدر لكل تقييم (مش بس المنخفض زي rating.low_rating_submitted) — الهدف إشعار مباشر
// للطرف اللي اتقيّم إنه استلم تقييم، مش توجيه لدور إداري.
export const RATING_SUBMITTED_EVENT = 'rating.submitted';

export class RatingSubmittedEvent {
  constructor(
    public readonly ratingId: string,
    public readonly orderId: string,
    public readonly ratingType: RatingType,
    public readonly overallRating: number,
    public readonly ratedUserId: string,
  ) {}
}
