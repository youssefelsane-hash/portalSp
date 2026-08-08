import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  // اختياري — لو العميل اختار سبب من القايمة (GET /cancellation-reasons) بدل نص حر بس.
  // لو موجود، ممكن يترتب عليه رسوم إلغاء حسب fee_percentage الخاص بالسبب.
  @IsOptional()
  @IsUUID()
  cancellation_reason_id?: string;
}
