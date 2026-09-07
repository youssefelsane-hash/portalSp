/** أحداث مالية للنوبة المتكررة. تُرسل بعد تسجيل الحالة الدائمة، ولا تحتوي بيانات بطاقة. */
export const RECURRING_CARD_PAYMENT_FAILED_EVENT = 'orders.recurring_card_payment_failed';
export const RECURRING_CASH_REMINDER_EVENT = 'orders.recurring_cash_reminder';

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

export class RecurringCashReminderEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly scheduledAt: Date,
    public readonly totalAmountCents: number,
  ) {}
}
