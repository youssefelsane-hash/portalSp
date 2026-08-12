// مطابق لـ apps/api/src/modules/orders/dto/order-response.dto.ts وentities/order.entity.ts
export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'searching_technician'
  | 'technician_assigned'
  | 'accepted'
  | 'technician_on_way'
  | 'technician_arrived'
  | 'in_progress'
  | 'awaiting_quote_approval'
  | 'work_completed'
  | 'awaiting_payment'
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_technician'
  | 'cancelled_by_system'
  | 'expired'
  | 'disputed'
  | 'refunded';

export interface OrderResponseDto {
  id: string;
  order_number: string;
  service_id: string;
  address_id: string;
  technician_id: string | null;
  order_type: string;
  // هيكل الحجز الجديد (docs/06 §1) — كانت فجوة موثّقة صراحة (P2 #32/#34): الباك-إند بيرجّع
  // الحقول دي من زمان (order-response.dto.ts) بس النوع هنا كان ناقصهم، فـapps/admin مكانش
  // بيعرضهم خالص رغم إنهم موجودين فعليًا في كل رد GET /admin/orders/:id.
  booking_mode: string;
  order_status: OrderStatus;
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
  /** null = مفيش ضمان أو الطلب لسه ما اكتملش (docs/08 §7). */
  warranty_expires_at: string | null;
  /** موجود بس لو الطلب "إعادة زيارة" — بيشاور على الطلب الأصلي. */
  original_order_id: string | null;
  /** موجود بس لو الطلب استخدم كود عمارة (docs/08 §13). */
  building_id: string | null;
}

export interface OrderStatusHistoryResponseDto {
  id: string;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by_user_id: string | null;
  changed_by_role: string | null;
  change_source: string;
  reason: string | null;
  created_at: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/order-pricing-evaluation-response.dto.ts — للأدمن/
// التشغيل بس (docs/08 §35: وضوح الإنتاجية/المدة المتوقعة). null لأي طلب لخدمة مش formula.
export interface OrderPricingEvaluationResponseDto {
  computed_duration_days: number | null;
  computed_technicians: number | null;
  computed_assistants: number | null;
  field_values: Record<string, unknown>;
  created_at: string;
}

export interface OrderDetailResponseDto extends OrderResponseDto {
  status_history: OrderStatusHistoryResponseDto[];
  pricing_evaluation: OrderPricingEvaluationResponseDto | null;
}

// مطابق لـ apps/api/src/modules/orders/dto/order-media-response.dto.ts
export interface OrderMediaResponseDto {
  id: string;
  media_type: string;
  file_url: string;
  caption: string | null;
  taken_at: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/cancellation-reason-response.dto.ts وentities/cancellation-reason.entity.ts
export type CancellationAppliesTo = 'customer' | 'technician' | 'admin';

export interface CancellationReasonResponseDto {
  id: string;
  reason_ar: string;
  reason_en: string;
  applies_to: CancellationAppliesTo;
  charges_fee: boolean;
  fee_percentage: number;
  affects_technician_score: boolean;
  display_order: number;
  is_active: boolean;
}

export interface CreateCancellationReasonBody {
  reason_ar: string;
  reason_en: string;
  applies_to: CancellationAppliesTo;
  charges_fee?: boolean;
  fee_percentage?: number;
  affects_technician_score?: boolean;
  display_order?: number;
}

export type UpdateCancellationReasonBody = Partial<CreateCancellationReasonBody> & { is_active?: boolean };

// مطابق لـ apps/api/src/modules/orders/dto/order-item-response.dto.ts — بنود عرض السعر
// أثناء التنفيذ (spare_part/extra_labor/addon)، مسار awaiting_quote_approval.
export interface OrderItemResponseDto {
  id: string;
  item_type: string;
  name_ar: string;
  description: string | null;
  quantity: number;
  unit_name: string | null;
  unit_price_cents: number;
  total_price_cents: number;
  is_customer_approved: boolean;
  approved_at: string | null;
  created_at: string;
}
