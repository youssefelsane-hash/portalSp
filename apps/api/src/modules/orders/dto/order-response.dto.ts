import { Address } from '../../customers/entities/address.entity';
import { Order } from '../entities/order.entity';

export interface OrderAddressResponseDto {
  street_name: string;
  landmark: string | null;
  latitude: number;
  longitude: number;
}

export interface OrderResponseDto {
  id: string;
  order_number: string;
  service_id: string;
  address_id: string;
  technician_id: string | null;
  order_type: string;
  booking_mode: string;
  requested_technician_company_id: string | null;
  order_status: string;
  problem_description: string | null;
  customer_notes: string | null;
  scheduled_at: string | null;
  estimated_price_cents: number | null;
  inspection_fee_cents: number;
  /** رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — 0 لأي طلب مش طوارئ. */
  surge_amount_cents: number;
  discount_amount_cents: number;
  promo_code_id: string | null;
  total_amount_cents: number;
  payment_status: string;
  placed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason_id: string | null;
  cancellation_fee_cents: number;
  created_at: string;
  /** null = مفيش ضمان (warranty_days=0) أو الطلب لسه ما اكتملش. الضمان (docs/08 §7). */
  warranty_expires_at: string | null;
  /** موجود بس لو الطلب "إعادة زيارة" (order_type=revisit) — بيشاور على الطلب الأصلي (عمود parent_order_id داخليًا). */
  original_order_id: string | null;
  /** موجود بس لو الطلب استخدم كود عمارة (docs/08 §13). */
  building_id: string | null;
  /** محرك الإنتاجية (docs/06 §3.3-§3.6) — snapshot وقت الحجز، null لو الخدمة formula/fixed
   * بلا بيانات قياسية مُستخدمة. required_technicians/required_assistants هي الطاقم الفعلي
   * (بالحد الأدنى لو العميل ما حددش)، estimated_duration_days المدة المتوقعة بالأيام. */
  standard_data_id: string | null;
  required_technicians: number | null;
  required_assistants: number | null;
  estimated_duration_days: number | null;
  /** موجودة بس في مسارات تفاصيل الطلب الفردي (مش القوائم) — لخرائط التتبع/الملاحة. */
  address?: OrderAddressResponseDto;
}

// address اختياري — القوائم (GET /orders، GET /admin/orders) بتفضل من غير join إضافي، مسارات
// تفاصيل الطلب الفردي بس (GET /orders/:id، GET /technician/orders/:id|active) بتمرره.
export function toOrderResponseDto(order: Order, address?: Address | null): OrderResponseDto {
  return {
    id: order.id,
    order_number: order.orderNumber,
    service_id: order.serviceId,
    address_id: order.addressId,
    technician_id: order.technicianId,
    order_type: order.orderType,
    booking_mode: order.bookingMode,
    requested_technician_company_id: order.requestedTechnicianCompanyId,
    order_status: order.orderStatus,
    problem_description: order.problemDescription,
    customer_notes: order.customerNotes,
    scheduled_at: order.scheduledAt ? order.scheduledAt.toISOString() : null,
    estimated_price_cents: order.estimatedPriceCents,
    inspection_fee_cents: order.inspectionFeeCents,
    surge_amount_cents: order.surgeAmountCents,
    discount_amount_cents: order.discountAmountCents,
    promo_code_id: order.promoCodeId,
    total_amount_cents: order.totalAmountCents,
    payment_status: order.paymentStatus,
    placed_at: order.placedAt ? order.placedAt.toISOString() : null,
    cancelled_at: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    cancellation_reason_id: order.cancellationReasonId,
    cancellation_fee_cents: order.cancellationFeeCents,
    created_at: order.createdAt.toISOString(),
    warranty_expires_at: order.warrantyExpiresAt ? order.warrantyExpiresAt.toISOString() : null,
    original_order_id: order.parentOrderId,
    building_id: order.buildingId,
    standard_data_id: order.standardDataId,
    required_technicians: order.requiredTechnicians,
    required_assistants: order.requiredAssistants,
    estimated_duration_days: order.estimatedDurationDays,
    address: address
      ? {
          street_name: address.streetName,
          landmark: address.landmark,
          longitude: address.location.coordinates[0],
          latitude: address.location.coordinates[1],
        }
      : undefined,
  };
}
