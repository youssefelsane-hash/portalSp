import { apiFetchList } from './api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// مطابق لـ apps/api/src/modules/orders/dto/create-order.dto.ts و order-response.dto.ts بالحرف.

export interface CreateOrderBody {
  service_id: string;
  address_id: string;
  booking_mode?: 'individual' | 'team' | 'emergency';
  requested_technician_company_id?: string;
  requested_technician_id?: string;
  problem_description?: string;
  customer_notes?: string;
  scheduled_at?: string;
  // "مرن — نطاق أيام" (docs/08 §83 جزء ب) — لو اتبعت مع scheduled_at، الباك-إند بيدوّر على أقرب
  // يوم بينهم فيه فني مؤهّل. مطابق لـFlutter's ScheduleChoice.rangeEnd بالحرف.
  scheduled_at_range_end?: string;
  // دقة الوقت (ADR-0031 Slice B) — service.requires_precise_schedule=true بس، مطابق لـ
  // create_order_screen.dart's _onDurationHoursChanged بالحرف.
  duration_hours?: number;
  pricing_quantity?: number;
  promo_code?: string;
  field_values?: Record<string, string | number | boolean>;
  payment_method?: 'card' | 'instapay';
  // "كرّر الحجز ده" (migration 0176) — الطلب بيتعمل بالمسار العادي + قالب متكرر بيتإنشاء بنفس
  // العملية أول موعد له بعد الموعد المحجوز. الباك-إند بيرفضه للطوارئ/الخدمات غير مفعّل فيها التكرار.
  repeat_frequency?: 'weekly' | 'monthly' | 'yearly';
  // نسخ سياسات الدفع المقبولة (migration 0177) — إجبارية من الباك-إند لو الخدمة عليها شروط
  accepted_policy_version_ids?: string[];
  problem_image_ids?: string[];
  request_remote_quote?: boolean;
}

export interface PricingFieldImageUploadDto {
  id: string;
  field_id: string;
  file_url: string;
  mime_type: string;
  file_size_bytes: number;
  expires_at: string;
}

export const uploadPricingFieldImage = (
  authedFetch: AuthedFetch,
  serviceId: string,
  fieldId: string,
  file: File,
) => {
  const body = new FormData();
  body.set('service_id', serviceId);
  body.set('field_id', fieldId);
  body.set('file', file);
  return authedFetch<PricingFieldImageUploadDto>('/orders/pricing-field-images', {
    method: 'POST',
    body,
  });
};

export interface ProblemImageUploadDto {
  id: string;
  file_url: string;
  mime_type: string;
  file_size_bytes: number;
  expires_at: string;
}

export const uploadProblemImage = (authedFetch: AuthedFetch, serviceId: string, file: File) => {
  const body = new FormData();
  body.set('service_id', serviceId);
  body.set('file', file);
  return authedFetch<ProblemImageUploadDto>('/orders/problem-images', {
    method: 'POST',
    body,
  });
};

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
  requested_technician_id: string | null;
  requested_technician_company_id: string | null;
  order_status: string;
  problem_description: string | null;
  customer_notes: string | null;
  scheduled_at: string | null;
  estimated_price_cents: number | null;
  inspection_fee_cents: number;
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
  warranty_expires_at: string | null;
  original_order_id: string | null;
  building_id: string | null;
  standard_data_id: string | null;
  required_technicians: number | null;
  required_assistants: number | null;
  estimated_duration_days: number | null;
  address?: OrderAddressResponseDto;
  technician_name?: string;
  technician_phone?: string;
  customer_cash_confirmed_at: string | null;
  technician_cash_not_received_at: string | null;
  initial_quote_source: 'technician_onsite' | 'admin_remote' | null;
  initial_quote_note: string | null;
}

// نفس الأسماء الإنسانية المستخدمة في customer-app (orders/models.dart's orderStatusLabelsAr)
// بالحرف — مصدر واحد للمعنى، حتى لو مكرّر textually بين التطبيقين (نفس فلسفة عدم مشاركة كود
// عرض بين منصتين مختلفتين تمامًا في التقنية، بس نفس القيم بالضبط).
export const orderStatusLabelsAr: Record<string, string> = {
  draft: 'مسودة',
  pending_payment: 'في انتظار الدفع',
  awaiting_admin_quote: 'الإدارة بتراجع الصور وتحدد السعر',
  searching_technician: 'بيدوّر على فني',
  technician_assigned: 'اتعيّن فني',
  accepted: 'الفني قبل الطلب',
  technician_on_way: 'الفني في الطريق',
  technician_arrived: 'الفني وصل',
  in_progress: 'الشغل شغّال',
  awaiting_quote_approval: 'في انتظار موافقتك على السعر',
  awaiting_initial_quote_approval: 'السعر جاهز ومستني موافقتك',
  work_completed: 'الشغل خلص',
  awaiting_payment: 'في انتظار الدفع',
  completed: 'اتقفل',
  cancelled_by_customer: 'اتلغى منك',
  cancelled_by_technician: 'اتلغى من الفني',
  cancelled_by_system: 'اتلغى تلقائياً',
  expired: 'انتهت صلاحيته',
  disputed: 'فيه خلاف',
  refunded: 'اترد',
  awaiting_technician_reselection: 'محتاج تختار فني بديل',
};

