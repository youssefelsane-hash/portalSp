// طلب متولّد من قالب متكرر واقف في PENDING_PAYMENT (دفع مقدّم كارت/InstaPay، ADR-0013) —
// بيتصدّر مرة واحدة بس لكل توليد ناجح (بعد completeOccurrence)، عشان العميل يتعرف إن فيه طلب
// جديد محتاج دفعه. من غيره: ORDER_CREATED_EVENT مش بيتصدّر لطلبات PENDING_PAYMENT أصلًا
// (pay-before-dispatch)، فالعميل مش هيشوف غير طلبه بيتلغى تلقائيًا بعد مهلة الدفع بصمت.
export const RECURRING_ORDER_AWAITING_PAYMENT_EVENT = 'orders.recurring_order_awaiting_payment';

export class RecurringOrderAwaitingPaymentEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
  ) {}
}
