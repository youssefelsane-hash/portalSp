import { OrderStatus } from './entities/order.entity';

// مصدر الحقيقة الوحيد لانتقالات حالة الطلب — docs/02-data-dictionary.md §6.2 و §14 ("state machine واحدة مقفولة").
// أي انتقال مش موجود هنا = ممنوع، بيرمي ORDR_003.
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.DRAFT]: [
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
    OrderStatus.EXPIRED,
  ],
  // بَقّة حقيقية اتلقطت حيًا (docs/08 §19 بند 1 — أول اختبار حي حقيقي لواجهة اختيار الدفع
  // المسبق في customer-app): CANCELLED_BY_CUSTOMER كانت ناقصة من هنا رغم إن PENDING_PAYMENT
  // مُدرجة صراحة في CUSTOMER_CANCELLABLE_STATUSES تحت — يعني العميل مايقدرش يلغي طلبه بنفسه لو
  // بدأ دفع مسبق (كارت/InstaPay) وغيّر رأيه قبل ما يكمّل الدفع، بيترفض بـ"انتقال حالة غير مسموح"
  // رغم إن الواجهة بتقوله إنه يقدر يلغي. اتأكدت البَقّة حيًا بـflutter test test_live فعلي
  // (POST /orders/:id/cancel رجّع 409 لطلب pending_payment حقيقي).
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.SEARCHING_TECHNICIAN]: [
    OrderStatus.TECHNICIAN_ASSIGNED,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
    OrderStatus.EXPIRED,
  ],
  [OrderStatus.TECHNICIAN_ASSIGNED]: [
    OrderStatus.ACCEPTED,
    OrderStatus.SEARCHING_TECHNICIAN, // الفني رفض/انتهت مهلته → يرجع للبحث
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
  ],
  [OrderStatus.ACCEPTED]: [
    OrderStatus.TECHNICIAN_ON_WAY,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.SEARCHING_TECHNICIAN, // سياسة إلغاء الفني — إعادة مطابقة تلقائية (طوارئ/auto-match)
    OrderStatus.AWAITING_TECHNICIAN_RESELECTION, // سياسة إلغاء الفني — العميل يختار بديل بنفسه
  ],
  [OrderStatus.TECHNICIAN_ON_WAY]: [
    OrderStatus.TECHNICIAN_ARRIVED,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
  ],
  [OrderStatus.TECHNICIAN_ARRIVED]: [
    OrderStatus.IN_PROGRESS,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
    // زيارة فاشلة — الفني وصل والعميل مش موجود/رافض يفتح (docs/08 §22 بند 3). مختلف عن
    // CANCELLED_BY_TECHNICIAN (قرار نهائي من الفني بلا مراجعة) — ده بيوديه لمراجعة أدمن حقيقية
    // (OrdersService.reportFailedVisit → resolveFailedVisit) قبل أي قرار نهائي على الطلب/الفلوس.
    OrderStatus.DISPUTED,
    // معاينة-ثم-سعر (ADR-0044) — الفني عاين المكان وجاهز يحدد سعر أول للطلب (pricing_model=
    // inspection_then_quote). راجع InspectionQuoteService.submitInitialQuote().
    OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
  ],
  [OrderStatus.IN_PROGRESS]: [
    OrderStatus.AWAITING_QUOTE_APPROVAL,
    OrderStatus.WORK_COMPLETED,
    OrderStatus.DISPUTED,
  ],
  [OrderStatus.AWAITING_QUOTE_APPROVAL]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED_BY_CUSTOMER],
  [OrderStatus.AWAITING_ADMIN_QUOTE]: [
    OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
  ],
  // معاينة-ثم-سعر (ADR-0044) — مختلفة عمدًا عن AWAITING_QUOTE_APPROVAL فوق: دي بتؤسس أول سعر
  // لطلب لسه بلا سعر (workPriceCents=0 وقت الحجز)، مش بتضيف على سعر موجود بالفعل. الموافقة
  // (InspectionQuoteService.approveInitialQuote) بترجع الطلب IN_PROGRESS؛ الرفض = cancel عادي
  // (بلا رسوم إلغاء إضافية — رسم المعاينة اتحصّل بالفعل).
  [OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL]: [
    OrderStatus.IN_PROGRESS,
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.CANCELLED_BY_CUSTOMER,
  ],
  // docs/08 §22 بند 13-14 — الفني بلّغ "لم أستلم" الكاش رغم إن الشغل خلص فعلاً.
  [OrderStatus.WORK_COMPLETED]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.COMPLETED, OrderStatus.DISPUTED],
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.COMPLETED, OrderStatus.DISPUTED],
  [OrderStatus.COMPLETED]: [OrderStatus.DISPUTED, OrderStatus.REFUNDED],
  // docs/08 §22 بند 4-5 — حل الزيارة الفاشلة (OrdersService.resolveFailedVisit): "العميل عايز
  // يكمل" → ACCEPTED (نفس الطلب، نفس السعر، الفني يعيد المحاولة من غير أي تحصيل تاني). "العميل
  // عايز يلغي وطلبه كاش (صفر فلوس اتحصّلت أصلاً)" → CANCELLED_BY_CUSTOMER مباشرة بلا استرداد
  // (المنصة بتمتص تكلفة الفني، مفيش فلوس عميل نتخيلها). لو الطلب مدفوع مسبقًا، refundOrder()
  // الموجودة بالفعل بتنقل الطلب لـREFUNDED تلقائيًا لو الاسترداد كامل (بدون رسوم زيارة) — الانتقال
  // ده مُدرج أصلاً تحت مباشرة.
  [OrderStatus.DISPUTED]: [
    OrderStatus.COMPLETED,
    OrderStatus.REFUNDED,
    OrderStatus.ACCEPTED,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    // docs/08 §22 بند 13-14 — نزاع تسليم كاش اتحل بـ"يعيد الفني المحاولة" (resolveCashHandoverDispute
    // outcome=retry) — الطلب يرجع collectCash()-able زي ما كان قبل النزاع.
    OrderStatus.WORK_COMPLETED,
  ],
  [OrderStatus.CANCELLED_BY_CUSTOMER]: [],
  [OrderStatus.CANCELLED_BY_TECHNICIAN]: [],
  [OrderStatus.CANCELLED_BY_SYSTEM]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.REFUNDED]: [],
  // سياسة إلغاء الفني — العميل يقدر يلغي الطلب كله من هنا (مش مجبَر يختار فني بديل)، أو الأدمن
  // يلغيه (مفيش فني بديل متاح مثلاً)، أو العميل/النظام يرجّعوه للمطابقة التلقائية.
  [OrderStatus.AWAITING_TECHNICIAN_RESELECTION]: [
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_SYSTEM,
  ],
};

