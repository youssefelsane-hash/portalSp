import { apiFetchList } from './api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

// مطابق لـ apps/api/src/modules/orders/dto/create-order.dto.ts و order-response.dto.ts بالحرف.

export interface CreateOrderBody {
  service_id: string;
  address_id: string;
  booking_mode?: 'individual' | 'team' | 'emergency';
  requested_technician_company_id?: string;
  problem_description?: string;
  customer_notes?: string;
  scheduled_at?: string;
  promo_code?: string;
  field_values?: Record<string, string | number | boolean>;
  payment_method?: 'card' | 'instapay';
}

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
}

// نفس الأسماء الإنسانية المستخدمة في customer-app (orders/models.dart's orderStatusLabelsAr)
// بالحرف — مصدر واحد للمعنى، حتى لو مكرّر textually بين التطبيقين (نفس فلسفة عدم مشاركة كود
// عرض بين منصتين مختلفتين تمامًا في التقنية، بس نفس القيم بالضبط).
export const orderStatusLabelsAr: Record<string, string> = {
  draft: 'مسودة',
  pending_payment: 'في انتظار الدفع',
  searching_technician: 'بيدوّر على فني',
  technician_assigned: 'اتعيّن فني',
  accepted: 'الفني قبل الطلب',
  technician_on_way: 'الفني في الطريق',
  technician_arrived: 'الفني وصل',
  in_progress: 'الشغل شغّال',
  awaiting_quote_approval: 'في انتظار موافقتك على السعر',
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
  'searching_technician',
  'technician_assigned',
  'accepted',
  'technician_on_way',
  'awaiting_quote_approval',
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

export const createOrder = (authedFetch: AuthedFetch, body: CreateOrderBody) =>
  authedFetch<OrderResponseDto>('/orders', { method: 'POST', body: JSON.stringify(body) });

export const listMyOrders = (authedFetch: AuthedFetch) => authedFetch<OrderResponseDto[]>('/orders');

export const getMyOrder = (authedFetch: AuthedFetch, id: string) => authedFetch<OrderResponseDto>(`/orders/${id}`);

export const cancelOrder = (authedFetch: AuthedFetch, id: string, body: { reason?: string; cancellation_reason_id?: string }) =>
  authedFetch<OrderResponseDto>(`/orders/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) });

export const confirmCashHandover = (authedFetch: AuthedFetch, id: string) =>
  authedFetch<OrderResponseDto>(`/orders/${id}/confirm-cash-handover`, { method: 'POST' });

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
