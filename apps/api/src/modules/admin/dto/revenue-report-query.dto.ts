import { IsDateString, IsIn, IsOptional } from 'class-validator';

export type ReportGroupBy = 'day' | 'week' | 'month';

export class RevenueReportQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  group_by?: ReportGroupBy = 'day';
}
