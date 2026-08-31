import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// مطابق لـ infra/migrations/0007_orders.sql — القائمة الكاملة في docs/02-data-dictionary.md §6.2
export enum OrderStatus {
  DRAFT = 'draft',
  PENDING_PAYMENT = 'pending_payment',
  SEARCHING_TECHNICIAN = 'searching_technician',
  TECHNICIAN_ASSIGNED = 'technician_assigned',
  ACCEPTED = 'accepted',
  TECHNICIAN_ON_WAY = 'technician_on_way',
  TECHNICIAN_ARRIVED = 'technician_arrived',
  IN_PROGRESS = 'in_progress',
  AWAITING_QUOTE_APPROVAL = 'awaiting_quote_approval',
  // معاينة-ثم-سعر (ADR-0044، docs/08 §73 بند 1) — مختلفة عن AWAITING_QUOTE_APPROVAL فوق عمدًا:
  // دي بتؤسس أول سعر لطلب لسه بلا سعر (pricing_model=inspection_then_quote)، مش بتضيف على سعر
  // موجود بالفعل. بتوصل من TECHNICIAN_ARRIVED بس (الفني عاين وحدد سعر).
  AWAITING_INITIAL_QUOTE_APPROVAL = 'awaiting_initial_quote_approval',
  WORK_COMPLETED = 'work_completed',
  AWAITING_PAYMENT = 'awaiting_payment',
  COMPLETED = 'completed',
  CANCELLED_BY_CUSTOMER = 'cancelled_by_customer',
  CANCELLED_BY_TECHNICIAN = 'cancelled_by_technician',
  CANCELLED_BY_SYSTEM = 'cancelled_by_system',
  EXPIRED = 'expired',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
  // سياسة إلغاء الفني (migration 0068، docs/10) — فني لغى طلب كان العميل مختاره بنفسه
  // (requested_technician_id)، ومفيش إعادة مطابقة تلقائية مفعّلة: الطلب محفوظ (مش بيتلغي)،
  // بس محتاج العميل يختار فني بديل بنفسه. راجع OrdersService.technicianCancel().
  AWAITING_TECHNICIAN_RESELECTION = 'awaiting_technician_reselection',
}

// ADR-0051 — أسباب تحرير إعادة زيارة مثبّتة (مطابقة لـchk_orders_revisit_release_reason).
export type RevisitReleaseReason = 'refused' | 'no_response' | 'admin';

export enum OrderType {
  STANDARD = 'standard',
  EMERGENCY = 'emergency',
  SCHEDULED = 'scheduled',
  RECURRING = 'recurring',
  B2B = 'b2b',
  // إعادة زيارة تحت الضمان (docs/08 §7) — مربوطة بـ originalOrderId، مجانية بالكامل وقت الضمان.
  REVISIT = 'revisit',
}

