// مطابقة المساعد التلقائية (ADR-0007) — مطابق لـ
// apps/api/src/modules/assistant-matching/dto/assistant-offer-response.dto.ts (AssistantOfferResponseDto).
class AssistantOffer {
  final String offerId;
  final String orderId;
  final String orderNumber;
  final String serviceNameAr;
  final String? problemDescription;
  final String streetName;
  final String? landmark;
  final DateTime expiresAt;

  AssistantOffer({
    required this.offerId,
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.problemDescription,
    required this.streetName,
    required this.landmark,
    required this.expiresAt,
  });

  factory AssistantOffer.fromJson(Map<String, dynamic> json) => AssistantOffer(
        offerId: json['offer_id'] as String,
        orderId: json['order_id'] as String,
        orderNumber: json['order_number'] as String,
        serviceNameAr: json['service_name_ar'] as String,
        problemDescription: json['problem_description'] as String?,
        streetName: json['street_name'] as String,
        landmark: json['landmark'] as String?,
        expiresAt: DateTime.parse(json['expires_at'] as String),
      );
}
