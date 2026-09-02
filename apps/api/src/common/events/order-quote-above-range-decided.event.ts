export const ORDER_QUOTE_ABOVE_RANGE_DECIDED_EVENT = 'order.quote.above_range_decided';

/**
 * ADR-0067 §1 — الأدمن اعتمد أو رفض سعر خارج النطاق.
 *
 * مسار الرفض **مابيغيّرش حالة الطلب** خالص، فماكانش بيتبعت عنه أي حدث: الفني المطلوب منه سعر
 * جديد ماكانش فيه حاجة تقوله. الحدث ده بيغطي القرارين عشان الفني ياخد رد في الحالتين من نفس
 * المكان.
 */
export class OrderQuoteAboveRangeDecidedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly quoteId: string,
    public readonly amountCents: number,
    public readonly approved: boolean,
    public readonly reason: string,
    /** الفني اللي بعت العرض — القرار بيخصّه هو، مش الفني المعيّن على الطلب بالضرورة. */
    public readonly submittedByUserId: string,
  ) {}
}
