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
  ],
  [OrderStatus.TECHNICIAN_ON_WAY]: [
    OrderStatus.TECHNICIAN_ARRIVED,
    OrderStatus.CANCELLED_BY_CUSTOMER,
    OrderStatus.CANCELLED_BY_TECHNICIAN,
  ],
  [OrderStatus.TECHNICIAN_ARRIVED]: [OrderStatus.IN_PROGRESS, OrderStatus.CANCELLED_BY_TECHNICIAN],
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

// الحالات اللي العميل لسه يقدر يلغي فيها بنفسه — بعد ما الفني يوصل ويبدأ الشغل، الإلغاء يبقى شكوى مش cancel
export const CUSTOMER_CANCELLABLE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DRAFT,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.SEARCHING_TECHNICIAN,
  OrderStatus.TECHNICIAN_ASSIGNED,
  OrderStatus.ACCEPTED,
  OrderStatus.TECHNICIAN_ON_WAY,
]);

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
