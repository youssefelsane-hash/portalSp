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
  /** سياسة إلغاء الفني (docs/10) — لو الطلب awaiting_technician_reselection، الحقل ده بيشاور
   * على الفني اللي لغى بالذات (تفضيل قديم اتسيب عمدًا) عشان apps/customer-app يقدر يستبعده من
   * قايمة اختيار البديل. لباقي الحالات: تفضيل "إعادة الحجز" العادي، ممكن يكون null. */
  requested_technician_id: string | null;
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
  /** رقم تليفون الفني (docs/08 §22 بند 1) — موجود بس بعد تأكيد حجيز حقيقي (TECHNICIAN_CONTACT_VISIBLE_STATUSES)،
   * الكولر (orders.controller.ts) هو المسؤول عن حساب الشرط ده وتمرير القيمة، مش الدالة دي. */
  technician_name?: string;
  technician_phone?: string;
  /** تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — تأكيد العميل وحده مايسوّيش الطلب، بس
   * لازم يظهر في الواجهة عشان العميل يعرف إنه أكّد بالفعل (يمنع تكرار الزرار). */
  customer_cash_confirmed_at: string | null;
  /** لو الفني بلّغ "لم أستلم" (نفس البند فوق) — الطلب بيبقى disputed، وده الحقل اللي يميّز نزاع
   * الكاش عن نزاع الزيارة الفاشلة (resolveFailedVisit) لما order_status=disputed. */
  technician_cash_not_received_at: string | null;
  /** تجنيد فريق ذاتي (docs/08 §31) — موجودين بس في مسارات technician/orders لطلبات booking_mode=team،
   * الكولر (TechnicianOrderExecutionController) هو المسؤول عن حسابهم، مش الدالة المشتركة دي. */
  team_shortage?: boolean;
  team_members_needed?: number;
  /** موجود بس لعضو فريق (مش القائد نفسه) بيشوف تفاصيل طلب مضاف ليه — "قائد الفريق: <الاسم>". */
  team_leader_name?: string;
}

// address اختياري — القوائم (GET /orders، GET /admin/orders) بتفضل من غير join إضافي، مسارات
// تفاصيل الطلب الفردي بس (GET /orders/:id، GET /technician/orders/:id|active) بتمرره.
// technicianContact اختياري كمان — الكولر بيحسب شرط الظهور (TECHNICIAN_CONTACT_VISIBLE_STATUSES)
// قبل ما يجيب البيانات أصلاً، فمفيش استعلام إضافي لو الطلب لسه مش وصل لحالة مسموحة.
export function toOrderResponseDto(
  order: Order,
  address?: Address | null,
  technicianContact?: { name: string; phone: string } | null,
): OrderResponseDto {
  return {
    id: order.id,
    order_number: order.orderNumber,
    service_id: order.serviceId,
    address_id: order.addressId,
    technician_id: order.technicianId,
    order_type: order.orderType,
    booking_mode: order.bookingMode,
    requested_technician_id: order.requestedTechnicianId,
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
    technician_name: technicianContact?.name,
    technician_phone: technicianContact?.phone,
    customer_cash_confirmed_at: order.customerCashConfirmedAt ? order.customerCashConfirmedAt.toISOString() : null,
    technician_cash_not_received_at: order.technicianCashNotReceivedAt
      ? order.technicianCashNotReceivedAt.toISOString()
      : null,
  };
}
