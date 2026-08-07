import { ServiceCategory } from '../entities/service-category.entity';
import { Service } from '../entities/service.entity';

export interface ServiceCategoryResponseDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  icon_url: string | null;
}

export function toServiceCategoryResponseDto(category: ServiceCategory): ServiceCategoryResponseDto {
  return {
    id: category.id,
    parent_category_id: category.parentCategoryId,
    name_ar: category.nameAr,
    name_en: category.nameEn,
    slug: category.slug,
    icon_url: category.iconUrl,
  };
}

export interface ServiceResponseDto {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  short_description_ar: string | null;
  pricing_model: string;
  base_price_cents: number;
  inspection_fee_cents: number;
  unit_name_ar: string | null;
  estimated_duration_minutes: number | null;
  warranty_days: number;
  requires_photos: boolean;
  allows_scheduling: boolean;
  allows_emergency: boolean;
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
    pricing_model: service.pricingModel,
    base_price_cents: service.basePriceCents,
    inspection_fee_cents: service.inspectionFeeCents,
    unit_name_ar: service.unitNameAr,
    estimated_duration_minutes: service.estimatedDurationMinutes,
    warranty_days: service.warrantyDays,
    requires_photos: service.requiresPhotos,
    allows_scheduling: service.allowsScheduling,
    allows_emergency: service.allowsEmergency,
    min_technician_level: service.minTechnicianLevel,
  };
}
