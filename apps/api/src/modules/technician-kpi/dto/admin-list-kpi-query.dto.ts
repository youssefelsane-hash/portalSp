import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { KpiSnapshotStatus } from '../entities/technician-kpi-snapshot.entity';

export class AdminListKpiQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  period_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  period_month?: number;

  @IsOptional()
  @IsUUID()
  technician_id?: string;

  @IsOptional()
  @IsEnum(KpiSnapshotStatus)
  status?: KpiSnapshotStatus;

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
