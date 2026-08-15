import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

// docs/08 §22 بند 4-5 — الأدمن بيقرر بعد المراجعة (مش تلقائي، مش بيصدّق طرف واحد أعمى):
// reschedule = العميل عايز يكمل (نفس الطلب، نفس السعر، صفر تحصيل تاني)
// cancel_with_fee = العميل عايز يلغي (رسوم زيارة اختيارية + استرداد الباقي لو مدفوع مسبقًا)
export enum FailedVisitOutcome {
  RESCHEDULE = 'reschedule',
  CANCEL_WITH_FEE = 'cancel_with_fee',
}

export class ResolveFailedVisitDto {
  @IsEnum(FailedVisitOutcome)
  outcome: FailedVisitOutcome;

  // اختياري — لو مش موجودة، بيستخدم orders.no_show_visit_fee_cents الافتراضي. بيتجاهل تمامًا
  // لو outcome=reschedule (مفيش رسوم أصلاً) أو لو الطلب كاش (المنصة بتمتص التكلفة، صفر رسوم).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_00)
  visit_fee_cents?: number;

  @IsString()
  @Length(5, 1000)
  admin_notes: string;
}
