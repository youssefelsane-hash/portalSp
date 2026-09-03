import '../../core/auth_repository.dart';

// تقييم الفني للعميل — كانت فجوة موثّقة صراحة: POST /technician/orders/:id/rate شغال ومختبر
// بالكامل في الباك-إند (technician_to_customer، ratings.service.ts's rateAsTechnician()) بلا
// أي كود في التطبيق بينادي عليه خالص. نفس نمط customer-app's RatingsRepository بالحرف، بس
// endpoint مختلف (فني بيقيّم عميل، مش العكس).
class RatingsRepository {
  final AuthRepository auth;

  RatingsRepository(this.auth);

  // بيرجّع الـ rating الجديد — لو الطلب ده اتقيّم قبل كده (العميل قيّم الأول، مثلاً)، الـ API
  // بيرمي ApiException برسالة واضحة (409). نفس تعامل customer-app بالضبط.
  Future<Map<String, dynamic>> rate(
    String orderId, {
    required int overallRating,
    int? punctualityRating,
    int? professionalismRating,
    String? comment,
  }) async {
    final data = await auth.authedRequest('POST', '/technician/orders/$orderId/rate', body: {
      'overall_rating': overallRating,
      'punctuality_rating': ?punctualityRating,
      'professionalism_rating': ?professionalismRating,
      if (comment != null && comment.isNotEmpty) 'comment': comment,
    });
    return data!;
  }
}
