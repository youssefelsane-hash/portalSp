import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CalculateKpiDto {
  @IsInt()
  @Min(2020)
  period_year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  period_month: number;

  @IsOptional()
  @IsUUID()
  technician_id?: string;
}
