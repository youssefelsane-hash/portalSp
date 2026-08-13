import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TechnicianReferralBonusStatus } from '../entities/technician-referral-bonus.entity';

export class AdminListReferralBonusesQueryDto {
  @IsOptional()
  @IsUUID()
  technician_id?: string;

  @IsOptional()
  @IsEnum(TechnicianReferralBonusStatus)
  status?: TechnicianReferralBonusStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page?: number = 20;
}
