import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UpdateFixedCommissionDto {
  @IsInt()
  @Min(0)
  platform_commission_cents: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class UpdateEarningsLevelPolicyDto {
  @IsInt()
  @Min(1)
  @Max(100000)
  earning_weight_bps: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  assistant_ratio_bps: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class UpdateEarningsSkillPolicyDto {
  @IsInt()
  @Min(1)
  @Max(30000)
  factor_bps: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class SetEarningsCutoverDto {
  @IsBoolean()
  enabled: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class SimulateEarningsParticipantDto {
  @IsString()
  technician_id: string;

  @IsIn(['technician', 'assistant'])
  earning_role: 'technician' | 'assistant';

  @IsBoolean()
  is_leader: boolean;

  @IsIn(['technician', 'assistant'])
  technician_kind: 'technician' | 'assistant';

  @IsString()
  technician_level: string;

  @IsInt()
  @Min(1)
  level_weight_bps: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  assistant_ratio_bps: number;

  @IsString()
  service_skill: string;

  @IsInt()
  @Min(1)
  service_skill_factor_bps: number;

  @IsOptional()
  @IsInt()
  @Min(-9999)
  individual_adjustment_bps?: number;

  @IsOptional()
  @IsInt()
  @Min(-9999)
  order_adjustment_bps?: number;
}

export class SimulateEarningsDto {
  @IsInt()
  @Min(0)
  order_total_cents: number;

  @IsInt()
  @Min(0)
  platform_commission_cents: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimulateEarningsParticipantDto)
  participants: SimulateEarningsParticipantDto[];
}

export class CreateTechnicianEarningAdjustmentDto {
  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsInt()
  @Min(-9999)
  @Max(20000)
  adjustment_bps: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsDateString()
  effective_from?: string;

  @IsOptional()
  @IsDateString()
  effective_until?: string;
}

export class UpdateServiceLevelEarningsOverrideDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  assistant_ratio_bps: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class UpdateServiceSkillEarningsOverrideDto {
  @IsInt()
  @Min(1)
  @Max(30000)
  factor_bps: number;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class ResetEarningsOverrideDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
