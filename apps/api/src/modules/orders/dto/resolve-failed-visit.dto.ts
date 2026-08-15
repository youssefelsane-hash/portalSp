import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

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

  // إجباري فعليًا لو outcome=reschedule (يتفحص في الـservice، مش هنا، لأن الإجبارية شرطية
  // حسب outcome) — بَقّة حقيقية اتصلحت (docs/08 §25.2، قرار مالك صريح 2026-08-15): "إعادة
  // الجدولة" كانت بترجّع حالة الطلب لـACCEPTED بس من غير أي موعد جديد فعلي ولا فحص availability.
  // السلوت لازم يكون لنفس الفني المعيّن على الطلب أصلاً — نفس فحص POST /orders/:id/reschedule.
  @IsOptional()
  @IsUUID()
  new_slot_id?: string;
}
