export const ORDER_QUOTE_ABOVE_RANGE_SUBMITTED_EVENT = 'order.quote.above_range_submitted';

/**
 * ADR-0067 §1 — عرض سعر خرج عن النطاق واتحجز في `pending_admin_review`.
 *
 * القرار ده **مش انتقال حالة** (الطلب بيفضل مكانه والفني لسه في مكان العميل)، فمافيش
 * `ORDER_STATUS_CHANGED_EVENT` يتعلّق عليه إشعار. من غير الحدث ده مفيش أي حاجة بتقول للأدمن إن
 * فيه قرار مستنيه — الطابور كان قناة الاكتشاف الوحيدة.
 */
export class OrderQuoteAboveRangeSubmittedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly quoteId: string,
    public readonly amountCents: number,
    /** سقف النطاق المعروض للعميل وقت الحجز — null لو الخدمة مالهاش نطاق أصلاً. */
    public readonly expectedMaxCents: number | null,
  ) {}
}
