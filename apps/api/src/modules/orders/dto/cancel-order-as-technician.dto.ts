import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// نفس شكل CancelOrderDto (العميل) بالحرف — مصدر الحقيقة (applies_to) بيتفحص وقت التنفيذ في
// الـservice، مش هنا، عشان نفس الـcancellation_reasons endpoint العام يفضل يخدم الطرفين.
export class CancelOrderAsTechnicianDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsUUID()
  cancellation_reason_id?: string;
}
