import { Rating } from '../entities/rating.entity';

export interface RatingAfterPhotoDto {
  id: string;
  file_url: string;
}

// طلب مراجعة Google (docs/10 بند 40) — بعد تقييم عميل عالي، مع رابط مراجعة حقيقي متحط من الأدمن.
export interface GoogleReviewPromptResponseDto {
  should_prompt: boolean;
  review_url: string | null;
}

export interface RatingResponseDto {
  id: string;
  order_id: string;
  rating_type: string;
  overall_rating: number;
  punctuality_rating: number | null;
  quality_rating: number | null;
  professionalism_rating: number | null;
  price_fairness_rating: number | null;
  cleanliness_rating: number | null;
  comment: string | null;
  tags: string[] | null;
  created_at: string;
  after_photos: RatingAfterPhotoDto[];
  google_review_prompt: GoogleReviewPromptResponseDto;
}

export function toRatingResponseDto(
  rating: Rating,
  afterPhotos: { id: string; fileUrl: string }[] = [],
  googleReviewPrompt: { shouldPrompt: boolean; reviewUrl: string | null } = { shouldPrompt: false, reviewUrl: null },
): RatingResponseDto {
  return {
    id: rating.id,
    order_id: rating.orderId,
    rating_type: rating.ratingType,
    overall_rating: rating.overallRating,
    punctuality_rating: rating.punctualityRating,
    quality_rating: rating.qualityRating,
    professionalism_rating: rating.professionalismRating,
    price_fairness_rating: rating.priceFairnessRating,
    cleanliness_rating: rating.cleanlinessRating,
    comment: rating.comment,
    tags: rating.tags,
    created_at: rating.createdAt.toISOString(),
    after_photos: afterPhotos.map((p) => ({ id: p.id, file_url: p.fileUrl })),
    google_review_prompt: { should_prompt: googleReviewPrompt.shouldPrompt, review_url: googleReviewPrompt.reviewUrl },
  };
}