// الحالات اللي العميل لسه يقدر يلغي فيها بنفسه — بعد ما الفني يوصل ويبدأ الشغل، الإلغاء يبقى شكوى مش cancel.
// استثناء واحد متعمّد: awaiting_quote_approval — لو العميل رافض عرض السعر تماماً وعايز يلغي
// الطلب كله (مش بس البنود الإضافية)، ده مختلف عن "الإلغاء بعد الوصول" العادي لأن الشغل الفعلي
// (غير التشخيص) لسه ما بدأش فعلياً. الـ state machine بتسمح بالانتقال ده صراحة (order-items.service.ts).
export const CUSTOMER_CANCELLABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_ADMIN_QUOTE,
  OrderStatus.AWAITING_TECHNICIAN_RESELECTION,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
]);

// الحالات اللي الطلب "نشط" فيها من ناحية الفني — مُستخدمة في order-tracking.gateway.ts (تحديد
// آخر طلب نشط للفني وقت بث الموقع) وGET /technician/orders/active (استرجاع حالة التنفيذ بعد
// إعادة فتح التطبيق). **تحديث (ADR-0017، migration 0144)**: الافتراض القديم هنا ("فني واحد بياخد
// طلب نشط واحد بس في نفس الوقت") بقى غير صحيح — الفني ممكن يكون عنده طلب ASAP في التنفيذ الفعلي
// وطلب مجدول مستقبلي `ACCEPTED` (مؤكّد تلقائيًا) في نفس الوقت. الكولرز فوق بقيا بيفلتروا كمان على
// `scheduledAt` (بيستبعدوا أي طلب مجدول لسه معاداش موعده) عشان الاستعلام `findOne` يفضل يرجّع
// نتيجة واحدة صحيحة (نفس منطق ASAP-only uniqueness constraint في migration 0144 بالضبط —
// مفروض فعليًا يبقى صف واحد بس "مستحق دلوقتي" في أي لحظة). راجع
// `findUpcomingConfirmedForTechnician()` للطلبات المؤكّدة المستقبلية (عكس الفلتر ده تمامًا).
export const ACTIVE_TECHNICIAN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  // The technician still owns the in-progress job while the customer decides on extra work.
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
];

// الحالات اللي الفني فيها "منشغل فعليًا دلوقتي" جسديًا (ADR-0018 §9) — أضيق من
// ACTIVE_TECHNICIAN_ORDER_STATUSES فوق عمدًا: بتستبعد ACCEPTED (طلب اتقبل/اتأكّد بس الفني لسه
// ما بدأش يتحرّك ليه). مُستخدمة بس لتحديد هل فني عنده طلب مجدول/ASAP مقبول يقدر يستقبل طلب
// طوارئ كمان — طلب مجدول مقبول (accepted) لسه معاداش وقت تنفيذه ميعتبرش الفني "مشغول" لغرض
// الطوارئ، بعكس طلب هو فعليًا في الطريق/واصل/شغال فيه دلوقتي. راجع technician-eligibility.sql.ts.
export const ENGAGED_TECHNICIAN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
];

// الحالات اللي رقم تليفون الفني يظهر فيها للعميل (docs/08 §22 بند 1) — "تأكيد حجيز حقيقي" معناه
// الفني وافق فعليًا (accepted)، مش بس اتعيّن وقاعد ينتظر قبوله (technician_assigned لسه قبلها).
// نفس ACTIVE_TECHNICIAN_ORDER_STATUSES فوق + الحالات اللي بعد بدء الشغل (الفني لسه مرتبط بالطلب).
export const TECHNICIAN_CONTACT_VISIBLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
  OrderStatus.AWAITING_QUOTE_APPROVAL,
  OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
  OrderStatus.WORK_COMPLETED,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.COMPLETED,
]);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
