// ترشيح QR للفني (docs/11 §1) — مطابق لـ
// apps/api/src/modules/technician-referrals/dto/technician-referral-response.dto.ts.
class ReferralBonus {
  final String id;
  final String orderId;
  final int bonusAmountCents;
  final String status;
  final String? rejectionReason;
  final String? creditedAt;
  final String? revokedAt;
  final String? revokedReason;
  final String createdAt;

  ReferralBonus({
    required this.id,
    required this.orderId,
    required this.bonusAmountCents,
    required this.status,
    required this.rejectionReason,
    required this.creditedAt,
    required this.revokedAt,
    required this.revokedReason,
    required this.createdAt,
  });

  factory ReferralBonus.fromJson(Map<String, dynamic> json) => ReferralBonus(
        id: json['id'] as String,
        orderId: json['order_id'] as String,
        bonusAmountCents: json['bonus_amount_cents'] as int,
        status: json['status'] as String,
        rejectionReason: json['rejection_reason'] as String?,
        creditedAt: json['credited_at'] as String?,
        revokedAt: json['revoked_at'] as String?,
        revokedReason: json['revoked_reason'] as String?,
        createdAt: json['created_at'] as String,
      );
}

class ReferralSummary {
  final String referralToken;
  final int attributedCustomersCount;
  final int qualifyingOrdersCount;
  final int totalCreditedCents;
  final int totalRevokedCents;
  final int totalRejectedCents;
  final List<ReferralBonus> recentBonuses;

  ReferralSummary({
    required this.referralToken,
    required this.attributedCustomersCount,
    required this.qualifyingOrdersCount,
    required this.totalCreditedCents,
    required this.totalRevokedCents,
    required this.totalRejectedCents,
    required this.recentBonuses,
  });

  factory ReferralSummary.fromJson(Map<String, dynamic> json) => ReferralSummary(
        referralToken: json['referral_token'] as String,
        attributedCustomersCount: json['attributed_customers_count'] as int,
        qualifyingOrdersCount: json['qualifying_orders_count'] as int,
        totalCreditedCents: json['total_credited_cents'] as int,
        totalRevokedCents: json['total_revoked_cents'] as int,
        totalRejectedCents: json['total_rejected_cents'] as int,
        recentBonuses: (json['recent_bonuses'] as List<dynamic>)
            .cast<Map<String, dynamic>>()
            .map(ReferralBonus.fromJson)
            .toList(),
      );
}

const Map<String, String> referralBonusStatusLabelsAr = {
  'credited': 'مستحقة',
  'revoked': 'اتلغت',
  'rejected_suspicious': 'مرفوضة',
};
