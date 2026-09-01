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

  factory WalletTransaction.fromJson(Map<String, dynamic> json) =>
      WalletTransaction(
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

/// سطر شغلانة واحدة في كشف الشهر (docs/08 §61.1، ADR-0038).
/// مطابق لـ`TechnicianStatementJob` في `apps/api/src/modules/payments/technician-earnings.service.ts`.
class StatementJob {
  final String orderId;
  final String orderNumber;
  final String? serviceNameAr;
  final String closedAt;

  /// دورك في الشغلانة دي — 'leader' لطلب فردي أو لو إنت قائد الفريق، أو 'team_member'/'assistant'
  /// لو كنت عضو مساند بس (§90.1).
  final String participantRole;

  /// لو الطلب اتسترد، الجزء اللي اتخصم فعليًا من حصتك رجوعًا للمنصة (§90.1). كل فرد بيتحمل
  /// عكس حصته الأصلية فقط، سواء كان قائدًا أو عضو فريق أو مساعدًا.
  final int refundReversalCents;
  final int grossTechnicianEarningCents;
  final int cashCollectedCents;
  final int netTechnicianDueCents;

  StatementJob({
    required this.orderId,
    required this.orderNumber,
    required this.serviceNameAr,
    required this.closedAt,
    required this.participantRole,
    required this.refundReversalCents,
    required this.grossTechnicianEarningCents,
    required this.cashCollectedCents,
    required this.netTechnicianDueCents,
  });

  factory StatementJob.fromJson(Map<String, dynamic> json) => StatementJob(
    orderId: json['orderId'] as String,
    orderNumber: json['orderNumber'] as String,
    serviceNameAr: json['serviceNameAr'] as String?,
    closedAt: json['closedAt'] as String,
    participantRole: json['participantRole'] as String? ?? 'leader',
    refundReversalCents: json['refundReversalCents'] as int? ?? 0,
    grossTechnicianEarningCents:
        json['grossTechnicianEarningCents'] as int? ?? 0,
    cashCollectedCents: json['cashCollectedCents'] as int? ?? 0,
    netTechnicianDueCents: json['netTechnicianDueCents'] as int? ?? 0,
  );
}

class StatementTotals {
  final int refundReversalCents;
  final int grossTechnicianEarningCents;
  final int cashCollectedCents;
  final int netTechnicianDueCents;

  StatementTotals({
    required this.refundReversalCents,
    required this.grossTechnicianEarningCents,
    required this.cashCollectedCents,
    required this.netTechnicianDueCents,
  });

  factory StatementTotals.fromJson(Map<String, dynamic> json) =>
      StatementTotals(
        refundReversalCents: json['refundReversalCents'] as int? ?? 0,
        grossTechnicianEarningCents:
            json['grossTechnicianEarningCents'] as int? ?? 0,
        cashCollectedCents: json['cashCollectedCents'] as int? ?? 0,
        netTechnicianDueCents: json['netTechnicianDueCents'] as int? ?? 0,
      );
}

/// كشف شهر كامل. `isCurrentMonth` معناه إن الرقم "حتى هذه اللحظة" ولسه ممكن يزيد.
class MonthlyStatement {
  final String month;
  final String monthStart;
  final String monthEnd;
  final bool isCurrentMonth;
  final int jobsCount;
  final StatementTotals totals;
  final List<StatementJob> jobs;

  MonthlyStatement({
    required this.month,
    required this.monthStart,
    required this.monthEnd,
    required this.isCurrentMonth,
    required this.jobsCount,
    required this.totals,
    required this.jobs,
  });

  factory MonthlyStatement.fromJson(Map<String, dynamic> json) =>
      MonthlyStatement(
        month: json['month'] as String,
        monthStart: json['monthStart'] as String,
        monthEnd: json['monthEnd'] as String,
        isCurrentMonth: json['isCurrentMonth'] as bool? ?? false,
        jobsCount: json['jobsCount'] as int? ?? 0,
        totals: StatementTotals.fromJson(
          json['totals'] as Map<String, dynamic>? ?? {},
        ),
        jobs: ((json['jobs'] as List<dynamic>?) ?? [])
            .map((j) => StatementJob.fromJson(j as Map<String, dynamic>))
            .toList(),
      );
}
