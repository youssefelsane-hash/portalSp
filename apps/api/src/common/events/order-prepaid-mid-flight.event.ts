/**
 * ADR-0091 §4-٥ — العميل دفع الطلب أونلاين **والشغل لسه شغّال**.
 *
 * الحدث ده موجود عشان حالة الطلب مابتتغيّرش في اللحظة دي، فمفيش
 * `ORDER_STATUS_CHANGED_EVENT` يحمل الخبر — وبثّ انتقال وهمي "اكتمل" عشان الإشعار بس كان
 * هيقفل الشات ويعيد حساب إحصائيات فني لسه ما سلّمش.
 *
 * **بيبلّغ الفني بس عمدًا**: العميل هو اللي بدأ الدفع وشايف نتيجته في التطبيق، وعلى مسار
 * InstaPay بياخد `payment.instapay_confirmed` أصلاً — فإضافة إشعار عميل هنا كانت هتتكرّر.
 */
export const ORDER_PREPAID_MID_FLIGHT_EVENT = 'order.prepaid_mid_flight';

export class OrderPrepaidMidFlightEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    /** قائد الطلب — `null` لو لسه ما اتوزّعش، ووقتها مفيش حد يتبلّغ. */
    public readonly technicianId: string | null,
    /** الطلب اتغطّى أونلاين بالكامل — مفيش كاش هيتحصّل من العميل. */
    public readonly fullyCoveredOnline: boolean,
  ) {}
}
