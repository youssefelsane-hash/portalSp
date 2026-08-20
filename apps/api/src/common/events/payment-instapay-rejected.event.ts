// إكمال تدفق InstaPay اليدوي (ADR-0013 §7) — الأدمن رفض دفعة InstaPay معلّقة (سبب في `reason`).
// الطلب/الحجز يفضل بحالته الحالية بلا تغيير — العميل يقدر يعيد المحاولة أو يختار وسيلة تانية.
export const PAYMENT_INSTAPAY_REJECTED_EVENT = 'payment.instapay_rejected';

// referenceType/referenceId عامّة (docs/adr/0019) — إعادة استخدام نفس الحدث لطلبات orders وحجوزات
// الخدمات المنزلية بدل حدث موازٍ مكرّر لكل نوع.
export type PaymentInstaPayRejectedReferenceType = 'order' | 'domestic_worker_booking';

export class PaymentInstaPayRejectedEvent {
  constructor(
    public readonly referenceType: PaymentInstaPayRejectedReferenceType,
    public readonly referenceId: string,
    public readonly customerId: string,
    public readonly reason: string,
  ) {}
}
