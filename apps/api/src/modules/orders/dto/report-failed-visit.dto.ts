import { IsEnum, IsString, Length } from 'class-validator';

// أسباب مقفولة (مش نص حر بالكامل) — نفس فلسفة cancellation_reasons: تصنيف بيقدر الأدمن يفلتر
// عليه ويقيسه، بدل نصوص حرة مبعثرة (docs/08 §22 بند 3).
export enum FailedVisitReason {
  CUSTOMER_NO_SHOW = 'customer_no_show',
  REQUIRED_WORK_REJECTED = 'required_work_rejected',
  OTHER = 'other',
}

export class ReportFailedVisitDto {
  @IsEnum(FailedVisitReason)
  reason: FailedVisitReason;

  @IsString()
  @Length(10, 2000)
  description: string;
}
