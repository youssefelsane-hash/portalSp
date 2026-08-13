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
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.SEARCHING_TECHNICIAN,
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
    OrderStatus.NEEDS_TECHNICIAN_RESELECTION,
    OrderStatus.SEARCHING_TECHNICIAN,
  ],
  [OrderStatus.TECHNICIAN_ON_WAY]: [
    OrderStatus.TECHNICIAN_ARRIVED,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.NEEDS_TECHNICIAN_RESELECTION,
    OrderStatus.SEARCHING_TECHNICIAN,
  ],
  [OrderStatus.TECHNICIAN_ARRIVED]: [
    OrderStatus.IN_PROGRESS,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
    OrderStatus.NEEDS_TECHNICIAN_RESELECTION,
    OrderStatus.SEARCHING_TECHNICIAN,
  ],
  // سياسة إلغاء الفني (ADR-0006) — العميل بيطلب إعادة مطابقة تلقائية (POST /orders/:id/request-rematch)
  // أو يلغي الطلب كله بدل ما يعيد الاختيار.
  [OrderStatus.NEEDS_TECHNICIAN_RESELECTION]: [
    OrderStatus.SEARCHING_TECHNICIAN,
    OrderStatus.CANCELLED_BY_CUSTOMER,
  ],
  [OrderStatus.IN_PROGRESS]: [
    OrderStatus.AWAITING_QUOTE_APPROVAL,
    OrderStatus.WORK_COMPLETED,
    OrderStatus.DISPUTED,
  ],
  [OrderStatus.AWAITING_QUOTE_APPROVAL]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED_BY_CUSTOMER],
  [OrderStatus.WORK_COMPLETED]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.COMPLETED],
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.COMPLETED, OrderStatus.DISPUTED],
  [OrderStatus.COMPLETED]: [OrderStatus.DISPUTED, OrderStatus.REFUNDED],
  [OrderStatus.DISPUTED]: [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED_BY_CUSTOMER]: [],
  [OrderStatus.CANCELLED_BY_TECHNICIAN]: [],
  [OrderStatus.CANCELLED_BY_SYSTEM]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.REFUNDED]: [],
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
  // سياسة إلغاء الفني (ADR-0006) — العميل يقدر يلغي الطلب كله بدل ما يعيد اختيار فني.
  OrderStatus.NEEDS_TECHNICIAN_RESELECTION,
]);

// الحالات اللي الطلب "نشط" فيها من ناحية الفني — مُستخدمة في order-tracking.gateway.ts (تحديد
// آخر طلب نشط للفني وقت بث الموقع) وGET /technician/orders/active (استرجاع حالة التنفيذ بعد
// إعادة فتح التطبيق). بتفترض ضمنياً فني واحد بياخد طلب نشط واحد بس في نفس الوقت — نفس الافتراض
// اللي order-tracking.gateway.ts أصلاً بيعتمد عليه (findOne مش find) قبل ما الملف ده يتلمس.
export const ACTIVE_TECHNICIAN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
  OrderStatus.TECHNICIAN_ARRIVED,
  OrderStatus.IN_PROGRESS,
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
