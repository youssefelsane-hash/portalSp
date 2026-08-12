import { Transform } from 'class-transformer';
import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class ValidatePromoCodeQueryDto {
  @IsUUID()
  service_id: string;

  @IsUUID()
  address_id: string;

  // لازم لخدمات pricing_model=formula بس (docs/08 §1) — نفس field_values بتاعة POST /orders،
  // عشان معاينة الخصم تتحسب على السعر الحقيقي مش على صفر. GET مفيهاش body، فبتوصل كـ JSON
  // string جوّه الـ query. لو JSON مش صالح بنسيبها string عمدًا عشان IsObject() يرفضها برسالة
  // 400 واضحة بدل ما تتبلع بصمت وتدّي معاينة غلط.
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  })
  @IsObject()
  field_values?: Record<string, string | number | boolean>;
}
