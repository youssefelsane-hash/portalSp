import { apiFetchList } from './api-client';

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
