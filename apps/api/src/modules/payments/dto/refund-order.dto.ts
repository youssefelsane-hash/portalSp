import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class RefundOrderDto {
  @IsString()
  @Length(2, 500)
  reason_notes: string;

  // استرداد جزئي (ADR-0013 §9) — لو مبعوتش، استرداد كامل (default السلوك الحالي، صفر تغيير).
  @IsOptional()
  @IsInt()
  @Min(1)
  amount_cents?: number;

  // في الطلبات ذات الدفعة الواحدة يظل اختياريًا للحفاظ على التوافق. إذا كانت هناك دفعات
  // خدمة/عمل إضافي متعددة، ترفض الخدمة الطلب بدونه بدل تخمين أي دفعة يقصدها الأدمن.
  @IsOptional()
  @IsUUID()
  payment_id?: string;
}
