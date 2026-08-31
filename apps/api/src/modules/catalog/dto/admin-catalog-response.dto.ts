import { ServiceAddon } from '../entities/service-addon.entity';
import { ServiceCategory } from '../entities/service-category.entity';
import { ServiceLevelPricing } from '../entities/service-level-pricing.entity';
import { ServicePricingTierPricing } from '../entities/service-pricing-tier-pricing.entity';
import { ServiceProductivityActual } from '../entities/service-productivity-actual.entity';
import { ServiceProductivitySuggestion } from '../entities/service-productivity-suggestion.entity';
import { ServiceStandardData } from '../entities/service-standard-data.entity';
import { ServiceZonePricing, ZonePricingMode } from '../entities/service-zone-pricing.entity';
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
  cover_image_url: string | null;
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
    cover_image_url: category.coverImageUrl,
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
  featured_icon_url: string | null;
  featured_name_ar: string | null;
  pricing_model: string;
  base_price_cents: number;
  inspection_fee_cents: number;
  min_price_cents: number | null;
  max_price_cents: number | null;
  unit_name_ar: string | null;
  quantity_min: number | null;
  quantity_max: number | null;
  quantity_step: number | null;
  quantity_precision: number;
  estimated_duration_minutes: number | null;
  warranty_days: number;
  requires_photos: boolean;
  allows_scheduling: boolean;
  allows_emergency: boolean;
  // ADR-0046 — بوابة الإعلان التلقائي عن الخدمة (افتراضي false).
  is_promotable: boolean;
  allows_individual: boolean;
  allows_team: boolean;
  cash_allowed: boolean;
  deposit_required: boolean;
  deposit_percentage: number | null;
  allows_date_range_booking: boolean;
  allows_recurring_booking: boolean;
  show_unavailable_providers: boolean;
  requires_precise_schedule: boolean;
  requires_start_time_only: boolean;
  requires_hours_only: boolean;
  requires_start_and_end: boolean;
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  launch_phase: number;
  search_keywords: string[];
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
    featured_icon_url: service.featuredIconUrl,
    featured_name_ar: service.featuredNameAr,
    pricing_model: service.pricingModel,
    base_price_cents: service.basePriceCents,
    inspection_fee_cents: service.inspectionFeeCents,
    min_price_cents: service.minPriceCents,
    max_price_cents: service.maxPriceCents,
    unit_name_ar: service.unitNameAr,
    quantity_min: service.quantityMin === null ? null : Number(service.quantityMin),
    quantity_max: service.quantityMax === null ? null : Number(service.quantityMax),
    quantity_step: service.quantityStep === null ? null : Number(service.quantityStep),
    quantity_precision: service.quantityPrecision,
    estimated_duration_minutes: service.estimatedDurationMinutes,
    warranty_days: service.warrantyDays,
    requires_photos: service.requiresPhotos,
    allows_scheduling: service.allowsScheduling,
    allows_emergency: service.allowsEmergency,
    is_promotable: service.isPromotable,
    allows_individual: service.allowsIndividual,
    allows_team: service.allowsTeam,
    cash_allowed: service.cashAllowed,
    deposit_required: service.depositRequired,
    deposit_percentage: service.depositPercentage !== null ? Number(service.depositPercentage) : null,
    allows_date_range_booking: service.allowsDateRangeBooking,
    allows_recurring_booking: service.allowsRecurringBooking,
    show_unavailable_providers: service.showUnavailableProviders,
    requires_precise_schedule: service.requiresPreciseSchedule,
    requires_start_time_only: service.requiresStartTimeOnly,
    requires_hours_only: service.requiresHoursOnly,
    requires_start_and_end: service.requiresStartAndEnd,
    min_technician_level: service.minTechnicianLevel,
    commission_percentage: Number(service.commissionPercentage),
    display_order: service.displayOrder,
    is_active: service.isActive,
    launch_phase: service.launchPhase,
    search_keywords: service.searchKeywords,
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
  // docs/08 §36.22-23، ADR-0024 — بالظبط واحد من price_cents/modifier_percentage غير null حسب pricing_mode.
  pricing_mode: ZonePricingMode;
  price_cents: number | null;
  modifier_percentage: number | null;
  inspection_fee_cents: number;
  surge_multiplier: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

