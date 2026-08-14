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
  | 'refunded'
  // سياسة إلغاء الفني (docs/10) — فني لغى طلب كان العميل مختاره بنفسه، مستني العميل يختار بديل.
  | 'awaiting_technician_reselection';

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
  /** سياسة إلغاء الفني (docs/10) — لو awaiting_technician_reselection، بيشاور على الفني اللي لغى. */
  requested_technician_id: string | null;
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
  /** محرك الإنتاجية (docs/06 §3.3-§3.6) — snapshot وقت الحجز من service_standard_data، null لو
   * الخدمة formula (استخدم pricing_evaluation بدلاً منه) أو fixed بلا بيانات قياسية. */
  standard_data_id: string | null;
  required_technicians: number | null;
  required_assistants: number | null;
  estimated_duration_days: number | null;
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

// مطابق لـ apps/api/src/modules/orders/dto/recurring-template-response.dto.ts — الجدولة
// المستقبلية/المتكررة (docs/08 §11). النسخة الأدمن (P2 #32) زائد customer_id.
export type RecurringOrderFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringTemplateResponseDto {
  id: string;
  service_id: string;
  address_id: string;
  booking_mode: string;
  requested_technician_id: string | null;
  frequency: RecurringOrderFrequency;
  problem_description: string | null;
  // دفع قبل التوزيع (docs/08 §19 بند 6) — كانت فجوة: العمود ده اتضاف لـapps/api's
  // RecurringTemplateResponseDto وماتزامنش هنا وقتها.
  payment_method: 'card' | 'instapay' | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  is_active: boolean;
  created_at: string;
  // موثوقية التوليد (docs/08 §19 بند 20)
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: string | null;
}

export interface AdminRecurringTemplateResponseDto extends RecurringTemplateResponseDto {
  customer_id: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/technician-order-cancellation-response.dto.ts (docs/10)
export type CancellationRecoveryAction = 'auto_rematch' | 'manual_reselection_required';

export interface TechnicianOrderCancellationResponseDto {
  id: string;
  technician_id: string;
  cancellation_reason_id: string;
  reason_text: string | null;
  booking_mode: string;
  accepted_at: string;
  cancelled_at: string;
  elapsed_seconds_after_acceptance: number;
  within_policy_window: boolean;
  recovery_action: CancellationRecoveryAction;
  fee_cents: number;
}

export interface OrderDetailResponseDto extends OrderResponseDto {
  status_history: OrderStatusHistoryResponseDto[];
  pricing_evaluation: OrderPricingEvaluationResponseDto | null;
  technician_cancellations: TechnicianOrderCancellationResponseDto[];
}

// مطابق لـ apps/api/src/modules/orders/dto/order-media-response.dto.ts
export interface OrderMediaResponseDto {
  id: string;
  media_type: string;
  file_url: string;
  caption: string | null;
  taken_at: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/team-member-response.dto.ts
export interface TeamMemberResponseDto {
  id: string;
  technician_id: string;
  full_name: string;
  avatar_url: string | null;
  role_label: string;
  // 'assistant' = اتوصل عبر مطابقة المساعد التلقائية (ADR-0007) أو تعيين يدوي من الأدمن
  // (ADR-0008)، 'team_member' = إضافة يدوية من قائد الطلب في "اعتماد" (docs/08 §5).
  member_type: string;
  created_at: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/assign-assistant.dto.ts (ADR-0008)
export interface AssignAssistantBody {
  technician_id: string;
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
  /** سياسة إلغاء الفني (docs/10) — لو true، لازم نص حر معاه (زي "أخرى"). */
  requires_free_text: boolean;
}

export interface CreateCancellationReasonBody {
  reason_ar: string;
  reason_en: string;
  applies_to: CancellationAppliesTo;
  charges_fee?: boolean;
  fee_percentage?: number;
  affects_technician_score?: boolean;
  display_order?: number;
  requires_free_text?: boolean;
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
