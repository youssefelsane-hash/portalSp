import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const CUSTOMER_RESCHEDULE_REASON_CODES = [
  'customer_request',
  'availability_change',
  'address_access',
  'other',
] as const;

export type CustomerRescheduleReasonCode = (typeof CUSTOMER_RESCHEDULE_REASON_CODES)[number];

// ADR-0034 — `new_scheduled_at` (يوم) هو المسار الافتراضي دلوقتي؛ `new_slot_id` بيفضل مدعوم
// بالحرف للعميل اللي اختار سلوت فني بعينه من جدوله (ADR-0017 بند 1 أبقى على الحالة دي صراحة).
// بالظبط واحد منهم — التحقق نفسه في OrdersService.rescheduleCore() عشان يسري على مسار الأدمن كمان.
export class RescheduleOrderDto {
  @IsOptional()
  @IsUUID()
  new_slot_id?: string;

  @IsOptional()
  @IsDateString()
  new_scheduled_at?: string;

  @IsOptional()
  @IsDateString()
  new_scheduled_end_at?: string;

  /** سبب مختصر ظاهر في Timeline الطلب؛ اختياري حتى تظل التطبيقات القديمة متوافقة. */
  @IsOptional()
  @IsIn(CUSTOMER_RESCHEDULE_REASON_CODES)
  reason_code?: CustomerRescheduleReasonCode;

  /** توضيح حر، مطلوب فقط عندما يكون السبب "other" ويُتحقق منه في الخدمة. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason_details?: string;
}
