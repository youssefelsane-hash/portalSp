import { ServiceCategory } from '../entities/service-category.entity';
import { AssessmentRoutePolicy, PriceCertaintyMode, Service } from '../entities/service.entity';
import { SchedulePrecision, schedulePrecision } from '../schedule-precision';

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
  featured_icon_url: string | null;
  featured_name_ar: string | null;
  pricing_model: string;
  base_price_cents: number;
  inspection_fee_cents: number;
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
  /** ADR-0060 §4 — حقل واحد بدل أربع بوليانات: `full_day` أو `start_time`. */
  schedule_precision: SchedulePrecision;
  min_technician_level: string;

  // ── سياسة التقييم والمعاينة (ADR-0063/0066، docs/08 §124) ────────────────────────────────
  // **بَقّة عقد حقيقية**: الأعلام الخمسة دي كانت موجودة في DTO الأدمن **بس**. العميل كان بياخد
  // `pricing_model` و`inspection_fee_cents` وخلاص، فتطبيق العميل مكانش عنده أي طريقة يعرف
  // إن التقييم بالصور مقفول أو إن السياسة «معاينة في الموقع فقط» — فكان بيعرض رفع الصور
  // لأي خدمة `inspection_then_quote`، والعميل يرفع صور والباك-إند يرفض: طريق مسدود كامل.
  // (بلاغ مالك: «حرص الصور ده إنه يرفع صور، ما بيمشيش... ومش عارف أعمل معاينة لوحدها»).
  price_certainty_mode: PriceCertaintyMode;
  assessment_route_policy: AssessmentRoutePolicy;
  remote_assessment_enabled: boolean;
  onsite_assessment_enabled: boolean;
  /** رسم التقييم بالصور — بيتحصّل وقت إرسال الصور، والعميل لازم يشوفه قبل ما يبعت. */
  remote_assessment_fee_cents: number;
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
    featured_icon_url: service.featuredIconUrl,
    featured_name_ar: service.featuredNameAr,
    pricing_model: service.pricingModel,
    base_price_cents: service.basePriceCents,
    inspection_fee_cents: service.inspectionFeeCents,
    unit_name_ar: service.unitNameAr,
    quantity_min: service.quantityMin === null ? null : Number(service.quantityMin),
    quantity_max: service.quantityMax === null ? null : Number(service.quantityMax),
    quantity_step: service.quantityStep === null ? null : Number(service.quantityStep),
    quantity_precision: service.quantityPrecision,
    estimated_duration_minutes: service.estimatedDurationMinutes,
    warranty_days: service.warrantyDays,
    price_certainty_mode: service.priceCertaintyMode,
    assessment_route_policy: service.assessmentRoutePolicy,
    remote_assessment_enabled: service.remoteAssessmentEnabled,
    onsite_assessment_enabled: service.onsiteAssessmentEnabled,
    remote_assessment_fee_cents: service.remoteAssessmentFeeCents,
    requires_photos: service.requiresPhotos,
    allows_scheduling: service.allowsScheduling,
    allows_emergency: service.allowsEmergency,
    allows_individual: service.allowsIndividual,
    allows_team: service.allowsTeam,
    cash_allowed: service.cashAllowed,
    deposit_required: service.depositRequired,
    deposit_percentage: service.depositPercentage !== null ? Number(service.depositPercentage) : null,
    allows_date_range_booking: service.allowsDateRangeBooking,
    allows_recurring_booking: service.allowsRecurringBooking,
    show_unavailable_providers: service.showUnavailableProviders,
    schedule_precision: schedulePrecision(service),
    min_technician_level: service.minTechnicianLevel,
  };
}
