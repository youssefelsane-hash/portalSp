// §28 — نظير payment-instapay-rejected.event.ts بالحرف بس للمسار العكسي. كانت فجوة حقيقية: الرفض
// عنده إشعار عميل واضح ومخصوص ("مقدرناش نأكّد تحويلك")، التأكيد كان بيعتمد بس على إشعار حالة
// الطلب العام (ORDER_STATUS_CHANGED_EVENT) اللي مبيوضّحش صراحة إن الدفع اتأكّد.
export const PAYMENT_INSTAPAY_CONFIRMED_EVENT = 'payment.instapay_confirmed';

export class PaymentInstaPayConfirmedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
  ) {}
}
