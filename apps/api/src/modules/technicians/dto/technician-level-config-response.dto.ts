import { TechnicianLevelConfig } from '../entities/technician-level-config.entity';

export interface TechnicianLevelConfigResponseDto {
  level: string;
  display_name_ar: string;
  commission_adjustment_percentage: number;
  order_priority_weight: number;
  crew_share_weight: number;
  assistant_earning_multiplier: number;
  decision_limit_cents: number | null;
  can_lead_team: boolean;
  eligible_for_team_booking: boolean;
  updated_at: string;
}

export function toTechnicianLevelConfigResponseDto(config: TechnicianLevelConfig): TechnicianLevelConfigResponseDto {
  return {
    level: config.level,
    display_name_ar: config.displayNameAr,
    commission_adjustment_percentage: Number(config.commissionAdjustmentPercentage),
    order_priority_weight: config.orderPriorityWeight,
    crew_share_weight: Number(config.crewShareWeight),
    assistant_earning_multiplier: Number(config.assistantEarningMultiplier),
    decision_limit_cents: config.decisionLimitCents,
    can_lead_team: config.canLeadTeam,
    eligible_for_team_booking: config.eligibleForTeamBooking,
    updated_at: config.updatedAt.toISOString(),
  };
}
