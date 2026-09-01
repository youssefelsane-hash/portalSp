import { apiFetch, apiFetchList } from './api-client';
import { PriceEstimateDto, PricingFieldDto, ServiceCategoryDto, ServiceDto } from './api-types';

// كتالوج عام — مفيش access_token مطلوب (Public() في الباك-إند)، نفس نمط
// apps/customer-app/lib/features/catalog/catalog_repository.dart بالحرف.
export const fetchCategories = () => apiFetchList<ServiceCategoryDto>('/service-categories');

export const fetchServices = (categoryId?: string) =>
  apiFetchList<ServiceDto>(`/services${categoryId ? `?category_id=${categoryId}` : ''}`);

export const fetchMostRequestedServices = () => apiFetchList<ServiceDto>('/services/most-requested');

export const fetchService = (id: string) => apiFetch<ServiceDto>(`/services/${id}`, null);

export const searchServices = (q: string) => {
  const trimmed = q.trim();
  if (trimmed.length < 2) return Promise.resolve<ServiceDto[]>([]);
  return apiFetchList<ServiceDto>(`/services/search?q=${encodeURIComponent(trimmed)}`);
};

export const fetchPricingFields = (serviceId: string) => apiFetchList<PricingFieldDto>(`/services/${serviceId}/pricing-fields`);

export const estimatePrice = (
  serviceId: string,
  params: {
    zoneId?: string;
    bookingMode?: string;
    fieldValues?: Record<string, string | number | boolean>;
    pricingQuantity?: number;
    durationHours?: number;
  },
) => {
  const query = new URLSearchParams();
  if (params.zoneId) query.set('zone_id', params.zoneId);
  if (params.bookingMode) query.set('booking_mode', params.bookingMode);
  if (params.fieldValues) query.set('field_values', JSON.stringify(params.fieldValues));
  if (params.pricingQuantity !== undefined) query.set('pricing_quantity', String(params.pricingQuantity));
  if (params.durationHours !== undefined) query.set('duration_hours', String(params.durationHours));
  return apiFetch<PriceEstimateDto>(`/services/${serviceId}/estimate?${query.toString()}`, null, { method: 'POST' });
};
