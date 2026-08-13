import { KpiDimensionScores, KpiWeightsApplied, TechnicianKpiSnapshot } from '../entities/technician-kpi-snapshot.entity';

export interface TechnicianKpiSnapshotResponseDto {
  id: string;
  technician_id: string;
  period_year: number;
  period_month: number;
  offered_orders_count: number;
  accepted_orders_count: number;
  completed_orders_count: number;
  technician_cancelled_count: number;
  acceptance_rate: number | null;
  completion_rate: number | null;
  cancellation_rate: number | null;
  average_rating: number | null;
  ratings_count: number;
  negative_ratings_count: number;
  average_cleanliness_rating: number | null;
  complaints_count: number;
  complaints_upheld_count: number;
  serious_upheld_complaint: boolean;
  revisit_count: number;
  platform_revenue_cents: number;
  technician_earnings_cents: number;
  order_value_cents: number;
  is_eligible: boolean;
  ineligibility_reason: string | null;
  dimension_scores: KpiDimensionScores;
  weights_applied: KpiWeightsApplied;
  overall_score: number | null;
  suggested_bonus_cents: number | null;
  status: string;
  approved_bonus_cents: number | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  rejected_reason: string | null;
  paid_at: string | null;
  calculated_at: string;
  created_at: string;
}

function toNumberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function toTechnicianKpiSnapshotResponseDto(
  s: TechnicianKpiSnapshot,
  options: { includeApprovalNotes: boolean } = { includeApprovalNotes: true },
): TechnicianKpiSnapshotResponseDto {
  return {
    id: s.id,
    technician_id: s.technicianId,
    period_year: s.periodYear,
    period_month: s.periodMonth,
    offered_orders_count: s.offeredOrdersCount,
    accepted_orders_count: s.acceptedOrdersCount,
    completed_orders_count: s.completedOrdersCount,
    technician_cancelled_count: s.technicianCancelledCount,
    acceptance_rate: toNumberOrNull(s.acceptanceRate),
    completion_rate: toNumberOrNull(s.completionRate),
    cancellation_rate: toNumberOrNull(s.cancellationRate),
    average_rating: toNumberOrNull(s.averageRating),
    ratings_count: s.ratingsCount,
    negative_ratings_count: s.negativeRatingsCount,
    average_cleanliness_rating: toNumberOrNull(s.averageCleanlinessRating),
    complaints_count: s.complaintsCount,
    complaints_upheld_count: s.complaintsUpheldCount,
    serious_upheld_complaint: s.seriousUpheldComplaint,
    revisit_count: s.revisitCount,
    platform_revenue_cents: Number(s.platformRevenueCents),
    technician_earnings_cents: Number(s.technicianEarningsCents),
    order_value_cents: Number(s.orderValueCents),
    is_eligible: s.isEligible,
    ineligibility_reason: s.ineligibilityReason,
    dimension_scores: s.dimensionScores,
    weights_applied: s.weightsApplied,
    overall_score: toNumberOrNull(s.overallScore),
    suggested_bonus_cents: s.suggestedBonusCents,
    status: s.status,
    approved_bonus_cents: s.approvedBonusCents,
    approved_by_user_id: s.approvedByUserId,
    approved_at: s.approvedAt?.toISOString() ?? null,
    approval_notes: options.includeApprovalNotes ? s.approvalNotes : null,
    rejected_reason: s.rejectedReason,
    paid_at: s.paidAt?.toISOString() ?? null,
    calculated_at: s.calculatedAt.toISOString(),
    created_at: s.createdAt.toISOString(),
  };
}
