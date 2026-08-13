// محرك الـKPI الشهري للفني (docs/11 §3) — مطابق لـ
// apps/api/src/modules/technician-kpi/dto/technician-kpi-response.dto.ts.
class KpiSnapshot {
  final String id;
  final int periodYear;
  final int periodMonth;
  final int completedOrdersCount;
  final double? acceptanceRate;
  final double? completionRate;
  final double? cancellationRate;
  final double? averageRating;
  final int complaintsUpheldCount;
  final bool isEligible;
  final String? ineligibilityReason;
  final Map<String, dynamic> dimensionScores;
  final double? overallScore;
  final int? suggestedBonusCents;
  final String status;
  final int? approvedBonusCents;
  final String? approvalNotes;
  final String? rejectedReason;
  final String? paidAt;

  KpiSnapshot({
    required this.id,
    required this.periodYear,
    required this.periodMonth,
    required this.completedOrdersCount,
    required this.acceptanceRate,
    required this.completionRate,
    required this.cancellationRate,
    required this.averageRating,
    required this.complaintsUpheldCount,
    required this.isEligible,
    required this.ineligibilityReason,
    required this.dimensionScores,
    required this.overallScore,
    required this.suggestedBonusCents,
    required this.status,
    required this.approvedBonusCents,
    required this.approvalNotes,
    required this.rejectedReason,
    required this.paidAt,
  });

  factory KpiSnapshot.fromJson(Map<String, dynamic> json) => KpiSnapshot(
        id: json['id'] as String,
        periodYear: json['period_year'] as int,
        periodMonth: json['period_month'] as int,
        completedOrdersCount: json['completed_orders_count'] as int,
        acceptanceRate: (json['acceptance_rate'] as num?)?.toDouble(),
        completionRate: (json['completion_rate'] as num?)?.toDouble(),
        cancellationRate: (json['cancellation_rate'] as num?)?.toDouble(),
        averageRating: (json['average_rating'] as num?)?.toDouble(),
        complaintsUpheldCount: json['complaints_upheld_count'] as int,
        isEligible: json['is_eligible'] as bool,
        ineligibilityReason: json['ineligibility_reason'] as String?,
        dimensionScores: (json['dimension_scores'] as Map<String, dynamic>?) ?? const {},
        overallScore: (json['overall_score'] as num?)?.toDouble(),
        suggestedBonusCents: json['suggested_bonus_cents'] as int?,
        status: json['status'] as String,
        approvedBonusCents: json['approved_bonus_cents'] as int?,
        approvalNotes: json['approval_notes'] as String?,
        rejectedReason: json['rejected_reason'] as String?,
        paidAt: json['paid_at'] as String?,
      );
}

class KpiTechnicianSummary {
  final KpiSnapshot? latest;
  final List<KpiSnapshot> history;

  KpiTechnicianSummary({required this.latest, required this.history});

  factory KpiTechnicianSummary.fromJson(Map<String, dynamic> json) => KpiTechnicianSummary(
        latest: json['latest'] == null ? null : KpiSnapshot.fromJson(json['latest'] as Map<String, dynamic>),
        history: (json['history'] as List<dynamic>).cast<Map<String, dynamic>>().map(KpiSnapshot.fromJson).toList(),
      );
}

const Map<String, String> kpiStatusLabelsAr = {
  'calculated': 'محسوبة',
  'approved': 'اتوافق عليها',
  'paid': 'اتصرفت',
  'rejected': 'مرفوضة',
};

const Map<String, String> kpiDimensionLabelsAr = {
  'rating': 'متوسط التقييم',
  'cancellation': 'الإلغاء',
  'complaints': 'الشكاوى',
  'acceptance': 'قبول الطلبات',
  'completion': 'إتمام الطلبات',
  'revenue': 'الإيراد النسبي',
};
