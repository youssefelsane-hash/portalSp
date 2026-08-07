import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { TechnicianLevel } from '../entities/technician-profile.entity';

export class ChangeTechnicianLevelDto {
  @IsEnum(TechnicianLevel)
  level: TechnicianLevel;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
