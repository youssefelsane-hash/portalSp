export const ORDER_QUOTE_EXPIRED_EVENT = 'order.quote.expired';

/**
 * ADR-0067 §2 — عرض سعر عدّى `valid_until` واتقفل بالكاسح الدوري.
 *
 * قبل كده الانتهاء كان كسول بالكامل (مابيتعلّمش غير لما العميل يحاول يوافق متأخر)، فالعميل اللي
 * ماحاولش أصلاً كان طلبه بيفضل معلّق على عرض ميّت للأبد ومحدش بياخد إشعار.
 */
export class OrderQuoteExpiredEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly quoteId: string,
    public readonly amountCents: number,
    /** الفني اللي بعت العرض — null لو العرض كان من الأدمن عن بُعد. */
    public readonly submittedByUserId: string | null,
  ) {}
}
