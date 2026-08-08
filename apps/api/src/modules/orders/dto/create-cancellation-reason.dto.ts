import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CancellationAppliesTo } from '../entities/cancellation-reason.entity';

export class CreateCancellationReasonDto {
  @IsString()
  @Length(2, 200)
  reason_ar: string;

  @IsString()
  @Length(2, 200)
  reason_en: string;

  @IsEnum(CancellationAppliesTo)
  applies_to: CancellationAppliesTo;

  @IsOptional()
  @IsBoolean()
  charges_fee?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  fee_percentage?: number;

  @IsOptional()
  @IsBoolean()
  affects_technician_score?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}
