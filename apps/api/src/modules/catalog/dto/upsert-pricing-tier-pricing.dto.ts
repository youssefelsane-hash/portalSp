import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { TechnicianPricingTier } from '../../technicians/entities/technician-profile.entity';

// فئة مهارة التسعير الموحدة؛ هي المصدر التجاري الوحيد لمضاعف سعر الفني.
export class UpsertPricingTierPricingDto {
  @IsEnum(TechnicianPricingTier)
  pricing_tier: TechnicianPricingTier;

  @IsNumber()
  @IsPositive()
  price_multiplier: number;
}
