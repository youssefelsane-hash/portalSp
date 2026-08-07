import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export type TechniciansReportSortBy = 'completed_orders' | 'average_rating' | 'cancelled_orders' | 'quality_score';

export class TechniciansReportQueryDto {
  @IsOptional()
  @IsIn(['completed_orders', 'average_rating', 'cancelled_orders', 'quality_score'])
  sort_by?: TechniciansReportSortBy = 'completed_orders';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';

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
