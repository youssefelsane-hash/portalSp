import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ApproveKpiDto {
  @IsInt()
  @Min(0)
  approved_bonus_cents: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
