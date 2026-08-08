// مطابق لـ apps/api/src/modules/payments/dto/payments-response.dto.ts
class Wallet {
  final int balanceCents;
  final int pendingBalanceCents;
  final int totalEarnedCents;
  final int totalWithdrawnCents;
  final bool isFrozen;

  Wallet({
    required this.balanceCents,
    required this.pendingBalanceCents,
    required this.totalEarnedCents,
    required this.totalWithdrawnCents,
    required this.isFrozen,
  });

  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(
        balanceCents: json['balance_cents'] as int,
        pendingBalanceCents: json['pending_balance_cents'] as int,
        totalEarnedCents: json['total_earned_cents'] as int,
        totalWithdrawnCents: json['total_withdrawn_cents'] as int,
        isFrozen: json['is_frozen'] as bool,
      );
}

class WalletTransaction {
  final String id;
  final String direction;
  final String transactionType;
  final int amountCents;
  final int balanceAfterCents;
  final String? descriptionAr;
  final String createdAt;

  WalletTransaction({
    required this.id,
    required this.direction,
    required this.transactionType,
    required this.amountCents,
    required this.balanceAfterCents,
    required this.descriptionAr,
    required this.createdAt,
  });

  factory WalletTransaction.fromJson(Map<String, dynamic> json) => WalletTransaction(
        id: json['id'] as String,
        direction: json['direction'] as String,
        transactionType: json['transaction_type'] as String,
        amountCents: json['amount_cents'] as int,
        balanceAfterCents: json['balance_after_cents'] as int,
        descriptionAr: json['description_ar'] as String?,
        createdAt: json['created_at'] as String,
      );
}

class Payout {
  final String id;
  final String payoutNumber;
  final int amountCents;
  final int netAmountCents;
  final String payoutMethod;
  final String payoutStatus;
  final String requestedAt;
  final String? completedAt;

  Payout({
    required this.id,
    required this.payoutNumber,
    required this.amountCents,
    required this.netAmountCents,
    required this.payoutMethod,
    required this.payoutStatus,
    required this.requestedAt,
    required this.completedAt,
  });

  factory Payout.fromJson(Map<String, dynamic> json) => Payout(
        id: json['id'] as String,
        payoutNumber: json['payout_number'] as String,
        amountCents: json['amount_cents'] as int,
        netAmountCents: json['net_amount_cents'] as int,
        payoutMethod: json['payout_method'] as String,
        payoutStatus: json['payout_status'] as String,
        requestedAt: json['requested_at'] as String,
        completedAt: json['completed_at'] as String?,
      );
}

const Map<String, String> payoutStatusLabelsAr = {
  'requested': 'اتطلب',
  'under_review': 'تحت المراجعة',
  'approved': 'اتوافق عليه',
  'completed': 'اتحوّل',
  'rejected': 'اترفض',
};

const Map<String, String> payoutMethodLabelsAr = {
  'bank_transfer': 'تحويل بنكي',
  'vodafone_cash': 'فودافون كاش',
  'instapay': 'إنستاباي',
  'cash': 'كاش',
};
