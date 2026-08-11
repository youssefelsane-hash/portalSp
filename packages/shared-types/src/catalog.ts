// مطابق لـ apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts وentities
import type { TechnicianLevel } from './technicians';

export type PricingModel = 'fixed' | 'hourly' | 'per_unit' | 'inspection_then_quote';

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

export interface CreateServiceCategoryBody {
  parent_category_id?: string;
  name_ar: string;
  name_en: string;
  slug: string;
  description_ar?: string;
  icon_url?: string;
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
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  launch_phase: number;
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
  min_technician_level?: string;
  commission_percentage?: number;
  display_order?: number;
  launch_phase?: number;
}

export interface UpdateServiceBody extends Partial<CreateServiceBody> {
  is_active?: boolean;
}

export interface ServiceZonePricingResponseDto {
  id: string;
  service_id: string;
  service_zone_id: string;
  price_cents: number;
  inspection_fee_cents: number;
  surge_multiplier: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
}

export interface UpsertZonePricingBody {
  service_zone_id: string;
  price_cents: number;
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

// أساس محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9) — مرحلة 1: تسجيل بس.
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
