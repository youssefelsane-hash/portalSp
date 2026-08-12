export const ORDER_REMATCH_REQUESTED_EVENT = 'order.rematch_requested';

// بيتصدر من orders module (بعد إلغاء فني بإعادة مطابقة تلقائية، أو بعد طلب عميل صريح لإعادة
// المطابقة على طلب awaiting_technician_reselection) — matching module بيسمعه وينادي
// dispatchNextRound()، نفس فلسفة ORDER_CREATED_EVENT/OrderDispatchListener بالحرف (حدود
// الموديولات: orders ميعرفش تفاصيل خوارزمية التوزيع).
export class OrderRematchRequestedEvent {
  constructor(public readonly orderId: string) {}
}
