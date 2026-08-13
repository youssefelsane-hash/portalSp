// محرك الـKPI الشهري للفني (docs/11 §3) — مطابق لـ
// apps/api/src/modules/technician-kpi/dto/technician-kpi-response.dto.ts.
export type KpiSnapshotStatus = 'calculated' | 'approved' | 'paid' | 'rejected';

export interface KpiDimensionScores {
  rating?: number;
  cancellation?: number;
  complaints?: number;
  acceptance?: number;
  completion?: number;
  revenue?: number;
}

export interface KpiWeightsApplied {
  rating: number;
  cancellation: number;
  complaints: number;
  acceptance: number;
  completion: number;
  revenue: number;
}

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
  status: KpiSnapshotStatus;
  approved_bonus_cents: number | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  rejected_reason: string | null;
  paid_at: string | null;
  calculated_at: string;
  created_at: string;
}
