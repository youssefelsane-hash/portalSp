import { IsObject, IsOptional } from 'class-validator';

// معاينة مسوّدة قبل الحفظ (Script 4 Part L §47-48) — نفس EvaluatePricingDto بس formula_payload
// اختياري: لو مبعوت، بيتقيّم بدل القاعدة final_price المحفوظة فعليًا (بدون أي كتابة في
// الداتابيز). فحص شكل formula_payload التفصيلي بيحصل في PricingEngineService.evaluateDraft()
// (نفس validateFormulaNode المستخدمة وقت الحفظ الحقيقي) — نفس فلسفة UpsertPricingRuleDto.
export class EvaluateDraftPricingDto {
  @IsObject()
  field_values: Record<string, string | number | boolean>;

  @IsOptional()
  @IsObject()
  formula_payload?: Record<string, unknown>;
}
