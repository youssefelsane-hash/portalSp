export const ORDER_CREATED_EVENT = 'order.created';

export class OrderCreatedEvent {
  constructor(
    public readonly orderId: string,
    // ADR-0009 بند 1-2 (P0-9) — لو موجودة، معناها الطلب ده مجدول "بعيد" (scheduled_at أبعد من
    // matching.deferred_dispatch_lead_hours ومفيش schedule_slot_id صريح): OrderDispatchListener
    // لازم يؤجّل *بث* المطابقة لحد الوقت ده بدل ما يبثه فورًا، بينما باقي الـlisteners (إحصائيات،
    // إشعار "طلبك اتسجّل"، توجيه الطوارئ) بتستمر تشتغل فورًا زي ما هي — التأجيل خاص بالبث بس.
    // محسوبة مرة واحدة في OrdersService.create() (فين dto.schedule_slot_id متاح مباشرة)، مش بتتحسب
    // تاني وقت معالجة الحدث — عشان نتجنب اشتقاق ناقص لاحقًا (requestedTechnicianId مش دليل كافي
    // على وجود schedule_slot_id، بيتحط من مصادر تانية كمان زي إعادة الزيارة والتفضيل العادي).
    public readonly dispatchDeferredUntil?: Date,
  ) {}
}
