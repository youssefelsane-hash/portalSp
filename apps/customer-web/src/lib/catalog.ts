import { apiFetch, apiFetchList } from './api-client';
import { PriceEstimateDto, PricingFieldDto, PricingFieldValue, ServiceCategoryDto, ServiceDto } from './api-types';

// كتالوج عام — مفيش access_token مطلوب (Public() في الباك-إند)، نفس نمط
// apps/customer-app/lib/features/catalog/catalog_repository.dart بالحرف.
function withZone(path: string, zoneId?: string): string {
  if (!zoneId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}zone_id=${encodeURIComponent(zoneId)}`;
}

export const fetchCategories = (zoneId?: string) =>
  // الكتالوج يتغير من لوحة الإدارة؛ لا نسمح لنسخة متصفح قديمة أن تخفي فئات مضافة حديثًا.
  apiFetchList<ServiceCategoryDto>(withZone('/service-categories', zoneId), null, { cache: 'no-store' });

export const fetchServices = (categoryId?: string, zoneId?: string) => {
  const query = new URLSearchParams();
  if (categoryId) query.set('category_id', categoryId);
  if (zoneId) query.set('zone_id', zoneId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiFetchList<ServiceDto>(`/services${suffix}`);
};

export const fetchMostRequestedServices = (zoneId?: string) =>
  apiFetchList<ServiceDto>(withZone('/services/most-requested', zoneId), null, { cache: 'no-store' });

export const fetchService = (id: string, zoneId?: string) =>
  apiFetch<ServiceDto>(withZone(`/services/${id}`, zoneId), null);

export const searchServices = (q: string, zoneId?: string) => {
  const trimmed = q.trim();
  if (trimmed.length < 2) return Promise.resolve<ServiceDto[]>([]);
  const query = new URLSearchParams({ q: trimmed });
  if (zoneId) query.set('zone_id', zoneId);
  return apiFetchList<ServiceDto>(`/services/search?${query.toString()}`);
};

export const fetchPricingFields = (serviceId: string) => apiFetchList<PricingFieldDto>(`/services/${serviceId}/pricing-fields`);

export const estimatePrice = (
  serviceId: string,
  params: {
    zoneId?: string;
    /**
     * **حقيقة مش قرار** (ADR-0106): «الحجز ده لنفس اليوم؟». الـwire لسه `booking_mode`
     * (`emergency`) للتوافق مع نسخ التطبيق المنشورة، بس العميل مابقاش بيشتقّ وضع حجز خاص بيه —
     * السيرفر هو اللي بيشتقّ الوضع النهائي (`resolveBookingMode`).
     */
    sameDayUrgent?: boolean;
    fieldValues?: Record<string, PricingFieldValue>;
    pricingQuantity?: number;
    durationHours?: number;
    // ADR-0050 §4 — فترة التعاقد لخدمة شهرية؛ عدد شهور الفوترة بيتحسب في الباك-إند من الفرق
    // بينهم بالتقويم، مش من رقم بيكتبه العميل.
    periodStart?: string;
    periodEnd?: string;
  },
) => {
  const query = new URLSearchParams();
  if (params.zoneId) query.set('zone_id', params.zoneId);
  if (params.sameDayUrgent) query.set('booking_mode', 'emergency');
  if (params.fieldValues) query.set('field_values', JSON.stringify(params.fieldValues));
  if (params.pricingQuantity !== undefined) query.set('pricing_quantity', String(params.pricingQuantity));
  if (params.durationHours !== undefined) query.set('duration_hours', String(params.durationHours));
  if (params.periodStart) query.set('period_start', params.periodStart);
  if (params.periodEnd) query.set('period_end', params.periodEnd);
  return apiFetch<PriceEstimateDto>(`/services/${serviceId}/estimate?${query.toString()}`, null, { method: 'POST' });
};
