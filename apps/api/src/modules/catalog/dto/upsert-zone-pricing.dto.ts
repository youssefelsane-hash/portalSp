import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Min } from 'class-validator';
import { ZonePricingMode } from '../entities/service-zone-pricing.entity';

export class UpsertZonePricingDto {
  @IsUUID()
  service_zone_id: string;

  // docs/08 §36.22-23، ADR-0024 — افتراضي override (السلوك القديم) لو مش مبعوت، للتوافق مع أي
  // استهلاك قديم للـAPI ده. بالظبط واحد من price_cents/modifier_percentage مطلوب حسب الوضع —
  // الفحص الفعلي في admin-catalog.service.ts (مش هنا، عشان الرسالة تبقى بالعربي وواضحة).
  @IsOptional()
  @IsEnum(ZonePricingMode)
  pricing_mode?: ZonePricingMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  price_cents?: number;

  @IsOptional()
  @IsNumber()
  modifier_percentage?: number;

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
