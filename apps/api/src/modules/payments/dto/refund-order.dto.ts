import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class RefundOrderDto {
  @IsString()
  @Length(2, 500)
  reason_notes: string;

  // استرداد جزئي (ADR-0013 §9) — لو مبعوتش، استرداد كامل (default السلوك الحالي، صفر تغيير).
  @IsOptional()
  @IsInt()
  @Min(1)
  amount_cents?: number;
}
