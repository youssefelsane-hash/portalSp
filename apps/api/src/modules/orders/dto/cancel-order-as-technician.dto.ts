import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// سياسة إلغاء الفني (ADR-0006) — cancellation_reason_id بقى إجباري (مكانش)، السبب لازم يتحدد
// دايمًا من القائمة المُعدّة إداريًا. `reason` (نص حر) بيفضل اختياري على مستوى الـDTO — إجباريته
// الفعلية (لو السبب `requires_free_text=true`) بتتفحص في الـservice لأنها محتاجة تقرأ السبب نفسه.
export class CancelOrderAsTechnicianDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsUUID()
  cancellation_reason_id: string;
}
