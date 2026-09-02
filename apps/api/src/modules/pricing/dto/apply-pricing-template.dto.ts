import { IsEnum, IsInt, Min } from 'class-validator';
import { PricingTemplateKey } from '../pricing-templates';

// تطبيق قالب تسعير على خدمة (ADR-0060 §2) — بيزرع حقول الفورم وبيكتب شجرة final_price، وبعدها
// الخدمة معادلة عادية بالكامل.
export class ApplyPricingTemplateDto {
  @IsEnum(PricingTemplateKey)
  template_key: PricingTemplateKey;

  // بالقرش زي كل الأسعار في المشروع (docs/01 §1.3).
  @IsInt()
  @Min(0)
  rate_cents: number;
}
