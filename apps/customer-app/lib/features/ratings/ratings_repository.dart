import '../../core/auth_repository.dart';

class RatingsRepository {
  final AuthRepository auth;

  RatingsRepository(this.auth);

  // بيرجّع الـ rating الجديد (id, overall_rating, ...) — لو الطلب ده اتقيّم قبل كده الـ API
  // بيرمي ApiException برسالة واضحة (409)، مفيش GET لمعرفة إن كان اتقيّم قبل المحاولة —
  // موثّق كفجوة صغيرة في README (مفيش endpoint تحقق مسبق، بس التعامل مع الرفض واضح للمستخدم).
  Future<Map<String, dynamic>> rate(
    String orderId, {
    required int overallRating,
    String? comment,
  }) async {
    final data = await auth.authedRequest('POST', '/orders/$orderId/rate', body: {
      'overall_rating': overallRating,
      if (comment != null && comment.isNotEmpty) 'comment': comment,
    });
    return data!;
  }
}
