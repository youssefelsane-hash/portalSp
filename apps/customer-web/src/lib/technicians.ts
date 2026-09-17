import { apiFetchList } from './api-client';
import type { PricingFieldValue } from './api-types';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// مطابق لـ apps/api/src/modules/technicians/dto/technician-booking-list-response.dto.ts بالحرف.
// الحقول دي (is_company وتوابعها) كانت موجودة في رد الباك-إند من زمان ومستخدمة في
// apps/customer-app's technician_marketplace_screen.dart (بادجات "شركة"/"فريق"، توثيق، إلخ) —
// غايبة من الـDTO هنا خالص (مش بس من العرض)، فجوة توازي حقيقية (docs/08 §83 جزء ج).
// **مؤشر الوصول بقى مفهومين حسب أفق الطلب** (ADR-0099، docs/08 §153) — والسيرفر هو اللي
// بيقرر، فالحقل اللي مش بتاع الوضع الحالي بيرجع null ومفيش أي شرط بيتكرر هنا.
export interface TechnicianBookingListItemDto {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  average_rating: number;
  total_ratings_count: number;
  /** طلبات الفني في الخدمة دي وحدها — مش إجماليه (docs/08 §153). */
  service_completed_count: number;
  /** إجمالي شغله على المنصّة كلها. */
  total_completed_count: number;
  distance_km: number | null;
  technician_level: string;
  /** اسم المستوى زي ما الأدمن ضابطه — بدل خريطة ثابتة في كود الواجهة. */
  technician_level_label_ar: string | null;
  pricing_tier: string;
  final_price_cents: number | null;
  level_price_multiplier: number | null;
  is_verified: boolean;
  arrival_metric_mode: 'expected_arrival' | 'punctuality';
  /** الطلب قريب: متوسط الوصول لنفس المنطقة. null = مفيش رقم يستاهل العرض. */
  expected_arrival_minutes: number | null;
  /** الطلب مجدول: الالتزام بالمواعيد. null = العيّنة أصغر من إنها تتعرض. */
  punctuality: {
    on_time_rate: number;
    sample_count: number;
    average_late_minutes: number | null;
  } | null;
  is_company: boolean;
  staff_count: number | null;
  branch_count: number | null;
  company_id: string | null;
  company_name: string | null;
  is_commercial_company: boolean;
  availability_status: 'available' | 'schedule_conflicted';
  unavailable_reason_ar: string | null;
  available_again_at: string | null;
}

// اختيار الفني قبل الحجز (docs/08 §3، Script 3 §32-35) — @Public() في الباك-إند، محتاج address_id
// عشان يحسب المسافة/يفلتر على المنطقة. مطابق لـapps/customer-app's TechniciansRepository.listForService
// بالحرف — نفس الـendpoint، نفس المرشّحات.
// **بديل احتياطي بس** — المصدر الحقيقي بقى `technician_level_config.display_name_ar` من
// السيرفر (`technician_level_label_ar`، docs/08 §153). الخريطة دي بتشتغل للسطوح اللي لسه
// مابتستقبلش الحقل (بروفايل عام، قايمة الفنيين العامة). ممنوع تتوسّع — أي تسمية جديدة مكانها
// اللوحة مش الكود.
export const TECHNICIAN_LEVEL_LABELS_AR: Record<string, string> = {
  new: 'جديد',
  verified: 'موثّق',
  professional: 'محترف',
  premium: 'مميز',
  team_leader: 'قائد فريق',
};

export function fetchTechniciansForService(
  serviceId: string,
  addressId: string,
  params: {
    /**
     * **حقيقة مش قرار** (ADR-0106). والأهم: فضاء الأهلية (فلترة `eligible_for_team_booking`)
     * بقى **مشتقّ على السيرفر** من نفس `resolveBookingMode()` اللي إنشاء الطلب بيستخدمها —
     * فالويب والتطبيق بيرجّعوا نفس القايمة بالبناء، مش بالاتفاق.
     */
    sameDayUrgent?: boolean;
    fieldValues?: Record<string, PricingFieldValue>;
    scheduledAt?: string;
  } = {},
) {
  const query = new URLSearchParams({ address_id: addressId });
  if (params.sameDayUrgent) query.set('booking_mode', 'emergency');
  if (params.scheduledAt) query.set('scheduled_at', params.scheduledAt);
  if (params.fieldValues && Object.keys(params.fieldValues).length > 0) {
    query.set('field_values', JSON.stringify(params.fieldValues));
  }
  return apiFetchList<TechnicianBookingListItemDto>(`/services/${serviceId}/technicians?${query.toString()}`);
}

