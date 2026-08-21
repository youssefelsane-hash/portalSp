import { ServiceCategory } from '../entities/service-category.entity';
import { Service } from '../entities/service.entity';

export interface ServiceCategoryResponseDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  icon_url: string | null;
  // Script 6 Part 1-2 — صورة غلاف حقيقية للكارت (أبعاد أكبر من الأيقونة)، كانت العمود موجود
  // في الـschema من migration 0006 بس مش معروضة للعميل قبل كده. null صريح لو الأدمن لسه ما حطهاش
  // (fallback في التطبيق للأيقونة، وبعدها لأيقونة عامة — بلا صورة كسورة/404).
  cover_image_url: string | null;
  // Script 3 §14 — مستخدم في Home screen عشان يعرض فئات شائعة حقيقية (مُعدّة من الأدمن)، مش
  // فبركة "شائع" بدون بيانات حقيقية. العمود موجود من migration 0006 القديمة، مش مُعرَّض للعميل
  // قبل كده.
  is_featured: boolean;
}

export function toServiceCategoryResponseDto(category: ServiceCategory): ServiceCategoryResponseDto {
  return {
    id: category.id,
    parent_category_id: category.parentCategoryId,
    name_ar: category.nameAr,
    name_en: category.nameEn,
    slug: category.slug,
    icon_url: category.iconUrl,
    cover_image_url: category.coverImageUrl,
    is_featured: category.isFeatured,
  };
}

export interface ServiceResponseDto {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  short_description_ar: string | null;
  // Script 6 Part 1-2 — service.iconUrl موجود في الـschema/DTO الأدمن من زمان بس مش معروض
  // للعميل — كانت فجوة موثّقة صراحة، اتقفلت (كارت/صف الخدمة بقى يقدر يعرض صورة حقيقية).
  icon_url: string | null;
  pricing_model: string;
  base_price_cents: number;
  inspection_fee_cents: number;
  unit_name_ar: string | null;
  estimated_duration_minutes: number | null;
  warranty_days: number;
  requires_photos: boolean;
  allows_scheduling: boolean;
  allows_emergency: boolean;
  allows_individual: boolean;
  allows_team: boolean;
  cash_allowed: boolean;
  deposit_required: boolean;
  deposit_percentage: number | null;
  allows_date_range_booking: boolean;
  min_technician_level: string;
}

export function toServiceResponseDto(service: Service): ServiceResponseDto {
  return {
    id: service.id,
    category_id: service.categoryId,
    name_ar: service.nameAr,
    name_en: service.nameEn,
    slug: service.slug,
    short_description_ar: service.shortDescriptionAr,
    icon_url: service.iconUrl,
    pricing_model: service.pricingModel,
    base_price_cents: service.basePriceCents,
    inspection_fee_cents: service.inspectionFeeCents,
    unit_name_ar: service.unitNameAr,
    estimated_duration_minutes: service.estimatedDurationMinutes,
    warranty_days: service.warrantyDays,
    requires_photos: service.requiresPhotos,
    allows_scheduling: service.allowsScheduling,
    allows_emergency: service.allowsEmergency,
    allows_individual: service.allowsIndividual,
    allows_team: service.allowsTeam,
    cash_allowed: service.cashAllowed,
    deposit_required: service.depositRequired,
    deposit_percentage: service.depositPercentage !== null ? Number(service.depositPercentage) : null,
    allows_date_range_booking: service.allowsDateRangeBooking,
    min_technician_level: service.minTechnicianLevel,
  };
}
