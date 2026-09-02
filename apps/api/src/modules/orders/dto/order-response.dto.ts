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
  /** id العميل صاحب الطلب — كان غايب تمامًا من عقد الأدمن (docs/08 §73 بند 3: "صفحة الطلبات
   * تبقى أداة شاملة لمركز الاتصال")، فمكانش في وجود رابط لبروفايل العميل من تفاصيل الطلب. */
  customer_id: string;
  problem_description: string | null;
  customer_notes: string | null;
  /**
   * إجابات العميل على الفورم الديناميكي وقت الحجز (docs/08 §71) — تسميات عربية محلولة، جاهزة
   * للعرض كسطر واحد. `null` = الخدمة مالهاش حقول ديناميكية أو الطلب اتعمل قبل migration 0201.
   */
  customer_inputs: { key: string; label: string; value: string; unit: string | null }[] | null;
  scheduled_at: string | null;
  // وضع "بداية+نهاية" (ADR-0032) — null دايمًا لأي خدمة تانية غير requiresStartAndEnd.
  scheduled_end_at: string | null;
  /** ADR-0050 §4 — فترة التعاقد اللي السعر اتحسب منها (اشتراك/إيجار)، مش موعد الزيارة. */
  pricing_period_start: string | null;
  pricing_period_end: string | null;
  /** المصدر الدقيق لمدة الحجز؛ duration_hours القديم مشتق/متوافق فقط. */
  duration_minutes: number | null;
  estimated_price_cents: number | null;
  initial_quote_source: 'technician_onsite' | 'admin_remote' | null;
  initial_quote_note: string | null;
  price_status: string;
  price_certainty_mode: string;
  assessment_type: 'remote' | 'onsite' | null;
  remote_assessment_fee_cents: number;
  assessment_fee_credit_cents: number;
  display_price_min_cents: number | null;
  display_price_max_cents: number | null;
  inspection_fee_cents: number;
  /** رسوم الطوارئ الإضافية الصريحة (docs/08 §8) — 0 لأي طلب مش طوارئ. */
  surge_amount_cents: number;
  /** فرق سعر "الفني المميّز" (docs/08 §60.3) — 0 لو العميل اختار الفني بنفسه (الفرق داخل السعر
   * أصلاً) أو لو مستوى الفني مالوش مضاعف. لما يكون > 0 الواجهة بتعرضه كسطر مستقل مكتوب جنبه
   * "فني مميّز" عشان العميل يفهم الزيادة جاية منين، مش يحس إن السعر اتغيّر عليه فجأة. */
  level_premium_cents: number;
  discount_amount_cents: number;
  promo_code_id: string | null;
  total_amount_cents: number;
  /** مسارات الفني تضيف الحقول دي من دفتر الدفعات؛ باقي القوائم قد لا تحملها لتجنب N+1. */
  paid_amount_cents?: number;
  direct_paid_amount_cents?: number;
  financed_order_amount_cents?: number;
  refunded_amount_cents?: number;
  installment_outstanding_cents?: number;
  amount_due_to_technician_cents?: number;
  warranty_plan_id: string | null;
  warranty_price_cents: number;
  optional_warranty: {
    name_ar: string;
    coverage_months: number;
  } | null;
  /** سياسة إيداع (ADR-0027، docs/08 §42 Phase A.3) — null لطلب على خدمة deposit_required=false.
   * لو موجود، ده مبلغ الإيداع المحصّل وقت التأكيد؛ الباقي (total_amount_cents - القيمة دي)
   * بيتحصّل تلقائيًا بعد اكتمال الشغل (نفس مسار البند الإضافي، ADR-0015). */
  deposit_amount_cents: number | null;
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

  // ADR-0051 (docs/08 §96) — حالة تثبيت إعادة الزيارة على الفني الأصلي. الأدمن محتاج يشوف إن
  // الطلب إعادة زيارة **ورايح لمين** بالظبط، وهل اتحرّر للتوزيع العام ولا لسه.
  revisit_pinned_technician_id: string | null;
  revisit_pinned_at: string | null;
  revisit_released_at: string | null;
  revisit_release_reason: string | null;
  /** موجود بس لو الطلب استخدم كود عمارة (docs/08 §13). */
  building_id: string | null;
  /** موجود بس لو الطلب اتولّد تلقائيًا من خطة حجز متكرر (migration 0124) — بيشاور على الخطة
   * نفسها (GET /admin/recurring-orders). null = طلب عادي (حجز يدوي/إعادة زيارة/طوارئ). */
  recurring_template_id: string | null;
  /** موعد النوبة اللي اتولّد منها الطلب (نفس scheduled_for في recurring_order_occurrences) —
   * مفتاح الـidempotency الدائم للتوليد. null لطلبات عادية. */
  recurring_occurrence_at: string | null;
  /** محرك الإنتاجية (docs/06 §3.3-§3.6) — snapshot وقت الحجز، null لو الخدمة formula/fixed
   * بلا بيانات قياسية مُستخدمة. required_technicians/required_assistants هي الطاقم الفعلي
   * (بالحد الأدنى لو العميل ما حددش)، estimated_duration_days المدة المتوقعة بالأيام. */
  standard_data_id: string | null;
  required_technicians: number | null;
  required_assistants: number | null;
  estimated_duration_days: number | null;
  /** كمية التسعير لخدمة بالوحدة؛ null لباقي نماذج التسعير. */
  pricing_quantity: number | null;
  /** موجودة بس في مسارات تفاصيل الطلب الفردي (مش القوائم) — لخرائط التتبع/الملاحة. */
  address?: OrderAddressResponseDto;
  /** رقم تليفون الفني (docs/08 §22 بند 1) — موجود بس بعد تأكيد حجيز حقيقي (TECHNICIAN_CONTACT_VISIBLE_STATUSES)،
   * الكولر (orders.controller.ts) هو المسؤول عن حساب الشرط ده وتمرير القيمة، مش الدالة دي. */
  technician_name?: string;
  technician_phone?: string;
  /** بيانات العميل للفني المعيّن (docs/08 §56 بند 3) — المرآة الحرفية لـtechnician_name/phone فوق:
   * موجودة بس في مسارات `technician/orders/*` وبس بعد تأكيد حجز حقيقي (نفس
   * TECHNICIAN_CONTACT_VISIBLE_STATUSES بالظبط). الفني كان بيشوف شاشة تنفيذ بلا اسم العميل ولا
   * تليفونه خالص — بلاغ مالك مباشر بسكرين شوت. الكولر بيحسب الشرط، مش الدالة دي. */
  customer_name?: string;
  customer_phone?: string;
  /**
   * **مُعرّف المستخدم** للعميل — مش `customer_id` (docs/08 §77-A1، بلاغ مالك).
   *
   * `customer_id` فوق هو `customer_profiles.id` (كده الـFK في `orders` من migration 0007).
   * أي واجهة عايزة تودّي لصفحة العميل محتاجة `users.id`، ولوحة الأدمن كانت بتستخدم
   * `customer_id` مكانه فالصفحة كانت بترجّع 404 **دايمًا**. الحقل ده بيقفل التخمين ده من
   * المصدر: السيرفر بيقول الرقمين، والواجهة ما تحوّلش بينهم.
   *
   * موجود في مسارات تفاصيل الطلب للأدمن بس (نفس شرط `customer_name`/`customer_phone`).
   */
  customer_user_id?: string;
  /** "جديد عليك" (docs/08 §56 بند 2) — true لو الفني المعيّن لسه ما فتحش تفاصيل الطلب ولا مرة.
   * موجود في مسارات الفني بس؛ التطبيق بيستخدمه للتمييز البصري بدل ما يعرض كل حاجة بنفس البروز. */
  is_new_for_technician?: boolean;
  /** اسم الخدمة المطلوبة بالعربي — الفني كان بيشوف رقم الطلب والمبلغ بس، من غير ما يعرف
   * هو رايح يعمل إيه بالظبط. متاح لكل مسارات الفني بلا شرط حالة (مش بيانات شخصية). */
  service_name_ar?: string;
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
  viewerExtras?: {
    customerContact?: { name: string; phone: string; userId?: string } | null;
    serviceNameAr?: string | null;
    isNewForTechnician?: boolean;
  },
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
    customer_id: order.customerId,
    problem_description: order.problemDescription,
    customer_notes: order.customerNotes,
    customer_inputs: order.customerInputs ?? null,
    scheduled_at: order.scheduledAt ? order.scheduledAt.toISOString() : null,
    scheduled_end_at: order.scheduledEndAt ? order.scheduledEndAt.toISOString() : null,
    pricing_period_start: order.pricingPeriodStart ? order.pricingPeriodStart.toISOString() : null,
    pricing_period_end: order.pricingPeriodEnd ? order.pricingPeriodEnd.toISOString() : null,
    duration_minutes: order.durationMinutes ?? (order.durationHours == null ? null : order.durationHours * 60),
    estimated_price_cents: order.estimatedPriceCents,
    initial_quote_source: order.initialQuoteSource,
    initial_quote_note: order.initialQuoteNote,
    price_status: order.priceStatus,
    price_certainty_mode: order.priceCertaintyModeSnapshot,
    assessment_type: order.assessmentType,
    remote_assessment_fee_cents: order.remoteAssessmentFeeCents,
    assessment_fee_credit_cents: order.assessmentFeeCreditCents,
    display_price_min_cents: order.displayPriceMinCentsSnapshot,
    display_price_max_cents: order.displayPriceMaxCentsSnapshot,
    inspection_fee_cents: order.inspectionFeeCents,
    surge_amount_cents: order.surgeAmountCents,
    level_premium_cents: order.levelPremiumCents,
    discount_amount_cents: order.discountAmountCents,
    promo_code_id: order.promoCodeId,
    total_amount_cents: order.totalAmountCents,
    warranty_plan_id: order.warrantyPlanId,
    warranty_price_cents: order.warrantyPriceCents,
    optional_warranty: order.warrantyPlanSnapshot
      ? {
          name_ar: String(order.warrantyPlanSnapshot.name_ar ?? 'ضمان إضافي'),
          coverage_months: Number(order.warrantyPlanSnapshot.coverage_months ?? 0),
        }
      : null,
    deposit_amount_cents: order.depositAmountCents,
    payment_status: order.paymentStatus,
    placed_at: order.placedAt ? order.placedAt.toISOString() : null,
    cancelled_at: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    cancellation_reason_id: order.cancellationReasonId,
    cancellation_fee_cents: order.cancellationFeeCents,
    created_at: order.createdAt.toISOString(),
    warranty_expires_at: order.warrantyExpiresAt ? order.warrantyExpiresAt.toISOString() : null,
    original_order_id: order.parentOrderId,
    revisit_pinned_technician_id: order.revisitPinnedTechnicianId,
    revisit_pinned_at: order.revisitPinnedAt ? order.revisitPinnedAt.toISOString() : null,
    revisit_released_at: order.revisitReleasedAt ? order.revisitReleasedAt.toISOString() : null,
    revisit_release_reason: order.revisitReleaseReason,
    building_id: order.buildingId,
    recurring_template_id: order.recurringTemplateId,
    recurring_occurrence_at: order.recurringOccurrenceAt ? order.recurringOccurrenceAt.toISOString() : null,
    standard_data_id: order.standardDataId,
    required_technicians: order.requiredTechnicians,
    required_assistants: order.requiredAssistants,
    estimated_duration_days: order.estimatedDurationDays,
    pricing_quantity: order.pricingQuantity == null ? null : Number(order.pricingQuantity),
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
    customer_name: viewerExtras?.customerContact?.name,
    customer_phone: viewerExtras?.customerContact?.phone,
    customer_user_id: viewerExtras?.customerContact?.userId,
    service_name_ar: viewerExtras?.serviceNameAr ?? undefined,
    is_new_for_technician: viewerExtras?.isNewForTechnician,
    customer_cash_confirmed_at: order.customerCashConfirmedAt ? order.customerCashConfirmedAt.toISOString() : null,
    technician_cash_not_received_at: order.technicianCashNotReceivedAt
      ? order.technicianCashNotReceivedAt.toISOString()
      : null,
  };
}

