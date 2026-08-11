import { IsDateString, IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { PricingRuleType } from '../entities/service-pricing-rule.entity';

// payload خام (JSON) — الشكل الدقيق بيتفحص في PricingRulesService حسب rule_type (constant/
// lookup_table بفحص بسيط، formula عبر validateFormulaNode الآمنة) مش هنا على مستوى الـ DTO،
// عشان رسالة الرفض تبقى محددة ودقيقة (مين الحقل اللي غلط بالظبط) مش رفض عام من class-validator.
export class UpsertPricingRuleDto {
  @IsEnum(PricingRuleType)
  rule_type: PricingRuleType;

  @IsString()
  @Length(1, 80)
  rule_key: string;

  @IsObject()
  payload: Record<string, unknown>;

  @IsOptional()
  display_order?: number;

  @IsOptional()
  @IsDateString()
  valid_from?: string;
}
