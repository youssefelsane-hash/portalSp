import { IsDateString, IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';

export class UpsertZonePricingDto {
  @IsUUID()
  service_zone_id: string;

  @IsInt()
  @Min(0)
  price_cents: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  inspection_fee_cents?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  surge_multiplier?: number;

  // تاريخ سريان (docs/06 §3.10) — افتراضي دلوقتي لو مش مبعوت (يعدّل السعر الساري فورًا). تاريخ
  // مستقبلي = يجدول تغيير سعر جاي من غير ما يأثر على أي حاجة دلوقتي — الصف الساري الحالي
  // بيتقفل تلقائيًا عند نفس اللحظة دي (valid_until)، وصف جديد بيتفتح من عندها.
  @IsOptional()
  @IsDateString()
  valid_from?: string;
}
