import { apiFetchList } from './api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// مطابق لـ apps/api/src/modules/technicians/dto/technician-booking-list-response.dto.ts بالحرف.
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
  final_price_cents: number | null;
  level_price_multiplier: number | null;
}

// اختيار الفني قبل الحجز (docs/08 §3، Script 3 §32-35) — @Public() في الباك-إند، محتاج address_id
// عشان يحسب المسافة/يفلتر على المنطقة. مطابق لـapps/customer-app's TechniciansRepository.listForService
// بالحرف — نفس الـendpoint، نفس المرشّحات.
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
  avg_arrival_minutes: number | null;
  avg_completion_minutes: number | null;
  zones: TechnicianProfileZoneDto[];
  services: TechnicianProfileServiceDto[];
  recent_reviews: TechnicianProfileReviewDto[];
}

export const fetchTechnicianProfile = (authedFetch: AuthedFetch, technicianId: string) =>
  authedFetch<TechnicianProfileDto>(`/technicians/${technicianId}/profile`);
