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
  /** موجود بس لو الطلب اتولّد تلقائيًا من خطة حجز متكرر (migration 0124) — بيشاور على الخطة
   * في GET /admin/recurring-orders. null = طلب عادي (حجز يدوي). */
  recurring_template_id: string | null;
  /** موعد النوبة اللي اتولّد منها (مفتاح idempotency التوليد). null لطلبات عادية. */
  recurring_occurrence_at: string | null;
  /** محرك الإنتاجية (docs/06 §3.3-§3.6) — snapshot وقت الحجز من service_standard_data، null لو
   * الخدمة formula (استخدم pricing_evaluation بدلاً منه) أو fixed بلا بيانات قياسية. */
  standard_data_id: string | null;
  required_technicians: number | null;
  required_assistants: number | null;
  estimated_duration_days: number | null;
  /** تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14) — يميّز نزاع الكاش عن نزاع الزيارة الفاشلة
   * لما order_status=disputed (technician_cash_not_received_at != null = نزاع كاش). */
  customer_cash_confirmed_at: string | null;
  technician_cash_not_received_at: string | null;
  /** اسم/تليفون الفني المُعيَّن — للعميل بيظهروا بس بعد تأكيد حجز حقيقي (IDOR)، للأدمن بيظهروا
   * دايمًا طالما فيه فني معيّن (order-response.dto.ts). undefined لو مفيش فني أو الشرط مش متحقق. */
  technician_name?: string;
  technician_phone?: string;
}

// Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37). نفس CreateOrderDto اللي apps/customer-web
// بتستخدمه (تعريف محلي هناك عمداً — راجع customer-web/README.md)، زائد هوية العميل. الطلب
// بيتملك للعميل ده دايمًا، مش للموظف.
export interface CreateOrderForCustomerBody {
  customer_user_id: string;
  service_id: string;
  address_id: string;
  order_type?: string;
  booking_mode?: 'individual' | 'team' | 'emergency';
  requested_technician_company_id?: string;
  problem_description?: string;
  customer_notes?: string;
  scheduled_at?: string;
  promo_code?: string;
  requested_technician_id?: string;
  original_order_id?: string;
  addon_ids?: string[];
  field_values?: Record<string, unknown>;
  payment_method?: string;
  // "كرّر الحجز ده" (migration 0176) — الطلب الحالي بيتعمل بالمسار العادي + قالب متكرر بيتإنشاء
  // بنفس الـtransaction أول موعد له بعد الموعد المحجوز.
  repeat_frequency?: 'weekly' | 'monthly' | 'yearly';
}

export interface CreateOrderForCustomerResponseDto extends OrderResponseDto {
  customer_user_id: string;
  created_by_admin_user_id: string;
  source_channel: string;
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
  requested_technician_company_id: string | null;
  frequency: RecurringOrderFrequency;
  problem_description: string | null;
  // دفع قبل التوزيع (docs/08 §19 بند 6) — كانت فجوة: العمود ده اتضاف لـapps/api's
  // RecurringTemplateResponseDto وماتزامنش هنا وقتها.
  payment_method: 'card' | 'instapay' | null;
  // مدخلات التسعير/التوقيت المتكررة (migration 0176) — مدخلات مش سعر؛ القيمة بتتحسب من محرك
  // التسعير الحي وقت توليد كل طلب.
  field_values: Record<string, string | number | boolean> | null;
  duration_hours: number | null;
  scheduled_end_at: string | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  is_active: boolean;
  created_at: string;
  // موثوقية التوليد (docs/08 §19 بند 20)
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: string | null;
}

// نسخة قديمة محفوظة للتوافق — نفس RecurringTemplateResponseDto زائد customer_id.
export interface AdminRecurringTemplateResponseDto extends RecurringTemplateResponseDto {
  customer_id: string;
}

// صف "خطط الحجز المتكرر" للأدمن (migration 0176) — نتيجة GET /admin/recurring-orders المُثراة
// بأسماء العميل/الخدمة/العنوان وآخر حجز متولّد. دي تعريف التكرار نفسه؛ الطلبات المتولّدة منه
// بتتشاف من /admin/orders?recurring=true وبتتصرف زي أي طلب عادي بالظبط.
export interface AdminRecurringPlanResponseDto {
  id: string;
  customer_id: string;
  customer_full_name: string;
  customer_phone: string;
  service_id: string;
  service_name_ar: string;
  address_id: string;
  address_label: string | null;
  booking_mode: string;
  frequency: RecurringOrderFrequency;
  payment_method: 'card' | 'instapay' | null;
  next_run_at: string;
  last_generated_order_id: string | null;
  last_order_number: string | null;
  last_occurrence_at: string | null;
  is_active: boolean;
  created_at: string;
  cancelled_at: string | null;
  consecutive_failure_count: number;
  last_failure_reason: string | null;
  last_failed_at: string | null;
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

// مطابق لـ apps/api/src/modules/orders/dto/admin-crew-member.dto.ts (Script 4 §22-29, §38-41)
export interface AddCrewMemberBody {
  technician_id: string;
  role_label: string;
}

export interface RemoveCrewMemberBody {
  reason: string;
}

export interface RemoveCrewMemberResponseDto {
  crewShortage: boolean;
}

export interface ReplaceCrewMemberBody {
  new_technician_id: string;
  reason: string;
  role_label?: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/admin-reschedule-order.dto.ts (Script 4 Part K §42)
export interface AdminRescheduleOrderBody {
  new_slot_id: string;
  reason: string;
}

// مطابق لـ apps/api/src/modules/orders/dto/order-timeline-event-response.dto.ts
// (Script 4 Part G §30-32)
export type OrderTimelineEventSource = 'status_history' | 'audit_log' | 'assignment' | 'technician_cancellation';

export interface OrderTimelineEventResponseDto {
  id: string;
  timestamp: string;
  source: OrderTimelineEventSource;
  title: string;
  detail: Record<string, unknown> | null;
  actor_user_id: string | null;
  actor_full_name: string | null;
  actor_user_type: string | null;
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
  proposal_status: 'pending' | 'approved' | 'declined';
  approved_at: string | null;
  declined_at: string | null;
  created_at: string;
}
