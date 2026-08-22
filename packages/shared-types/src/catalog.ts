// مطابق لـ apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts وentities
import type { TechnicianLevel, TechnicianPricingTier } from './technicians';

// 'formula' — محرك التسعير الديناميكي (docs/08 §1، ADR-0001)، راجع pricing.ts لباقي أنواعه.
export type PricingModel = 'fixed' | 'hourly' | 'per_unit' | 'inspection_then_quote' | 'formula';

export interface AdminServiceCategoryResponseDto {
  id: string;
  parent_category_id: string | null;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar: string | null;
  icon_url: string | null;
  // Script 6 Part 1-2 — صورة غلاف فعلية للكارت، منفصلة عن icon_url (أيقونة صغيرة).
  cover_image_url: string | null;
  display_order: number;
  is_active: boolean;
  is_featured: boolean;
  launch_phase: number;
  created_at: string;
}

export interface CreateServiceCategoryBody {
  parent_category_id?: string;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar?: string;
  icon_url?: string;
  cover_image_url?: string;
  display_order?: number;
  is_featured?: boolean;
  launch_phase?: number;
}

export interface UpdateServiceCategoryBody extends Partial<CreateServiceCategoryBody> {
  is_active?: boolean;
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
  pricing_model: PricingModel;
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
  cash_allowed: boolean;
  deposit_required: boolean;
  deposit_percentage: number | null;
  allows_date_range_booking: boolean;
  show_unavailable_providers: boolean;
  requires_precise_schedule: boolean;
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  launch_phase: number;
  search_keywords: string[];
  created_at: string;
}

export interface CreateServiceBody {
  category_id: string;
  name_ar: string;
  name_en?: string;
  slug: string;
  short_description_ar?: string;
  full_description_ar?: string;
  icon_url?: string;
  pricing_model: PricingModel;
  base_price_cents: number;
  inspection_fee_cents?: number;
  min_price_cents?: number;
  max_price_cents?: number;
  unit_name_ar?: string;
  estimated_duration_minutes?: number;
  warranty_days?: number;
  requires_photos?: boolean;
  allows_scheduling?: boolean;
  allows_emergency?: boolean;
  allows_individual?: boolean;
  allows_team?: boolean;
  cash_allowed?: boolean;
  deposit_required?: boolean;
  deposit_percentage?: number;
  allows_date_range_booking?: boolean;
  show_unavailable_providers?: boolean;
  requires_precise_schedule?: boolean;
  min_technician_level?: string;
  commission_percentage?: number;
  display_order?: number;
  launch_phase?: number;
  search_keywords?: string[];
}

export interface UpdateServiceBody extends Partial<CreateServiceBody> {
  is_active?: boolean;
}

// docs/08 §36.22-23، ADR-0024 — override (رقم مطلق، السلوك القديم) أو percentage (نسبة مئوية فوق
// base_price_cents، بتتحدّث تلقائيًا مع أي تغيير في السعر الأساسي). بالظبط واحد من price_cents/
// modifier_percentage غير null حسب pricing_mode.
export type ZonePricingMode = 'override' | 'percentage';

export interface ServiceZonePricingResponseDto {
  id: string;
  service_id: string;
  service_zone_id: string;
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

export interface UpsertZonePricingBody {
  service_zone_id: string;
  pricing_mode?: ZonePricingMode;
  price_cents?: number;
  modifier_percentage?: number;
  inspection_fee_cents?: number;
  surge_multiplier?: number;
  valid_from?: string;
}

export type SkillLevel = 'beginner' | 'standard' | 'expert';

export interface EligibleTechnicianResponseDto {
  id: string;
  service_id: string;
  technician_id: string;
  skill_level: SkillLevel;
  is_active: boolean;
  completed_count: number;
  average_rating: number | null;
  created_at: string;
}

export interface AssignTechnicianServiceBody {
  technician_id: string;
  skill_level?: SkillLevel;
}

export interface ServiceLevelPricingResponseDto {
  id: string;
  service_id: string;
  technician_level: TechnicianLevel;
  price_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export interface UpsertLevelPricingBody {
  technician_level: TechnicianLevel;
  price_multiplier: number;
}

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — مرآة كاملة لـServiceLevelPricingResponseDto/
// UpsertLevelPricingBody فوق بالحرف، بس مربوطة بـTechnicianPricingTier (تجاري) مش TechnicianLevel.
export interface ServicePricingTierPricingResponseDto {
  id: string;
  service_id: string;
  pricing_tier: TechnicianPricingTier;
  price_multiplier: number;
  is_active: boolean;
  created_at: string;
}

export interface UpsertPricingTierPricingBody {
  pricing_tier: TechnicianPricingTier;
  price_multiplier: number;
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

export interface CreateServiceAddonBody {
  name_ar: string;
  name_en?: string;
  price_cents: number;
  duration_minutes?: number;
  display_order?: number;
}

export interface UpdateServiceAddonBody extends Partial<CreateServiceAddonBody> {
  is_active?: boolean;
}

// بيانات قياسية للخدمة + محرك الإنتاجية (docs/06 §3.1-§3.6) — مطابق لـ
// apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts's ServiceStandardDataResponseDto.
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

export interface CreateServiceStandardDataBody {
  execution_type_ar?: string;
  unit_ar: string;
  technician_daily_wage_cents: number;
  assistant_daily_wage_cents?: number;
  productivity_per_day: number;
  min_technicians?: number;
  min_assistants?: number;
  display_order?: number;
}

export interface UpdateServiceStandardDataBody extends Partial<CreateServiceStandardDataBody> {
  is_active?: boolean;
}

export interface EstimateDurationBody {
  standard_data_id: string;
  requested_units: number;
  assigned_technicians?: number;
  assigned_assistants?: number;
}

export interface EstimateDurationResponseDto {
  estimated_days: number;
  unit_ar: string;
  execution_type_ar: string;
  assigned_technicians: number;
  assigned_assistants: number;
}

// أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — مرحلة 1: تسجيل (يدوي أو تلقائي عند إكمال طلب).
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

export interface RecordProductivityActualBody {
  order_id?: string;
  actual_units: number;
  actual_days: number;
  actual_technicians: number;
  actual_assistants: number;
  notes?: string;
}

// مرحلة 2 من محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — اقتراح تحديث
// productivity_per_day مبني على median لـobservations حقيقية، بانتظار موافقة/رفض الأدمن.
export interface ServiceProductivitySuggestionResponseDto {
  id: string;
  service_standard_data_id: string;
  current_productivity_per_day: number;
  suggested_productivity_per_day: number;
  sample_size: number;
  confidence_score: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_user_id: string | null;
}
