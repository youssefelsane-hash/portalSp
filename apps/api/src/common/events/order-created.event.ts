export const ORDER_CREATED_EVENT = 'order.created';

export class OrderCreatedEvent {
  // كان فيه هنا `dispatchDeferredUntil?: Date` من آلية تأجيل البث (ADR-0009 بند 1-2). الآلية
  // بقت ميتة عمليًا بعد ADR-0018 (كل طلب غير طوارئ بيتأكّد فورًا، وطلب الطوارئ ميقدرش يكون
  // عنده `scheduled_at` أصلاً) فالقيمة كانت `undefined` دايمًا و`OrderDispatchListener` كان
  // بيتجاهلها تمامًا. اتشالت هي وطابورها وworkerها وإعدادها بالكامل (docs/08 §131).
  constructor(public readonly orderId: string) {}
}
