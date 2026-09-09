import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TechnicianLevel, TechnicianPricingTier } from '../../technicians/entities/technician-profile.entity';

// هيكل الحجز الجديد (docs/06 §1) — التلات أزرار اللي العميل بيختار منهم قبل ما يشوف الخدمات.
// نفس القيم بالحرف زي orders.entity.ts's BookingMode (متعمّد تكرار بسيط بدل import من موديول
// orders جوّه catalog — الموديولين مستقلين عن بعض عمدًا في المشروع).
export type BookingModeFilter = 'individual' | 'team' | 'emergency';
export const BOOKING_MODE_FILTER_VALUES: BookingModeFilter[] = ['individual', 'team', 'emergency'];

export class ListServicesDto {
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;

  // فلترة الخدمات حسب وضع الحجز اللي اختاره العميل (فرد/اعتماد/طوارئ) — بتترجم لفلترة على
  // allows_individual/allows_team/allows_emergency على الخدمة (catalog.service.ts findServices).
  @IsOptional()
  @IsIn(BOOKING_MODE_FILTER_VALUES)
  booking_mode?: BookingModeFilter;
}

export class CatalogZoneQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;
}

// Script 3 §7/§67 — بحث بلغة طبيعية، محدود الطول (مفيش استعلام نصي عملاق).
export class SearchServicesDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @IsOptional()
  @IsUUID()
  zone_id?: string;
}

export class EstimateQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;

  // توافق مع العملاء الأقدم: المستوى التشغيلي يتحول داخليًا إلى فئة المهارة الموحدة عند معاينة
  // السعر. المصدر الفعلي للمضاعف هو service_pricing_tier_pricing فقط.
  @IsOptional()
  @IsEnum(TechnicianLevel)
  technician_level?: TechnicianLevel;

  // فئة المهارة الموحدة، وهي المدخل المباشر لمضاعف سعر الفني.
  @IsOptional()
  @IsEnum(TechnicianPricingTier)
  pricing_tier?: TechnicianPricingTier;

  // لمعاينة رسوم الطوارئ + الـ SLA المعلن قبل التأكيد (docs/08 §8) — لو "emergency"، الرد
  // بيتضمن emergency_surcharge_cents/emergency_sla_minutes الفعليين.
  @IsOptional()
  @IsIn(BOOKING_MODE_FILTER_VALUES)
  booking_mode?: BookingModeFilter;

  // لازم لخدمات pricing_model=formula بس (docs/08 §1) — كانت فجوة حقيقية: الـcontroller كان
  // بيتجاهل field_values تمامًا حتى لو اتبعتت، فالمعاينة عبر endpoint ده كانت بترجع صفر لأي
  // خدمة formula بينما POST /orders نفسه كان محسوب صح. نفس نمط ValidatePromoCodeQueryDto
  // بالحرف — الـendpoint ده POST بس بلا body (query بس)، فـfield_values بتوصل كـJSON string.
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
