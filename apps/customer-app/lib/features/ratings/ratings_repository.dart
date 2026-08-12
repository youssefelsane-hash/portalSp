import '../../core/auth_repository.dart';

class RatingsRepository {
  final AuthRepository auth;

  RatingsRepository(this.auth);

  // بيرجّع الـ rating الجديد (id, overall_rating, ...) — لو الطلب ده اتقيّم قبل كده الـ API
  // بيرمي ApiException برسالة واضحة (409)، مفيش GET لمعرفة إن كان اتقيّم قبل المحاولة —
  // موثّق كفجوة صغيرة في README (مفيش endpoint تحقق مسبق، بس التعامل مع الرفض واضح للمستخدم).
  // تقييم متقدم + صور بعد الخدمة (docs/08 §9) — الأبعاد الإضافية وafterPhotoMediaIds اختياريين،
  // نفس منطق CreateRatingDto في الباك-إند بالحرف.
  Future<Map<String, dynamic>> rate(
    String orderId, {
    required int overallRating,
    int? punctualityRating,
    int? qualityRating,
    int? professionalismRating,
    int? priceFairnessRating,
    int? cleanlinessRating,
    String? comment,
    List<String>? afterPhotoMediaIds,
  }) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/rate', body: {
      'overall_rating': overallRating,
      if (punctualityRating != null) 'punctuality_rating': punctualityRating,
      if (qualityRating != null) 'quality_rating': qualityRating,
      if (professionalismRating != null) 'professionalism_rating': professionalismRating,
      if (priceFairnessRating != null) 'price_fairness_rating': priceFairnessRating,
      if (cleanlinessRating != null) 'cleanliness_rating': cleanlinessRating,
      if (comment != null && comment.isNotEmpty) 'comment': comment,
      if (afterPhotoMediaIds != null && afterPhotoMediaIds.isNotEmpty) 'after_photo_media_ids': afterPhotoMediaIds,
    });
    return data!;
  }
}