export function toServiceZonePricingResponseDto(pricing: ServiceZonePricing): ServiceZonePricingResponseDto {
  return {
    id: pricing.id,
    service_id: pricing.serviceId,
    service_zone_id: pricing.serviceZoneId,
    pricing_mode: pricing.pricingMode,
    price_cents: pricing.priceCents,
    modifier_percentage: pricing.modifierPercentage !== null ? Number(pricing.modifierPercentage) : null,
    inspection_fee_cents: pricing.inspectionFeeCents,
    surge_multiplier: Number(pricing.surgeMultiplier),
    valid_from: pricing.validFrom.toISOString(),
    valid_until: pricing.validUntil ? pricing.validUntil.toISOString() : null,
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

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — نفس نمط ServiceLevelPricingResponseDto فوق بالحرف.
export interface ServicePricingTierPricingResponseDto {
  id: string;
  service_id: string;
  pricing_tier: string;
  price_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export function toServicePricingTierPricingResponseDto(pricing: ServicePricingTierPricing): ServicePricingTierPricingResponseDto {
  return {
    id: pricing.id,
    service_id: pricing.serviceId,
    pricing_tier: pricing.pricingTier,
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

// بيانات قياسية للخدمة + محرك الإنتاجية (docs/06 §3.1-§3.6) — إدارة كاملة (admin بس، فيها
// يومية الصنايعي/المساعد اللي مالهاش داعي تتعرض للعميل — راجع catalog/README.md).
export interface ServiceStandardDataResponseDto {
  id: string;
  service_id: string;
  execution_type_ar: string;
  unit_ar: string;
  technician_daily_wage_cents: number;
  assistant_daily_wage_cents: number | null;
  productivity_per_day: number;
  min_technicians: number;
  min_assistants: number;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export function toServiceStandardDataResponseDto(row: ServiceStandardData): ServiceStandardDataResponseDto {
  return {
    id: row.id,
    service_id: row.serviceId,
    execution_type_ar: row.executionTypeAr,
    unit_ar: row.unitAr,
    technician_daily_wage_cents: row.technicianDailyWageCents,
    assistant_daily_wage_cents: row.assistantDailyWageCents,
    productivity_per_day: Number(row.productivityPerDay),
    min_technicians: row.minTechnicians,
    min_assistants: row.minAssistants,
    is_active: row.isActive,
    display_order: row.displayOrder,
    created_at: row.createdAt.toISOString(),
  };
}

// أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — مرحلة 1: تسجيل بيانات بس.
export interface ServiceProductivityActualResponseDto {
  id: string;
  service_standard_data_id: string;
  order_id: string | null;
  actual_units: number;
  actual_days: number;
  actual_technicians: number;
  actual_assistants: number;
  computed_productivity_per_day: number;
  notes: string | null;
  // system_auto = اتسجّل تلقائيًا عند إكمال طلب حقيقي (migration 0077)، manual = تسجيل يدوي.
  source: string;
  created_at: string;
}

export function toServiceProductivityActualResponseDto(row: ServiceProductivityActual): ServiceProductivityActualResponseDto {
  const actualUnits = Number(row.actualUnits);
  const actualDays = Number(row.actualDays);
  return {
    id: row.id,
    service_standard_data_id: row.serviceStandardDataId,
    order_id: row.orderId,
    actual_units: actualUnits,
    actual_days: actualDays,
    actual_technicians: row.actualTechnicians,
    actual_assistants: row.actualAssistants,
    // الإنتاجية الحقيقية المُحقّقة فعليًا لهذا الصف بس (مش متوسط عام) — الأدمن يقارنها يدويًا
    // بالرقم القياسي (productivity_per_day) دلوقتي؛ المقارنة/التحديث التلقائي مرحلة لاحقة.
    computed_productivity_per_day: actualDays > 0 ? Math.round((actualUnits / actualDays) * 100) / 100 : 0,
    notes: row.notes,
    source: row.source,
    created_at: row.createdAt.toISOString(),
  };
}

// مرحلة 2 من محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) —
// ProductivityLearningService.generateSuggestions().
export interface ServiceProductivitySuggestionResponseDto {
  id: string;
  service_standard_data_id: string;
  current_productivity_per_day: number;
  suggested_productivity_per_day: number;
  sample_size: number;
  confidence_score: number;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
}

export function toServiceProductivitySuggestionResponseDto(row: ServiceProductivitySuggestion): ServiceProductivitySuggestionResponseDto {
  return {
    id: row.id,
    service_standard_data_id: row.serviceStandardDataId,
    current_productivity_per_day: Number(row.currentProductivityPerDay),
    suggested_productivity_per_day: Number(row.suggestedProductivityPerDay),
    sample_size: row.sampleSize,
    confidence_score: Number(row.confidenceScore),
    status: row.status,
    created_at: row.createdAt.toISOString(),
    reviewed_at: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    reviewed_by_user_id: row.reviewedByUserId,
  };
}