/**
 * نسخة الفني من عقد الطلب (docs/08 §60.2، طلب مالك صريح — مُحدَّثة بقاعدة §108-B).
 *
 * **القاعدة الأصلية**: الفني بيشوف الفلوس اللي بتعدّي من إيده وبس — الكاش اللي هيحصّله، ونصيبه
 * هو. أي حاجة اتدفعت أونلاين بتوصله كواقعة («مدفوع») من غير رقم، لأن الرقم فيه نصيب الشركة
 * والضمان والرسوم ودي مش شغله. ومفيش أي تفصيل لتكوين السعر (سعر تقديري/معاينة/طوارئ/خصم/ضمان/
 * إيداع) — «هو بيبان عادي جدًا المبلغ … والشركة بتتصرف».
 *
 * **قاعدة §108-B (بلاغ مالك صريح لاحق، فرض من أساسه)** — الشفافية المالية للطاقم:
 * - كاش بالكامل أو أونلاين بالكامل → **محدّش** يشوف الإجمالي (`total_amount_cents`)، كل واحد
 *   يشوف نصيبه بس. (الاستثناء القديم اللي كان بيظهّر الإجمالي وقت الكاش الكامل اتشال —
 *   `cash_to_collect_cents` بيغطي نفس الاحتياج للقائد/الوحيد أصلًا من غير ما نسمّي الحقل حرفيًا
 *   "إجمالي".)
 * - عربون أونلاين (والباقي كاش) → **القائد فقط (أو الفني الوحيد لو مفيش طاقم)** يشوف
 *   `cash_to_collect_cents` الحقيقي؛ أي عضو تاني في الطاقم بياخد صفر هنا (مش شغله يحصّل حاجة)
 *   — الفلترة بتتم في `PaymentsService.getTechnicianMoneyView()`، مش هنا ولا في التطبيق.
 *
 * الإخفاء بيتم هنا في الباك-إند عمدًا: لو سيبنا الأرقام تخرج واعتمدنا على التطبيق إنه ما يعرضهاش،
 * أي حد يفتح الـAPI بتوكن فني يقراها. الحقول دي **ما بتخرجش على السلك** أصلًا — `total_amount_
 * cents` بقى مش موجود خالص في نسخة الفني (مش استثناء مشروط زي الأول).
 */
