export interface TechnicianLevelConfigResponseDto {
  level: string;
  display_name_ar: string;
  commission_adjustment_percentage: number;
  order_priority_weight: number;
  decision_limit_cents: number | null;
  can_lead_team: boolean;
  eligible_for_team_booking: boolean;
  updated_at: string;
}

export interface UpdateTechnicianLevelConfigBody {
  display_name_ar?: string;
  commission_adjustment_percentage?: number;
  order_priority_weight?: number;
  decision_limit_cents?: number | null;
  can_lead_team?: boolean;
  eligible_for_team_booking?: boolean;
}
