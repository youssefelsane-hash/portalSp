import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** بند 8 — «تحويل لمعاينة في الموقع». السبب إجباري: القرار بيحمّل العميل رسم معاينة. */
export class RouteToOnsiteAssessmentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

/** بند 8 — «طلب معلومات إضافية». الرسالة هي اللي بتوصل للعميل، فمينفعش تبقى فاضية. */
export class RequestAssessmentInfoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  message: string;
}

/** بند 8 — قبول/رفض عرض سعر خرج عن النطاق. */
export class DecideAboveRangeQuoteDto {
  @IsBoolean()
  approve: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

/** بند 8 — إعادة إصدار عرض منتهي. من غير مبلغ = نفس مبلغ العرض المنتهي. */
export class ReissueQuoteDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  new_amount_cents?: number;
}

export const ASSESSMENT_QUEUE_FILTERS = [
  'photo_review',
  'onsite_assessment',
  'awaiting_quote',
  'awaiting_customer',
  'above_range',
  'expired_quote',
] as const;

export class AssessmentQueueQueryDto {
  @IsOptional()
  @IsIn(ASSESSMENT_QUEUE_FILTERS)
  filter?: (typeof ASSESSMENT_QUEUE_FILTERS)[number];
}