export interface TechnicianOrderResponseDto
  extends Omit<
    OrderResponseDto,
    | 'total_amount_cents'
    | 'estimated_price_cents'
    | 'inspection_fee_cents'
    | 'surge_amount_cents'
    | 'level_premium_cents'
    | 'discount_amount_cents'
    | 'warranty_price_cents'
    | 'deposit_amount_cents'
    | 'optional_warranty'
    | 'paid_amount_cents'
    | 'direct_paid_amount_cents'
    | 'financed_order_amount_cents'
    | 'refunded_amount_cents'
    | 'installment_outstanding_cents'
    | 'amount_due_to_technician_cents'
  > {
  /** المطلوب تحصيله من العميل كاش. صفر لأي عضو طاقم مش القائد (docs/08 §108-B) — القائد
   * (أو الفني الوحيد لو مفيش طاقم) بس اللي بيشوف الرقم الحقيقي، هو اللي فعليًا بيحصّله. */
  cash_to_collect_cents: number;
  /** الكاش الذي حصّله الفني بالفعل واتسجل في تسوية الطلب. صفر لأي عضو طاقم مش القائد (نفس السبب). */
  cash_collected_cents: number;
  /** نصيب الفني من الطلب (بعد نسبة الشركة). ظاهر دايمًا، بلا شرح لتكوينه. */
  my_earning_cents: number;
  /** فيه جزء (أو الكل) اتدفع أونلاين — واقعة بلا رقم. */
  has_online_payment: boolean;
  /** كله اتدفع أونلاين ومفيش كاش هيتحصّل خالص. */
  fully_paid_online: boolean;
  /** السعر لسه ما اتحددش فـ`my_earning_cents` بصفر حسابيًا — مش «شغل ببلاش» (docs/08 §64.ب). */
  earning_pending: boolean;
  /** الرقم ده حصّة الفني ده من وعاء الطاقم مش الوعاء كله (ADR-0040). */
  is_crew_share: boolean;
}

