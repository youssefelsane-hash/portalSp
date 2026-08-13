import { TechnicianProgressionRule } from '../entities/technician-progression-rule.entity';
import { TechnicianProgressionStatus, UnmetRequirement } from '../entities/technician-progression-status.entity';

export interface TechnicianProgressionRuleResponseDto {
  id: string;
  from_level: string;
  to_level: string;
  enabled: boolean;
  auto_promote: boolean;
  min_completed_orders: number;
  min_platform_revenue_cents: number;
  min_avg_rating: number | null;
  max_cancellation_rate: number | null;
  max_upheld_complaints: number | null;
  min_avg_kpi_score: number | null;
  min_kpi_months_count: number;
  min_days_active: number;
  enable_demotion_review: boolean;
  demotion_review_max_cancellation_rate: number | null;
  demotion_review_min_avg_rating: number | null;
  demotion_review_max_upheld_complaints: number | null;
}

function n(value: string | null): number | null {
  return value === null ? null : Number(value);
}

export function toProgressionRuleResponseDto(r: TechnicianProgressionRule): TechnicianProgressionRuleResponseDto {
  return {
    id: r.id,
    from_level: r.fromLevel,
    to_level: r.toLevel,
    enabled: r.enabled,
    auto_promote: r.autoPromote,
    min_completed_orders: r.minCompletedOrders,
    min_platform_revenue_cents: Number(r.minPlatformRevenueCents),
    min_avg_rating: n(r.minAvgRating),
    max_cancellation_rate: n(r.maxCancellationRate),
    max_upheld_complaints: r.maxUpheldComplaints,
    min_avg_kpi_score: n(r.minAvgKpiScore),
    min_kpi_months_count: r.minKpiMonthsCount,
    min_days_active: r.minDaysActive,
    enable_demotion_review: r.enableDemotionReview,
    demotion_review_max_cancellation_rate: n(r.demotionReviewMaxCancellationRate),
    demotion_review_min_avg_rating: n(r.demotionReviewMinAvgRating),
    demotion_review_max_upheld_complaints: r.demotionReviewMaxUpheldComplaints,
  };
}

export interface TechnicianProgressionStatusResponseDto {
  id: string;
  technician_id: string;
  current_level: string;
  next_level: string | null;
  is_eligible: boolean;
  unmet_requirements: UnmetRequirement[];
  progress: Record<string, number>;
  eligible_since: string | null;
  needs_demotion_review: boolean;
  demotion_review_reason: string | null;
  admin_decision: string | null;
  admin_decision_reason: string | null;
  admin_decision_at: string | null;
  last_evaluated_at: string;
}

export function toProgressionStatusResponseDto(s: TechnicianProgressionStatus): TechnicianProgressionStatusResponseDto {
  return {
    id: s.id,
    technician_id: s.technicianId,
    current_level: s.currentLevel,
    next_level: s.nextLevel,
    is_eligible: s.isEligible,
    unmet_requirements: s.unmetRequirements,
    progress: s.progress,
    eligible_since: s.eligibleSince?.toISOString() ?? null,
    needs_demotion_review: s.needsDemotionReview,
    demotion_review_reason: s.demotionReviewReason,
    admin_decision: s.adminDecision,
    admin_decision_reason: s.adminDecisionReason,
    admin_decision_at: s.adminDecisionAt?.toISOString() ?? null,
    last_evaluated_at: s.lastEvaluatedAt.toISOString(),
  };
}
