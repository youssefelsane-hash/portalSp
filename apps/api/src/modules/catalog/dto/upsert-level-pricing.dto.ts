import { IsEnum, IsNumber, IsPositive } from 'class-validator';
import { TechnicianLevel } from '../../technicians/entities/technician-profile.entity';

export class UpsertLevelPricingDto {
  @IsEnum(TechnicianLevel)
  technician_level: TechnicianLevel;

  @IsNumber()
  @IsPositive()
  price_multiplier: number;
}
