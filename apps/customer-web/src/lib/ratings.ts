// نفس الاتفاقية المتبعة في كل ملفات lib هنا (orders.ts/chat.ts/…): النوع متعرّف محليًا مش مستورد.
type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * تقييم الطلب بعد اكتماله (`POST /orders/:id/rate`).
 *
 * كان موجود في `apps/customer-app` بس ومفقود من الويب بالكامل — يعني عميل الويب عمره ما كان
 * يقدر يقيّم طلب، والتقييم ده مش رفاهية: منه بيتحسب متوسط تقييم الفني اللي بيدخل في الترتيب
 * والمطابقة. الحقول هنا **مطابقة بالحرف** لـ`CreateRatingDto` في الباك-إند ولنفس الأبعاد
 * المعروضة في `rating_dialog.dart` — مفيش حقل زيادة ولا ناقص بين الواجهتين.
 */
export interface CreateRatingBody {
  overall_rating: number;
  punctuality_rating?: number;
  quality_rating?: number;
  professionalism_rating?: number;
  price_fairness_rating?: number;
  cleanliness_rating?: number;
  comment?: string;
}

/** طلب مراجعة Google بعد تقييم عالي — الرابط بيتحط من الأدمن، والباك-إند بيقرر يظهر ولا لأ. */
export interface GoogleReviewPromptDto {
  should_prompt: boolean;
  review_url: string | null;
}

export interface RatingResponseDto {
  id: string;
  order_id: string;
  overall_rating: number;
  comment: string | null;
  created_at: string;
  google_review_prompt: GoogleReviewPromptDto;
}

export const rateOrder = (authedFetch: AuthedFetch, orderId: string, body: CreateRatingBody) =>
  authedFetch<RatingResponseDto>(`/orders/${orderId}/rate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