export const customerCancellableStatuses = new Set([
  'draft',
  'pending_payment',
  'awaiting_admin_quote',
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'awaiting_quote_approval',
  'awaiting_initial_quote_approval',
  'awaiting_technician_reselection',
]);

export function formatEgp(cents: number): string {
  return `${(cents / 100).toFixed(0)} ج.م.`;
}

export interface CancellationReasonDto {
  id: string;
  reason_ar: string;
  reason_en: string;
  applies_to: string;
  charges_fee: boolean;
  fee_percentage: number;
  affects_technician_score: boolean;
  display_order: number;
  is_active: boolean;
  requires_free_text: boolean;
}

// عامة (Public) — مفيش access_token مطلوب. applies_to=customer بس أسباب مناسبة للعميل يشوفها
// (docs/16 §50 "أسباب إلغاء آمنة للعميل" — مش أسباب داخلية زي "الفني رفض بعد القبول").
export const fetchCustomerCancellationReasons = () =>
  apiFetchList<CancellationReasonDto>('/cancellation-reasons?applies_to=customer');

// Idempotency-Key (docs/01 §1.4، migration 0139، Script 7 Phase 9) — لازم يتولّد مرة واحدة بس
// من الكولر (نفس نمط payWithCard في payments.ts) ويتبعت هنا — أي retry بنفس المفتاح يرجّع نفس
// الطلب الأصلي بدل ما ينشئ نسخة جديدة.
export const createOrder = (authedFetch: AuthedFetch, body: CreateOrderBody, idempotencyKey: string) =>
  authedFetch<OrderResponseDto>('/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  });

export const listMyOrders = (authedFetch: AuthedFetch) => authedFetch<OrderResponseDto[]>('/orders');

export const getMyOrder = (authedFetch: AuthedFetch, id: string) => authedFetch<OrderResponseDto>(`/orders/${id}`);

export const cancelOrder = (authedFetch: AuthedFetch, id: string, body: { reason?: string; cancellation_reason_id?: string }) =>
  authedFetch<OrderResponseDto>(`/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) });

export const confirmCashHandover = (authedFetch: AuthedFetch, id: string) =>
  authedFetch<OrderResponseDto>(`/orders/${id}/confirm-cash-handover`, { method: 'POST' });

export const approveInitialQuote = (
  authedFetch: AuthedFetch,
  id: string,
  paymentChoice: 'cash' | 'electronic' = 'electronic',
) =>
  authedFetch<OrderResponseDto>(`/orders/${id}/initial-quote/approve`, {
    method: 'POST',
    body: JSON.stringify({ payment_choice: paymentChoice }),
  });

export interface OrderItemDto {
  id: string;
  item_type: string;
  name_ar: string;
  description: string | null;
  quantity: number;
  unit_name: string | null;
  unit_price_cents: number;
  total_price_cents: number;
  is_customer_approved: boolean;
  proposal_status: string;
  approved_at: string | null;
  declined_at: string | null;
  created_at: string;
}

export const listQuoteItems = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<OrderItemDto[]>(`/orders/${orderId}/quote-items`);

export const approveQuoteItems = (authedFetch: AuthedFetch, orderId: string, paymentChoice?: 'cash' | 'electronic') =>
  authedFetch<OrderItemDto[]>(`/orders/${orderId}/quote-items/approve`, {
    method: 'POST',
    body: JSON.stringify({ payment_choice: paymentChoice }),
  });

export const declineQuoteItems = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<OrderItemDto[]>(`/orders/${orderId}/quote-items/decline`, { method: 'POST' });

// إعادة جدولة الزيارة (docs/08 §82 — توازي الميزات مع apps/customer-app). متاحة بس والطلب
// technician_assigned/accepted (قبل ما الفني يتحرّك فعليًا) — نفس RESCHEDULABLE_STATUSES في
// orders.service.ts. الباك-إند بيرفض غير كده بوضوح، مفيش داعي نكرر الشرط هنا في الواجهة.
export const RESCHEDULABLE_ORDER_STATUSES = new Set(['technician_assigned', 'accepted']);

export interface RescheduleDateOptionDto {
  date: string;
  available: boolean;
}

export const fetchRescheduleOptions = (authedFetch: AuthedFetch, orderId: string) =>
  authedFetch<RescheduleDateOptionDto[]>(`/orders/${orderId}/reschedule-options`);

// new_scheduled_at يوم بس (مسار ADR-0034 الافتراضي) — نفس الصيغة اللي customer-app بيبعتها بالحرف.
export const rescheduleOrder = (authedFetch: AuthedFetch, orderId: string, date: string) =>
  authedFetch<OrderResponseDto>(`/orders/${orderId}/reschedule`, {
    method: 'POST',
    body: JSON.stringify({ new_scheduled_at: `${date}T00:00:00.000Z` }),
  });
