import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsNumber, IsObject, IsOptional, IsPositive, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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

// Script 3 §7/§67 — بحث بلغة طبيعية، محدود الطول (مفيش استعلام نصي عملاق).
export class SearchServicesDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;
}

export class EstimateQueryDto {
  @IsOptional()
  @IsUUID()
  zone_id?: string;

  // اختياري — لمعاينة السعر لو الفني اللي هيتنفّذ الطلب من مستوى معيّن (بيتطبّق بس لو فيه
  // service_level_pricing مفعّل للخدمة دي). التوصيل الفعلي في `POST /orders` لسه بيستخدم السعر
  // الأساسي لأن الفني مش معروف وقت إنشاء الطلب (فجوة موثّقة في catalog/README.md).
  @IsOptional()
  @IsEnum(TechnicianLevel)
  technician_level?: TechnicianLevel;

  // فئة التسعير التجارية (docs/08 §36.24، ADR-0025) — إضافية زي technician_level فوق بالحرف،
  // منفصلة تمامًا (تسعير تجاري مش مستوى تشغيلي).
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

  // دقة الوقت (ADR-0031 Slice B/H) — بس لخدمات pricing_model=hourly، اختياري بالكامل (خدمة
  // hourly من غيرها بترجع سعر الساعة الخام زي ما كان). راجع CatalogService.estimate().
  @IsOptional()
  @IsNumber()
  @IsPositive()
  duration_hours?: number;

  // خدمات per_unit: عدد الوحدات في المعاينة العامة، بنفس قيمة إنشاء الطلب.
  @IsOptional()
  @IsNumber()
  @IsPositive()
  pricing_quantity?: number;

  // ADR-0050 §4 — فترة التعاقد لخدمة `monthly`. المعاينة العامة لازم تحسب نفس عدد شهور الفوترة
  // اللي الحجز الحقيقي هيحسبه، وإلا الرقم اللي العميل شافه في الكتالوج مش هو اللي هيدفعه.
  @IsOptional()
  @IsDateString()
  period_start?: string;

  @IsOptional()
  @IsDateString()
  period_end?: string;
}
