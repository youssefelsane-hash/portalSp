import { apiFetchList } from './api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// مطابق لـ apps/api/src/modules/technicians/dto/technician-booking-list-response.dto.ts بالحرف.
// الحقول دي (is_company وتوابعها) كانت موجودة في رد الباك-إند من زمان ومستخدمة في
// apps/customer-app's technician_marketplace_screen.dart (بادجات "شركة"/"فريق"، توثيق، إلخ) —
// غايبة من الـDTO هنا خالص (مش بس من العرض)، فجوة توازي حقيقية (docs/08 §83 جزء ج).
// avg_arrival_minutes عمدًا مش مضاف — نفس قرار جزء أ (docs/08 §83)، لو المالك عايزه هنا هيتضاف وقتها.
export interface TechnicianBookingListItemDto {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  average_rating: number;
  total_ratings_count: number;
  completed_orders_count: number;
  distance_km: number | null;
  technician_level: string;
  pricing_tier: string;
  final_price_cents: number | null;
  level_price_multiplier: number | null;
  is_verified: boolean;
  on_time_rate: number | null;
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
// مطابق لـ apps/customer-app's technicianLevelLabelsAr بالحرف (models.dart).
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
  params: { bookingMode?: string; fieldValues?: Record<string, string | number | boolean> } = {},
) {
  const query = new URLSearchParams({ address_id: addressId });
  if (params.bookingMode) query.set('booking_mode', params.bookingMode);
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
