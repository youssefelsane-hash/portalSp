import { IsDateString, IsOptional, IsUUID } from 'class-validator';

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
}
