// §28 — إغلاق فجوة رصد حقيقية: العميل بيدوس "حوّلت" (confirmInstaPayTransferByCustomer) وده كان
// بيتسجّل في القاعدة بلا أي إشارة فعلية لموظف Finance — كان لازم يفتح الطلب بنفسه بالصدفة عشان
// يلاحظ. المنصات الكبيرة (زي أي نظام InstaPay/دفع يدوي احترافي) بتوصل تنبيه فوري لفريق العمليات
// أول ما العميل يبلّغ التحويل، مش تسيبه polling بلا نهاية.
export const PAYMENT_INSTAPAY_TRANSFER_REPORTED_EVENT = 'payment.instapay_transfer_reported';

export class PaymentInstaPayTransferReportedEvent {
  constructor(
    public readonly paymentId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly amountCents: number,
  ) {}
}
