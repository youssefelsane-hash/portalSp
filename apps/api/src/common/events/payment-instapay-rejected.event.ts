// إكمال تدفق InstaPay اليدوي (ADR-0013 §7) — الأدمن رفض دفعة InstaPay معلّقة (سبب في `reason`).
// الطلب يفضل PENDING_PAYMENT بلا تغيير حالة — العميل يقدر يعيد المحاولة أو يختار وسيلة تانية.
export const PAYMENT_INSTAPAY_REJECTED_EVENT = 'payment.instapay_rejected';

export class PaymentInstaPayRejectedEvent {
  constructor(
    public readonly orderId: string,
    public readonly customerId: string,
    public readonly reason: string,
  ) {}
}
