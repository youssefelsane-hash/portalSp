import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// سياسة إلغاء الفني (docs/10) — سبب إجباري دلوقتي (كان اختياري). النص الحر لسه اختياري على
// مستوى الـDTO لأن "إجباري بس لو السبب المختار محتاجه" شرط متعدد الحقول (cross-field) بيتفحص
// في OrdersService.technicianCancel() بعد ما نجيب CancellationReason.requiresFreeText —
// مينفعش يتحقق هنا بـclass-validator عادي.
export class CancelOrderAsTechnicianDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsUUID()
  cancellation_reason_id: string;
}
