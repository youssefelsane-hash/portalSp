import { IsDateString, IsOptional } from 'class-validator';

export class ZonesReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
