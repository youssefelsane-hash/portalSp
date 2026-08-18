import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';

// حالة اختبار محفوظة (Script 4 Part L §48) — "المدخلات دي لازم تنتج السعر ده بالظبط".
export class CreatePricingRuleTestDto {
  @IsString()
  @Length(1, 160)
  label: string;

  @IsObject()
  field_values: Record<string, string | number | boolean>;

  @IsInt()
  @Min(0)
  expected_price_cents: number;
}
