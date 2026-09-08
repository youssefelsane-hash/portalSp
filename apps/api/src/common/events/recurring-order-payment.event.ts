/** أحداث مالية للنوبة المتكررة. تُرسل بعد تسجيل الحالة الدائمة، ولا تحتوي بيانات بطاقة. */
export const RECURRING_CARD_PAYMENT_FAILED_EVENT = 'orders.recurring_card_payment_failed';
/** رفض مؤكد من webhook بعد محاولة حفظ البطاقة؛ منفصل عن إشعار العميل لأنّه يحرّك retry أولًا. */
export const RECURRING_CARD_PAYMENT_DECLINED_EVENT = 'orders.recurring_card_payment_declined';

export class RecurringCardPaymentFailedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly attemptNumber: number,
    public readonly cancelled: boolean,
    public readonly failureReason: string,
  ) {}
}

export class RecurringCardPaymentDeclinedEvent {
  constructor(
    public readonly orderId: string,
    public readonly failureReason: string,
  ) {}
}
