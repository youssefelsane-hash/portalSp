import { IsBoolean, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateProgressionRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  auto_promote?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_completed_orders?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_platform_revenue_cents?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  min_avg_rating?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_cancellation_rate?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  max_upheld_complaints?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  min_avg_kpi_score?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  min_kpi_months_count?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  min_days_active?: number;

  @IsOptional()
  @IsBoolean()
  enable_demotion_review?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  demotion_review_max_cancellation_rate?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  demotion_review_min_avg_rating?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  demotion_review_max_upheld_complaints?: number | null;
}
