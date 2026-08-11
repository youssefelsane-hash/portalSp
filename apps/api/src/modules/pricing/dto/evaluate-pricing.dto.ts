import { IsObject } from 'class-validator';

export class EvaluatePricingDto {
  // { field_key: قيمة } — القيم اللي العميل دخلها في الفورم الديناميكي. الفحص التفصيلي
  // (مطلوب/نوع/حدود/خيارات) بيحصل في PricingEngineService.evaluate() نفسه لأنه محتاج يقارن
  // بحقول الخدمة المحددة، مش ممكن يتحقق منه على مستوى الـ DTO العام ده.
  @IsObject()
  field_values: Record<string, string | number | boolean>;
}
