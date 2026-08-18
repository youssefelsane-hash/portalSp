import { IsObject, IsOptional } from 'class-validator';

// تشغيل كل حالات الاختبار المحفوظة لخدمة — لو formula_payload مبعوت، بتتشغّل ضد مسوّدة (قبل
// الحفظ) بدل القاعدة الحية (Script 4 Part L §48، نفس فلسفة EvaluateDraftPricingDto).
export class RunPricingRuleTestsDto {
  @IsOptional()
  @IsObject()
  formula_payload?: Record<string, unknown>;
}
