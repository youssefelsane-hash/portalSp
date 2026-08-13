// محرك المسار الوظيفي/الترقي للفني (docs/11 §4) — مطابق لـ
// apps/api/src/modules/technician-progression/dto/progression-response.dto.ts.
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

export interface ProgressionUnmetRequirement {
  key: string;
  labelAr: string;
  currentValue: number | null;
  requiredValue: number;
  comparator: 'gte' | 'lte';
}

export interface TechnicianProgressionStatusResponseDto {
  id: string;
  technician_id: string;
  current_level: string;
  next_level: string | null;
  is_eligible: boolean;
  unmet_requirements: ProgressionUnmetRequirement[];
  progress: Record<string, number>;
  eligible_since: string | null;
  needs_demotion_review: boolean;
  demotion_review_reason: string | null;
  admin_decision: string | null;
  admin_decision_reason: string | null;
  admin_decision_at: string | null;
  last_evaluated_at: string;
}

export interface TechnicianLevelHistoryEntryDto {
  id: string;
  previous_level: string | null;
  new_level: string;
  change_type: string;
  effective_from: string;
}
