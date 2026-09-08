import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { WorkforceSort } from '../workforce-analytics.service';

/** الافتراضي لو الأدمن مابعتش مدى — آخر ٣٠ يوم، أوسع نافذة مفيدة من غير ما تبقى تقيلة. */
export const DEFAULT_RANGE_DAYS = 30;

export class AnalyticsRangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class FunnelByServiceQueryDto extends AnalyticsRangeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** ترتيب كشف الفنيين — القيم دي بس، وأي قيمة تانية بترجع 400 قبل ما توصل الخدمة. */
export const WORKFORCE_SORTS: WorkforceSort[] = ['completed', 'earnings', 'utilization', 'rating', 'idle', 'debt'];

export class WorkforceQueryDto extends AnalyticsRangeQueryDto {
  /** قصر الكشف على شركة واحدة — بيخدم لوحة مالك الشركة بنفس الحسابات بلا نسخة تانية. */
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsIn(WORKFORCE_SORTS)
  sort?: WorkforceSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;
}

/**
 * `to` بيبقى **حصري** (`< to`) في كل الاستعلامات، فآخر لحظة في اليوم مابتضيعش وفي نفس الوقت
 * مافيش صف بيتحسب في فترتين. `from` شامل.
 */
export function resolveRange(query: AnalyticsRangeQueryDto): { from: Date; to: Date } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 3600 * 1000);
  return { from, to };
}
