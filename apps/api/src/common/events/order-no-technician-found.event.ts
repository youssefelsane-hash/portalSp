// قرار عمل صريح من المالك (2026-08-19، بلاغ تاني بعد §19 بند 3) — مفيش إلغاء تلقائي للنظام
// خالص لطلب SEARCHING_TECHNICIAN لمجرد إن مفيش فني اتلاقاله (أو مفيش فني مؤهّل خالص دلوقتي).
// الطلب يفضل SEARCHING_TECHNICIAN للأبد، وMatchingRecoveryService.sweep() الموجودة بالفعل
// (بتشتغل كل دقيقة) بتعيد المحاولة تلقائيًا أول ما فني يبقى متاح. الحدث ده بيتصدّر مرة واحدة بس
// (أول جولة، nextRound===1) عشان ينبّه الأدمن/الموظف يتدخّل يدويًا (تعيين إجباري، أو يكلم فنيين
// يفعّلوا الإتاحية) بدل الانتظار السلبي — مش بديل عن sweep، تنبيه إضافي بس.
export const ORDER_NO_TECHNICIAN_FOUND_EVENT = 'matching.order_no_technician_found';

export class OrderNoTechnicianFoundEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
  ) {}
}
