import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TechnicianPricingTier } from '../entities/technician-profile.entity';

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — منفصلة تمامًا عن ChangeTechnicianLevelDto/current_level.
export class ChangeTechnicianPricingTierDto {
  @IsEnum(TechnicianPricingTier)
  pricing_tier: TechnicianPricingTier;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
