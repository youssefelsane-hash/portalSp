// نقاط الولاء (docs/08) — مطابق لـ apps/api/src/modules/promotions/dto/loyalty-transaction-response.dto.ts.
class LoyaltyTransaction {
  final String id;
  final int pointsAmount;
  final String direction;
  final String source;
  final int balanceAfter;
  final String createdAt;

  LoyaltyTransaction({
    required this.id,
    required this.pointsAmount,
    required this.direction,
    required this.source,
    required this.balanceAfter,
    required this.createdAt,
  });

  factory LoyaltyTransaction.fromJson(Map<String, dynamic> json) => LoyaltyTransaction(
        id: json['id'] as String,
        pointsAmount: json['points_amount'] as int,
        direction: json['direction'] as String,
        source: json['source'] as String,
        balanceAfter: json['balance_after'] as int,
        createdAt: json['created_at'] as String,
      );
}

// مطابق لـ LoyaltyDirection enum في الباك-إند بالحرف.
const Map<String, String> loyaltyDirectionLabelsAr = {
  'earn': 'اكتساب',
  'redeem': 'استبدال',
  'expire': 'انتهاء صلاحية',
};

// مطابق لـ LoyaltySource enum بالحرف.
const Map<String, String> loyaltySourceLabelsAr = {
  'order': 'طلب',
  'referral': 'ترشيح صديق',
  'review': 'تقييم',
  'promotion': 'عرض ترويجي',
  'manual': 'تعديل يدوي',
};