// بروفايل الفني العام (docs/08 §82 — توازي الميزات مع apps/customer-app) — مطابق لـ
// apps/api/src/modules/technicians/dto/public-technician-profile-response.dto.ts بالحرف.
// @Roles(CUSTOMER, ADMIN) في الباك-إند — محتاج authedFetch (مش apiFetchList العام).
export interface TechnicianProfileZoneDto {
  id: string;
  name_ar: string;
}

export interface TechnicianProfileServiceDto {
  id: string;
  name_ar: string;
  base_price_cents: number;
}

export interface TechnicianProfileReviewDto {
  overall_rating: number;
  comment: string | null;
  created_at: string;
}

// شهادات الفني (docs/08 §83 جزء ج) — كانت غايبة من الـDTO هنا خالص رغم إن الباك-إند بيرجّعها
// من زمان (PublicCertificateResponseDto) وFlutter بيعرضها. portfolio_links لسه مؤجّلة عمدًا
// (docs/08 §82) — محتاجة تصميم embed فيديو منفصل للويب، الشهادات مفيهاش فيديو فالفجوة دي بتتقفل.
export interface TechnicianCertificateDto {
  id: string;
  title: string;
  issuer_name: string | null;
  issued_at: string | null;
  file_url: string;
}

export interface TechnicianProfileDto {
  id: string;
  technician_code: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  years_of_experience: number;
  verification_status: string;
  is_trust_verified: boolean;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  cancellation_rate: number | null;
  on_time_rate: number | null;
  zones: TechnicianProfileZoneDto[];
  services: TechnicianProfileServiceDto[];
  recent_reviews: TechnicianProfileReviewDto[];
  certificates: TechnicianCertificateDto[];
}

export const fetchTechnicianProfile = (authedFetch: AuthedFetch, technicianId: string) =>
  authedFetch<TechnicianProfileDto>(`/technicians/${technicianId}/profile`);

// ─────────────────────────────────────────────────────────────────────────────
// اقتراح المواعيد (ADR-0088، docs/08 §141)
//
// الاقتراح **مش قيد**: العميل يقدر يتجاهله ويكتب أي يوم/ساعة بإيده. الغرض إن الخانة الفاضية
// يبقى فيها ٣ ضغطات جاهزة مبنية على طاقة الصنايعية الحقيقية بدل ما العميل يخمّن.
// مطابق لـ apps/api/src/modules/technicians/booking-slots.controller.ts بالحرف.
// ─────────────────────────────────────────────────────────────────────────────

export interface SuggestedDayDto {
  /** YYYY-MM-DD بتوقيت مصر. */
  day: string;
  available_technicians: number;
  is_earliest: boolean;
}

export interface SuggestedDaysResponseDto {
  days: SuggestedDayDto[];
  lead_hours: number;
  horizon_days: number;
}

export interface SuggestedTimeDto {
  /** HH:MM بتوقيت مصر. */
  time: string;
  free_technicians: number;
}

/**
 * **حمل الشغلانة — المدة بالدقايق و/أو بالأيام** (ADR-0100).
 *
 * الاتنين لازم يتبعتوا مع بعض: منهم الباك-إند بيشتق **مدى الشغل** وبيفحص أيامه كلها. الاكتفاء
 * بالدقايق كان بيسيب الشغل المقاس **باليوم** (مفيش دقايق) بمدى يوم واحد، فالمنفّذ المشغول في
 * نص المدى يبان متاح.
 */
export interface JobLoadParams {
  durationMinutes?: number | null;
  estimatedDurationDays?: number | null;
}

const appendJobLoad = (query: URLSearchParams, load: JobLoadParams) => {
  if (load.durationMinutes) query.set('duration_minutes', String(Math.round(load.durationMinutes)));
  if (load.estimatedDurationDays) {
    query.set('estimated_duration_days', String(Math.ceil(load.estimatedDurationDays)));
  }
};

export const fetchSuggestedDays = (
  authedFetch: AuthedFetch,
  params: { serviceId: string; addressId: string } & JobLoadParams,
) => {
  const query = new URLSearchParams({ service_id: params.serviceId, address_id: params.addressId });
  appendJobLoad(query, params);
  return authedFetch<SuggestedDaysResponseDto>(`/booking-slots/days?${query.toString()}`);
};

export const fetchSuggestedTimes = (
  authedFetch: AuthedFetch,
  params: { serviceId: string; addressId: string; day: string } & JobLoadParams,
) => {
  const query = new URLSearchParams({
    service_id: params.serviceId,
    address_id: params.addressId,
    day: params.day,
  });
  appendJobLoad(query, params);
  return authedFetch<{ times: SuggestedTimeDto[] }>(`/booking-slots/times?${query.toString()}`);
};
