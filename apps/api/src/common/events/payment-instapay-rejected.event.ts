// إكمال تدفق InstaPay اليدوي (ADR-0013 §7) — الأدمن رفض دفعة InstaPay معلّقة لطلب (سبب في `reason`).
// الطلب يفضل بحالته الحالية بلا تغيير — العميل يقدر يعيد المحاولة أو يختار وسيلة تانية.
export const PAYMENT_INSTAPAY_REJECTED_EVENT = 'payment.instapay_rejected';

export class PaymentInstaPayRejectedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly reason: string,
  ) {}
}