export enum OrderPaymentStatus {
  UNPAID = 'unpaid',
  PENDING = 'pending',
  PAID = 'paid',
  PARTIALLY_REFUNDED = 'partially_refunded',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

// هيكل الحجز الجديد (docs/06 §1، docs/07 الجزء أ) — اختيار العميل الفعلي وقت الحجز: فرد/اعتماد
// (فريق أو شركة)/طوارئ. محور منفصل عن OrderType فوق (اللي بيغطي standard/scheduled/recurring/b2b/
// emergency) — orders.service.ts بيزامن orderType=EMERGENCY تلقائياً لو bookingMode=EMERGENCY.
export enum BookingMode {
  INDIVIDUAL = 'individual',
  TEAM = 'team',
  EMERGENCY = 'emergency',
}

export enum OrderSourceChannel {
  CUSTOMER_APP = 'customer_app',
  WEB = 'web',
  CALL_CENTER = 'call_center',
  B2B_PORTAL = 'b2b_portal',
  WHATSAPP = 'whatsapp',
}

/** بند واحد من إجابات العميل على الفورم الديناميكي — محلول للعرض (docs/08 §71). */
export interface OrderCustomerInput {
  key: string;
  label: string;
  value: string;
  unit: string | null;
}

@Entity('orders')
export class Order {
  @PrimaryColumn('uuid', { default: () => 'uuid_generate_v7()' })
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 24, unique: true })
  orderNumber: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  // تفضيل "إعادة الحجز" بس — مش ضمان، matching.service.ts بيحاول يعرضه عليه في أول جولة
  // بس بيكمّل بالتوزيع العادي لو مش متاح (تفاصيل في matching/README.md).
  @Column({ name: 'requested_technician_id', type: 'uuid', nullable: true })
  requestedTechnicianId: string | null;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId: string;

  @Column({ name: 'address_id', type: 'uuid' })
  addressId: string;

  @Column({ name: 'service_zone_id', type: 'uuid', nullable: true })
  serviceZoneId: string | null;

  @Column({ name: 'order_type', type: 'enum', enum: OrderType, enumName: 'order_type', default: OrderType.STANDARD })
  orderType: OrderType;

  @Column({ name: 'booking_mode', type: 'enum', enum: BookingMode, enumName: 'booking_mode', default: BookingMode.INDIVIDUAL })
  bookingMode: BookingMode;

  // "اعتماد" — تفضيل شركة/فريق بعينه بدل ما تسيب المطابقة تختار. تفضيل بس مش ضمان،
  // نفس فلسفة requestedTechnicianId تحت.
  @Column({ name: 'requested_technician_company_id', type: 'uuid', nullable: true })
  requestedTechnicianCompanyId: string | null;

  // مساحة عمل الشركة (ADR-0033، migration 0173) — snapshot الشركة اللي الطلب اتعيّن لها فعليًا
  // وقت التعيين (MatchingService)، مش استعلام حي. null لأي طلب فني مستقل. مختلفة عن
  // requestedTechnicianCompanyId فوق (تفضيل العميل الأولي، ممكن يختلف عن النتيجة الفعلية) —
  // وبعد ما تتسجّل، مبتتغيّرش حتى لو الفني سايب الشركة بعدين (نفس فلسفة الحفاظ على التاريخ).
  @Column({ name: 'assigned_company_id', type: 'uuid', nullable: true })
  assignedCompanyId: string | null;

  @Column({ name: 'order_status', type: 'enum', enum: OrderStatus, enumName: 'order_status', default: OrderStatus.DRAFT })
  orderStatus: OrderStatus;

  @Column({ name: 'problem_description', type: 'text', nullable: true })
  problemDescription: string | null;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes: string | null;

  /**
   * إجابات العميل على الحقول الديناميكية وقت الحجز (docs/08 §71، migration 0201) — snapshot
   * بتسميات عربية محلولة، للعرض بس (الأدمن/الفني/العميل). التسعير مصدره
   * `service_pricing_evaluations` زي ما هو، مفيش أي حساب بيقرا من هنا.
   */
  @Column({ name: 'customer_inputs', type: 'jsonb', nullable: true })
  customerInputs: OrderCustomerInput[] | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  // وضع "بداية+نهاية" (ADR-0032، migration 0172) — بس لخدمات service.requiresStartAndEnd=true.
  // CHECK constraint chk_orders_scheduled_end_after_start على مستوى الـDB يضمن > scheduled_at.
  @Column({ name: 'scheduled_end_at', type: 'timestamptz', nullable: true })
  scheduledEndAt: Date | null;

  // تصعيد نقص الطاقم (docs/08 §35.5، migration 0156) — علامة "اتصعّد للأدمن مرة" (لمنع التكرار)،
  // مش تذكير متكرر. راجع CrewShortageEscalationService للتفاصيل الكاملة.
  @Column({ name: 'crew_shortage_escalated_at', type: 'timestamptz', nullable: true })
  crewShortageEscalatedAt: Date | null;

  // Durable identity of an automatically generated recurring occurrence. Both
  // columns are null for ordinary orders and unique together for recurring jobs.
  @Column({ name: 'recurring_template_id', type: 'uuid', nullable: true })
  recurringTemplateId: string | null;

  @Column({ name: 'recurring_occurrence_at', type: 'timestamptz', nullable: true })
  recurringOccurrenceAt: Date | null;

  /** المشروع المرتبط (migration 0179) — null لطلبات عادية */
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  /** المرحلة المرتبطة (migration 0179) — null لطلبات مش مرتبطة بمرحلة محددة */
  @Column({ name: 'milestone_id', type: 'uuid', nullable: true })
  milestoneId: string | null;

  @Column({ name: 'estimated_price_cents', type: 'integer', nullable: true })
  estimatedPriceCents: number | null;

  @Column({ name: 'inspection_fee_cents', type: 'integer', default: 0 })
  inspectionFeeCents: number;

  @Column({ name: 'surge_amount_cents', type: 'integer', default: 0 })
  surgeAmountCents: number;

  @Column({ name: 'discount_amount_cents', type: 'integer', default: 0 })
  discountAmountCents: number;

  @Column({ name: 'total_amount_cents', type: 'integer', default: 0 })
  totalAmountCents: number;

  // سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — snapshot وقت إنشاء الطلب من
  // service.depositPercentage (نفس فلسفة standardDataId/requiredTechnicians فوق: تغيير النسبة
  // على الخدمة بعدين ميأثرش على طلبات قديمة). null = خدمة deposit_required=false أو إجمالي صفر.
  @Column({ name: 'deposit_amount_cents', type: 'integer', nullable: true })
  depositAmountCents: number | null;

  // دقة الوقت (ADR-0031 Slice B) — مدة الحجز بالساعات، بس لخدمات service.requiresPreciseSchedule=true
  // (نفس العمود كان domestic_worker_duration_hours، معمّم بعد إلغاء بنية الشغالة المنفصلة).
  @Column({ name: 'duration_hours', type: 'smallint', nullable: true })
  durationHours: number | null;

  // محرك الإنتاجية (docs/06 §3.3-§3.6) — قرار عمل من المالك: القيم دي snapshot وقت الحجز من
  // CatalogService.estimateDuration()، مش مربوطة ديناميكياً بـservice_standard_data بعد كده
  // (لو الأدمن غيّر الإعداد بعدين، الطلب القديم يفضل موضّح بالقيم اللي اتحسبت بيها وقتها).
  @Column({ name: 'standard_data_id', type: 'uuid', nullable: true })
  standardDataId: string | null;

  @Column({ name: 'required_technicians', type: 'smallint', nullable: true })
  requiredTechnicians: number | null;

  @Column({ name: 'required_assistants', type: 'smallint', nullable: true })
  requiredAssistants: number | null;

  @Column({ name: 'estimated_duration_days', type: 'smallint', nullable: true })
  estimatedDurationDays: number | null;

  @Column({ name: 'assistant_daily_wage_cents_snapshot', type: 'integer', nullable: true })
  assistantDailyWageCentsSnapshot: number | null;

  // محرك الإنتاجية الذاتي التعلّم (docs/06 §3.9، migration 0077) — نفس فلسفة snapshot فوق:
  // الوحدات المطلوبة وقت الحجز (requested_units بتاعة CreateOrderDto)، مخزّنة هنا عشان تُستخدم
  // كـactual_units وقت التقاط observation تلقائي عند إكمال الطلب فعليًا.
  @Column({ name: 'requested_units', type: 'numeric', precision: 10, scale: 2, nullable: true })
  requestedUnits: string | null;

  // الكمية التي ضُرب فيها سعر الوحدة وقت الحجز. snapshot مستقلة عن requestedUnits الخاصة
  // بالإنتاجية، حتى يظل تفسير السعر التاريخي واضحًا بعد تعديل الخدمة أو بياناتها القياسية.
  @Column({ name: 'pricing_quantity', type: 'numeric', precision: 10, scale: 2, nullable: true })
  pricingQuantity: string | null;

  // Idempotency-Key اختياري (docs/01 §1.4، migration 0139) — نفس مفتاح مرسل مرتين لنفس العميل
  // يرجّع نفس الطلب الأصلي بدل ما ينشئ نسخة جديدة (double-click/retry). NULL للمسارات الداخلية
  // (recurring-orders) اللي عندها حماية idempotency تانية أصلاً.
  @Column({ name: 'idempotency_key', type: 'varchar', length: 80, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'payment_method', type: 'enum', enum: ['cash', 'card', 'wallet', 'bank_transfer', 'corporate_credit', 'fawry_reference', 'instapay'], enumName: 'payment_method', nullable: true })
  paymentMethod: string | null;

  @Column({ name: 'warranty_plan_id', type: 'uuid', nullable: true })
  warrantyPlanId: string | null;

  @Column({ name: 'warranty_price_cents', type: 'integer', default: 0 })
  warrantyPriceCents: number;

  @Column({ name: 'warranty_plan_snapshot', type: 'jsonb', nullable: true })
  warrantyPlanSnapshot: Record<string, unknown> | null;

  @Column({ name: 'payment_status', type: 'enum', enum: OrderPaymentStatus, enumName: 'order_payment_status', default: OrderPaymentStatus.UNPAID })
  paymentStatus: OrderPaymentStatus;

  @Column({ name: 'promo_code_id', type: 'uuid', nullable: true })
  promoCodeId: string | null;

  // نظام العمائر (docs/08 §13، ADR-0003) — خصم عمارة، متبادل استبعادياً مع promo_code_id فوق.
  @Column({ name: 'building_id', type: 'uuid', nullable: true })
  buildingId: string | null;

  @Column({ name: 'platform_commission_cents', type: 'integer', default: 0 })
  platformCommissionCents: number;

  @Column({ name: 'technician_earning_cents', type: 'integer', default: 0 })
  technicianEarningCents: number;

  @Column({ name: 'commission_rate_applied', type: 'numeric', precision: 5, scale: 2, nullable: true })
  commissionRateApplied: string | null;

  /** وعاء العمولة (ADR-0037، migration 0192) — الجزء من `total_amount_cents` اللي نسبة العمولة
   * بتتطبّق عليه فعلاً: سعر الشغل + اللي سياسة `commission_base.*` بتسمح بيه. أي قرش بره الوعاء
   * (ضمان، فوائد تقسيط، مضاعف تضخم، رسوم طوارئ) بيروح للشركة 100%.
   *
   * `null` = طلب اتعمل قبل الـADR؛ `PaymentsService` بيرجع للسلوك القديم (الوعاء = الإجمالي)
   * للصفوف دي عمدًا عشان إعادة تسوية طلب قديم ما تديش نتيجة مختلفة عن تسويته الأصلية. */
  @Column({ name: 'commissionable_base_cents', type: 'integer', nullable: true })
  commissionableBaseCents: number | null;

  /** Explicit immutable settlement policy for this order. Existing orders remain V1. */
  @Column({ name: 'settlement_policy_version', type: 'smallint', default: 1 })
  settlementPolicyVersion: 1 | 2;

  /** Fixed V2 service commission captured when the order is created. */
  @Column({ name: 'platform_commission_cents_snapshot', type: 'integer', nullable: true })
  platformCommissionCentsSnapshot: number | null;

  /** Final V2 pool distributed across every order participant. */
  @Column({ name: 'worker_pool_cents', type: 'integer', nullable: true })
  workerPoolCents: number | null;

  @Column({ name: 'calculation_algorithm_version', type: 'varchar', length: 40, nullable: true })
  calculationAlgorithmVersion: string | null;

  /** فرق سعر "الفني المميّز" (docs/08 §60.3، migration 0193) — بيتضاف بعد ما المطابقة التلقائية
   * تعيّن فني مستواه بيزوّد السعر. 0 لو الفني كان معروف وقت الحجز (الفرق داخل السعر أصلاً). */
  @Column({ name: 'level_premium_cents', type: 'integer', default: 0 })
  levelPremiumCents: number;

  @Column({ name: 'placed_at', type: 'timestamptz', nullable: true })
  placedAt: Date | null;

  @Column({ name: 'next_matching_attempt_at', type: 'timestamptz', nullable: true })
  nextMatchingAttemptAt: Date | null;

  @Column({ name: 'last_matching_attempt_at', type: 'timestamptz', nullable: true })
  lastMatchingAttemptAt: Date | null;

  @Column({ name: 'matching_attempt_count', type: 'integer', default: 0 })
  matchingAttemptCount: number;

  @Column({ name: 'assigned_at', type: 'timestamptz', nullable: true })
  assignedAt: Date | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  @Column({ name: 'technician_departed_at', type: 'timestamptz', nullable: true })
  technicianDepartedAt: Date | null;

  @Column({ name: 'technician_arrived_at', type: 'timestamptz', nullable: true })
  technicianArrivedAt: Date | null;

  @Column({ name: 'work_started_at', type: 'timestamptz', nullable: true })
  workStartedAt: Date | null;

  @Column({ name: 'work_completed_at', type: 'timestamptz', nullable: true })
  workCompletedAt: Date | null;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  // تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14، migration 0108) — العميل بيأكّد إنه سلّم
  // الفلوس، الفني بيأكّد الاستلام منفصل (collectCash() الموجودة هي التأكيد ده). لو الفني قال
  // "لم أستلم" رغم إن العميل أكّد، ده نزاع حقيقي بيوديه لمراجعة أدمن (Complaint + resolveCashHandoverDispute).
  @Column({ name: 'customer_cash_confirmed_at', type: 'timestamptz', nullable: true })
  customerCashConfirmedAt: Date | null;

  @Column({ name: 'technician_cash_not_received_at', type: 'timestamptz', nullable: true })
  technicianCashNotReceivedAt: Date | null;

  /** أول مرة الفني المعيّن فتح تفاصيل الطلب (docs/08 §56 بند 2) — NULL = لسه "جديد" عليه. */
  @Column({ name: 'technician_viewed_at', type: 'timestamptz', nullable: true })
  technicianViewedAt: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  // الضمان (docs/08 §7) — العمود ده موجود من migration 0007 الأولى بس معمول عليه أي حساب خالص
  // قبل كده (فجوة موثّقة، نفس فئة أعمدة راكدة اتكشفت قبل كده في السيشن ده). بيتحسب فعليًا دلوقتي
  // وقت الاكتمال (paymentsService.settleAndComplete) من services.warranty_days.
  @Column({ name: 'warranty_expires_at', type: 'timestamptz', nullable: true })
  warrantyExpiresAt: Date | null;

  // إعادة الزيارة (docs/08 §7) — بيعيد استخدام parent_order_id الموجود من migration 0007 (كان
  // معرّف بس مش مستخدم خالص في أي كود) بدل ما يتعمل عمود جديد بنفس الغرض بالظبط. الاسم في
  // الـ API/DTOs بره الكلاس ده "original_order_id" (أوضح دلالياً للعميل).
  @Column({ name: 'parent_order_id', type: 'uuid', nullable: true })
  parentOrderId: string | null;

  // ADR-0051 — تثبيت صارم لإعادة الزيارة على الفني الأصلي. مقصود إنه عمود منفصل عن
  // requestedTechnicianId: ده التزام (مفيش fallback، مفيش بث لحد تاني)، وده تفضيل بيتجاهَل بأمان.
  @Column({ name: 'revisit_pinned_technician_id', type: 'uuid', nullable: true })
  revisitPinnedTechnicianId: string | null;

  @Column({ name: 'revisit_pinned_at', type: 'timestamptz', nullable: true })
  revisitPinnedAt: Date | null;

  // حارس الخصم — طالما اتملى، التحرير (وخصم الفني معاه) حصل خلاص ومستحيل يتكرر.
  @Column({ name: 'revisit_released_at', type: 'timestamptz', nullable: true })
  revisitReleasedAt: Date | null;

  @Column({ name: 'revisit_release_reason', type: 'varchar', length: 24, nullable: true })
  revisitReleaseReason: RevisitReleaseReason | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId: string | null;

  @Column({ name: 'cancellation_reason_id', type: 'uuid', nullable: true })
  cancellationReasonId: string | null;

  @Column({ name: 'cancellation_fee_cents', type: 'integer', default: 0 })
  cancellationFeeCents: number;

  @Column({ name: 'has_complaint', type: 'boolean', default: false })
  hasComplaint: boolean;

  @Column({ name: 'source_channel', type: 'enum', enum: OrderSourceChannel, enumName: 'order_source_channel', nullable: true })
  sourceChannel: OrderSourceChannel | null;

  // Call Center — إنشاء طلب نيابة عن عميل (Script 4 §33-37، migration 0131). null = طلب عادي
  // (العميل نفسه أنشأه). موجود لو موظف مركز اتصال أنشأه — الطلب لسه بيتملك للعميل نفسه
  // (customer_id) دايمًا، العمود ده بس للتدقيق (مين ضغط الزرار نيابة عنه).
  @Column({ name: 'created_by_admin_user_id', type: 'uuid', nullable: true })
  createdByAdminUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
