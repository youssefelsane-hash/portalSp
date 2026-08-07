import { Rating } from '../entities/rating.entity';

export interface RatingResponseDto {
  id: string;
  order_id: string;
  rating_type: string;
  overall_rating: number;
  punctuality_rating: number | null;
  quality_rating: number | null;
  professionalism_rating: number | null;
  price_fairness_rating: number | null;
  comment: string | null;
  tags: string[] | null;
  created_at: string;
}

export function toRatingResponseDto(rating: Rating): RatingResponseDto {
  return {
    id: rating.id,
    order_id: rating.orderId,
    rating_type: rating.ratingType,
    overall_rating: rating.overallRating,
    punctuality_rating: rating.punctualityRating,
    quality_rating: rating.qualityRating,
    professionalism_rating: rating.professionalismRating,
    price_fairness_rating: rating.priceFairnessRating,
    comment: rating.comment,
    tags: rating.tags,
    created_at: rating.createdAt.toISOString(),
  };
}
