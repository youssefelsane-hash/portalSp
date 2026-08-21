import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { TechnicianPricingTier } from '../../technicians/entities/technician-profile.entity';

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — نفس نمط UpsertLevelPricingDto بالحرف، بس مربوطة
// بـTechnicianPricingTier (تجاري) مش TechnicianLevel (تشغيلي).
export class UpsertPricingTierPricingDto {
  @IsEnum(TechnicianPricingTier)
  pricing_tier: TechnicianPricingTier;

  @IsNumber()
  @IsPositive()
  price_multiplier: number;
}
