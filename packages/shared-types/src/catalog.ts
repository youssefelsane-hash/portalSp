// مطابق لـ apps/api/src/modules/catalog/dto/admin-catalog-response.dto.ts وentities
import type { TechnicianLevel, TechnicianPricingTier } from './technicians';

// 'formula' — محرك التسعير الديناميكي (docs/08 §1، ADR-0001)، راجع pricing.ts لباقي أنواعه.
// ADR-0060 §1 — قيمتين بس. اللي كان اسمه «سعر ثابت / بالساعة / بالوحدة / شهري» بقى **قوالب**
// بتولّد معادلة (`PRICING_TEMPLATES` في pricing.ts)، مش أوضاع تشغيل.
export type PricingModel = 'inspection_then_quote' | 'formula';

/**
 * دقة الموعد المطلوبة من العميل (ADR-0060 §4) — **وضعين بس**.
 *
 * `full_day` = تاريخ بس، `start_time` = تاريخ + ساعة وصول. الأربع بوليانات القدام
 * (`requires_precise_schedule`, `requires_start_time_only`, `requires_hours_only`,
 * `requires_start_and_end`) اتشالوا: تلاتة منهم كانوا بيطلبوا من العميل **مدخلات تسعير** مش
 * بيانات جدولة، وده اللي كان بيعرض أربع حقول تاريخ على نفس الشاشة.
 */
export const SCHEDULE_PRECISIONS = ['full_day', 'start_time'] as const;
export type SchedulePrecision = (typeof SCHEDULE_PRECISIONS)[number];

export const SCHEDULE_PRECISION_LABELS_AR: Record<SchedulePrecision, string> = {
  full_day: 'يوم كامل',
  start_time: 'وقت بداية فقط',
};

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

export interface AdminServiceResponseDto extends ServiceAssessmentPolicyFields {
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
  pricing_model: PricingModel;
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
  allows_individual: boolean;
  allows_team: boolean;
  cash_allowed: boolean;
  deposit_required: boolean;
  deposit_percentage: number | null;
  allows_date_range_booking: boolean;
  allows_recurring_booking: boolean;
  show_unavailable_providers: boolean;
  /** ADR-0060 §4 — حقل واحد بدل أربع بوليانات تبادلية. */
  schedule_precision: SchedulePrecision;
  min_technician_level: string;
  commission_percentage: number;
  display_order: number;
  is_active: boolean;
  // ADR-0046 — الأدمن سامح للمنصة تعمل إعلان تلقائي عن الخدمة دي؟ افتراضي false: مفيش خدمة
  // بتتعلن لحد ما الأدمن يعلّمها بإيده.
  is_promotable: boolean;
  launch_phase: number;
  search_keywords: string[];
  created_at: string;
}

/**
 * **ADR-0063/0066 — سياسة تحديد السعر والمعاينة** (migration 0247).
 *
 * الأعمدة دي كانت في الداتابيز والكيان من 0247 وما وصلتش الحزمة المشتركة ولا واجهة الأدمن، يعني
 * الأدمن ماكانش يقدر يشغّل رحلة التقييم أصلاً من الشاشة. نفس فئة البَقّة اللي ADR-0064 §2 قفلها
 * لحالات الطلب: العمود موجود، والمفردات ناقصة، فالقدرة غير موجودة عمليًا.
 */
export const PRICE_CERTAINTY_MODES = ['confirmed_price', 'estimated_range', 'assessment_required'] as const;
export type PriceCertaintyMode = (typeof PRICE_CERTAINTY_MODES)[number];

export const PRICE_CERTAINTY_MODE_LABELS_AR: Record<PriceCertaintyMode, string> = {
  confirmed_price: 'سعر مؤكد قبل الحجز',
  estimated_range: 'نطاق تقديري (من — إلى)',
  assessment_required: 'محتاج تقييم قبل السعر',
};

/** مين بيقرر مسار التقييم: الإدارة تفرز، أو المسار مثبّت، أو العميل يختار. */
export const ASSESSMENT_ROUTE_POLICIES = ['admin_triage', 'remote_only', 'onsite_only', 'customer_choice'] as const;
export type AssessmentRoutePolicy = (typeof ASSESSMENT_ROUTE_POLICIES)[number];

export const ASSESSMENT_ROUTE_POLICY_LABELS_AR: Record<AssessmentRoutePolicy, string> = {
  admin_triage: 'الإدارة تفرز بعد الصور',
  remote_only: 'تقييم بالصور فقط',
  onsite_only: 'معاينة في الموقع فقط',
  customer_choice: 'العميل يختار المسار',
};

/** إزاي رسوم التقييم بتتخصم من سعر التنفيذ بعد الموافقة. */
export const ASSESSMENT_FEE_CREDIT_MODES = ['none', 'full', 'percentage'] as const;
export type AssessmentFeeCreditMode = (typeof ASSESSMENT_FEE_CREDIT_MODES)[number];

export const ASSESSMENT_FEE_CREDIT_MODE_LABELS_AR: Record<AssessmentFeeCreditMode, string> = {
  none: 'مابتتخصمش',
  full: 'بتتخصم بالكامل',
  percentage: 'بتتخصم بنسبة',
};

/** الحقول المشتركة بين رد الأدمن وجسم الإنشاء/التعديل — مصدر واحد بدل تكرار 13 حقل مرتين. */
export interface ServiceAssessmentPolicyFields {
  price_certainty_mode: PriceCertaintyMode;
  assessment_route_policy: AssessmentRoutePolicy;
  remote_assessment_enabled: boolean;
  remote_assessment_fee_cents: number;
  onsite_assessment_enabled: boolean;
  assessment_fee_credit_mode: AssessmentFeeCreditMode;
  assessment_fee_credit_bps: number;
  /** ADR-0069 — false = رسم المعاينة بيتحجز لو الزيارة حصلت فعلاً قبل الإلغاء. */
  assessment_fee_refundable_after_visit: boolean;
  onsite_assessor_executes_work: boolean;
  quote_validity_minutes: number;
  /** نسب النطاق التقديري الديناميكي (بند 10) — لو موجودة بتغلب الحقول الثابتة تحت. */
  range_percent_below: number | null;
  range_percent_above: number | null;
  display_price_min_cents: number | null;
  display_price_max_cents: number | null;
  require_admin_review_above_range: boolean;
  max_quote_increase_without_admin_review_bps: number;
}

export interface CreateServiceBody extends Partial<ServiceAssessmentPolicyFields> {
  category_id: string;
  name_ar: string;
  name_en?: string;
  slug: string;
  short_description_ar?: string;
  full_description_ar?: string;
  icon_url?: string;
  featured_icon_url?: string | null;
  featured_name_ar?: string | null;
  pricing_model: PricingModel;
  base_price_cents: number;
  inspection_fee_cents?: number;
  min_price_cents?: number;
  max_price_cents?: number;
  unit_name_ar?: string;
  quantity_min?: number | null;
  quantity_max?: number | null;
  quantity_step?: number | null;
  quantity_precision?: number;
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
  allows_recurring_booking?: boolean;
  show_unavailable_providers?: boolean;
  schedule_precision?: SchedulePrecision;
  min_technician_level?: string;
  display_order?: number;
  launch_phase?: number;
  search_keywords?: string[];
}


export interface UpdateServiceBody extends Partial<CreateServiceBody>, Partial<ServiceAssessmentPolicyFields> {
  is_active?: boolean;
  is_promotable?: boolean;
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
