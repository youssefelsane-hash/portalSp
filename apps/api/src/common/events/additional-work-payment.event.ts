// نتيجة محاولة تحصيل شغل إضافي إلكتروني (docs/08 §21) اتحسمت — نجحت أو فشلت. مستهلَك من
// notifications عشان يبلّغ العميل ببساطة ("تم الدفع بنجاح" / "تعذر الدفع") بمعزل عن تقدّم الشغل.
export const ADDITIONAL_WORK_PAYMENT_RESOLVED_EVENT = 'payment.additional_work_resolved';

export class AdditionalWorkPaymentResolvedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly amountCents: number,
    public readonly customerId: string,
    public readonly succeeded: boolean,
  ) {}
}
