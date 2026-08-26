import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * معامل سعر الشركة (ADR-0042، docs/08 §64.و).
 *
 * الحدود هنا **مرآة للقيد في الداتابيز** (`technician_companies_price_multiplier_range`) مش بديل
 * عنه: التحقق هنا بيدي رسالة مفهومة للأدمن، والقيد تحت بيمنع أي مسار تاني يكتب قيمة خارجة.
 */
export class SetCompanyPriceMultiplierDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(3)
  price_multiplier: number;

  /** سبب التغيير — بيتسجّل في `audit_log` (نفس فلسفة note في منح علامة التوثيق). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
