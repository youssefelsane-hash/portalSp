import '../../core/auth_repository.dart';
import '../orders/models.dart';

class PendingCustomerRating {
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String technicianName;
  final DateTime completedAt;

  const PendingCustomerRating({
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.technicianName,
    required this.completedAt,
  });

  factory PendingCustomerRating.fromJson(Map<String, dynamic> json) =>
      PendingCustomerRating(
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        technicianName: json['technician_name'] as String,
        completedAt: DateTime.parse(json['completed_at'] as String),
      );
}

class RatingsRepository {
  final AuthRepository auth;

  RatingsRepository(this.auth);

  Future<List<PendingCustomerRating>> pending() async {
    final items = await auth.authedRequestList('/ratings/pending');
    return items.map(PendingCustomerRating.fromJson).toList();
  }

  Future<List<OrderMedia>> afterPhotos(String orderId) async {
    final items = await auth.authedRequestList('/orders/$orderId/media');
    return items
        .map(OrderMedia.fromJson)
        .where((item) => item.mediaType == 'after_photo')
        .toList();
  }

  // بيرجّع الـ rating الجديد (id, overall_rating, ...) — لو نفس اتجاه التقييم اتبعت قبل كده
  // الـ API بيرمي ApiException برسالة واضحة (409). `pending()` يمنع المحاولة المكررة في المسار
  // الطبيعي، والـ409 يظل خط الدفاع ضد ضغطتين متزامنتين أو جهازين لنفس العميل.
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
    final data = await auth.authedRequest(
      'POST',
      '/orders/$orderId/rate',
      body: {
        'overall_rating': overallRating,
        'punctuality_rating': ?punctualityRating,
        'quality_rating': ?qualityRating,
        'professionalism_rating': ?professionalismRating,
        'price_fairness_rating': ?priceFairnessRating,
        'cleanliness_rating': ?cleanlinessRating,
        if (comment != null && comment.isNotEmpty) 'comment': comment,
        if (afterPhotoMediaIds != null && afterPhotoMediaIds.isNotEmpty)
          'after_photo_media_ids': afterPhotoMediaIds,
      },
    );
    return data!;
  }
}