export function toTechnicianOrderResponseDto(
  base: OrderResponseDto,
  money: {
    cashToCollectCents: number;
    cashCollectedCents?: number;
    myEarningCents: number;
    hasOnlinePayment: boolean;
    fullyPaidOnline: boolean;
    earningPending?: boolean;
    isCrewShare?: boolean;
  },
): TechnicianOrderResponseDto {
  const {
    total_amount_cents: _totalAmount,
    estimated_price_cents: _estimated,
    inspection_fee_cents: _inspection,
    surge_amount_cents: _surge,
    level_premium_cents: _levelPremium,
    discount_amount_cents: _discount,
    warranty_price_cents: _warrantyPrice,
    deposit_amount_cents: _deposit,
    optional_warranty: _optionalWarranty,
    paid_amount_cents: _paid,
    direct_paid_amount_cents: _directPaid,
    financed_order_amount_cents: _financed,
    refunded_amount_cents: _refunded,
    installment_outstanding_cents: _installmentOutstanding,
    amount_due_to_technician_cents: _amountDue,
    ...visible
  } = base;

  return {
    ...visible,
    cash_to_collect_cents: money.cashToCollectCents,
    cash_collected_cents: money.cashCollectedCents ?? 0,
    my_earning_cents: money.myEarningCents,
    // docs/08 §64.ب — «لسه ما اتحددش» غير «صفر». التطبيق بيكتب نص مختلف تمامًا للحالتين.
    earning_pending: money.earningPending ?? false,
    is_crew_share: money.isCrewShare ?? false,
    has_online_payment: money.hasOnlinePayment,
    fully_paid_online: money.fullyPaidOnline,
    // docs/08 §108-B — total_amount_cents بقى مخفي دايمًا لنسخة الفني، بلا استثناء الكاش الكامل
    // القديم. `cash_to_collect_cents` فوق بيغطي نفس احتياج القائد/الوحيد من غير ما يسمّي الرقم
    // "إجمالي الطلب" حرفيًا لعضو طاقم ممكن ميكونش المفروض يشوفه.
  };
}
