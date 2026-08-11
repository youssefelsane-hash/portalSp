import { ServiceAddon } from '../entities/service-addon.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { ServiceLevelPricing } from '../entities/service-level-pricing.entity';
import { ServiceZonePricing } from '../entities/service-zone-pricing.entity';
import { Service } from '../entities/service.entity';
import { TechnicianService } from '../entities/technician-service.entity';

export interface AdminServiceCategoryResponseDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar: string | null;
  icon_url: string | null;
  display_order: number;
  is_active: boolean;
  is_featured: boolean;
  launch_phase: number;
  created_at: string;
}

export function toAdminServiceCategoryResponseDto(category: ServiceCategory): AdminServiceCategoryResponseDto {
  return {
    id: category.id,
    parent_category_id: category.parentCategoryId,
    name_ar: category.nameAr,
    name_en: category.nameEn,
    slug: category.slug,
    description_ar: category.descriptionAr,
    icon_url: category.iconUrl,
    display_order: category.displayOrder,
    is_active: category.isActive,
    is_featured: category.isFeatured,
    launch_phase: category.launchPhase,
    created_at: category.createdAt.toISOString(),
  };
}

export interface AdminServiceResponseDto {
  id: string;
  category_id: string;
  name_ar: string;
  name_en: string | null;
  slug: string;
  short_description_ar: string | null;
  full_description_ar: string | null;
  icon_url: string | null;
  pricing_model: string;
  base_price_cents: number;
  inspection_fee_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  unit_name_ar: string | null;
  estimated_duration_minutes: number | null;
  warranty_days: number;
  requires_photos: boolean;
  allows_scheduling: boolean;
  allows_emergency: boolean;
  allows_individual: boolean;
  allows_team: boolean;
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  launch_phase: number;
  created_at: string;
}

export function toAdminServiceResponseDto(service: Service): AdminServiceResponseDto {
  return {
    id: service.id,
    category_id: service.categoryId,
    name_ar: service.nameAr,
    name_en: service.nameEn,
    slug: service.slug,
    short_description_ar: service.shortDescriptionAr,
    full_description_ar: service.fullDescriptionAr,
    icon_url: service.iconUrl,
    pricing_model: service.pricingModel,
    base_price_cents: service.basePriceCents,
    inspection_fee_cents: service.inspectionFeeCents,
    min_price_cents: service.minPriceCents,
    max_price_cents: service.maxPriceCents,
    unit_name_ar: service.unitNameAr,
    estimated_duration_minutes: service.estimatedDurationMinutes,
    warranty_days: service.warrantyDays,
    requires_photos: service.requiresPhotos,
    allows_scheduling: service.allowsScheduling,
    allows_emergency: service.allowsEmergency,
    allows_individual: service.allowsIndividual,
    allows_team: service.allowsTeam,
    min_technician_level: service.minTechnicianLevel,
    commission_percentage: Number(service.commissionPercentage),
    display_order: service.displayOrder,
    is_active: service.isActive,
    launch_phase: service.launchPhase,
    created_at: service.createdAt.toISOString(),
  };
}

// كانت بترجع entity خام (camelCase: serviceZoneId, priceCents, ...) بدل DTO زي كل حاجة تانية في
// المشروع — بَقّة حقيقية اتلقطت واتصلحت وقت بناء شاشة تفاصيل الخدمة في apps/admin (تفاصيل في
// catalog/README.md). الاستجابة القديمة اتأكدت حياً بـ curl مباشر قبل الإصلاح.
export interface ServiceZonePricingResponseDto {
  id: string;
  service_id: string;
  service_zone_id: string;
  price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export function toServiceZonePricingResponseDto(pricing: ServiceZonePricing): ServiceZonePricingResponseDto {
  return {
    id: pricing.id,
    service_id: pricing.serviceId,
    service_zone_id: pricing.serviceZoneId,
    price_cents: pricing.priceCents,
    inspection_fee_cents: pricing.inspectionFeeCents,
    surge_multiplier: Number(pricing.surgeMultiplier),
    is_active: pricing.isActive,
    created_at: pricing.createdAt.toISOString(),
  };
}

// نفس البَقّة بالظبط (entity خام camelCase) — تفاصيل فوق.
export interface EligibleTechnicianResponseDto {
  id: string;
  service_id: string;
  technician_id: string;
  skill_level: string;
  is_active: boolean;
  completed_count: number;
  average_rating: number | null;
  created_at: string;
}

export function toEligibleTechnicianResponseDto(row: TechnicianService): EligibleTechnicianResponseDto {
  return {
    id: row.id,
    service_id: row.serviceId,
    technician_id: row.technicianId,
    skill_level: row.skillLevel,
    is_active: row.isActive,
    completed_count: row.completedCount,
    average_rating: row.averageRating === null ? null : Number(row.averageRating),
    created_at: row.createdAt.toISOString(),
  };
}

export interface ServiceLevelPricingResponseDto {
  id: string;
  service_id: string;
  technician_level: string;
  price_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export function toServiceLevelPricingResponseDto(pricing: ServiceLevelPricing): ServiceLevelPricingResponseDto {
  return {
    id: pricing.id,
    service_id: pricing.serviceId,
    technician_level: pricing.technicianLevel,
    price_multiplier: Number(pricing.priceMultiplier),
    is_active: pricing.isActive,
    created_at: pricing.createdAt.toISOString(),
  };
}

export interface ServiceAddonResponseDto {
  id: string;
  service_id: string;
  name_ar: string;
  name_en: string | null;
  price_cents: number;
  duration_minutes: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export function toServiceAddonResponseDto(addon: ServiceAddon): ServiceAddonResponseDto {
  return {
    id: addon.id,
    service_id: addon.serviceId,
    name_ar: addon.nameAr,
    name_en: addon.nameEn,
    price_cents: addon.priceCents,
    duration_minutes: addon.durationMinutes,
    is_active: addon.isActive,
    display_order: addon.displayOrder,
    created_at: addon.createdAt.toISOString(),
  };
}
