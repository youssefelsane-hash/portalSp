// وسائل الدفع المحفوظة (docs/08 §21) — مطابق لـ
// apps/api/src/modules/payments/dto/payments-response.dto.ts's SavedPaymentMethodResponseDto.
// صفر رقم كارت خام هنا — masked_pan بس (آخر 4 أرقام)، الحفظ الفعلي بيحصل عبر ويب-هوك Paymob
// وقت أول دفع بكارت، مش عبر إدخال بيانات هنا.
class SavedPaymentMethod {
  final String id;
  final String provider;
  final String? cardBrand;
  final String? maskedPan;
  final bool isDefault;
  final String createdAt;

  SavedPaymentMethod({
    required this.id,
    required this.provider,
    required this.cardBrand,
    required this.maskedPan,
    required this.isDefault,
    required this.createdAt,
  });

  factory SavedPaymentMethod.fromJson(Map<String, dynamic> json) => SavedPaymentMethod(
        id: json['id'] as String,
        provider: json['provider'] as String,
        cardBrand: json['card_brand'] as String?,
        maskedPan: json['masked_pan'] as String?,
        isDefault: json['is_default'] as bool,
        createdAt: json['created_at'] as String,
      );
}
