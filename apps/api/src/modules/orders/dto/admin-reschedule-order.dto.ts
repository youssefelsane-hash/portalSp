import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — سبب إلزامي (بعكس RescheduleOrderDto
// بتاع العميل نفسه)، لازم للتدقيق بما إن ده تدخّل من طرف تالت في طلب مش بتاعه.
// ADR-0034 — `new_scheduled_at` (يوم) بقى المسار الافتراضي، `new_slot_id` مدعوم بالحرف زي ما كان.
export class AdminRescheduleOrderDto {
  @IsOptional()
  @IsUUID()
  new_slot_id?: string;

  @IsOptional()
  @IsDateString()
  new_scheduled_at?: string;

  @IsOptional()
  @IsDateString()
  new_scheduled_end_at?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
