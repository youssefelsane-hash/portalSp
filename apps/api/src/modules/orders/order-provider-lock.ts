import { Order } from './entities/order.entity';

/**
 * **هل الطلب ده مقفول على منفّذ بعينه؟** (ADR-0065 §1) — نقطة القراءة الوحيدة للسؤال ده.
 *
 * الفرق اللي العمود ده بيحمله مش تقني، هو تجاري: `requested_technician_id` لوحده معناه
 * **تفضيل** (العميل يفضّل الفني ده، ولو مش متاح ماشي أي حد)، بينما وجوده **مع** تذكرة معاينة
 * مستهلكة معناه **التزام** — العميل شاف اسم الفني ده وسعره هو بالذات ودفع عليه.
 *
 * استبدال منفّذ مقفول بصمت = زيادة سعر صامتة (مستوى الفني التاني ممكن يكون أغلى) + كسر
 * القاعدة المنتجية الحاكمة: «لا يدخل أي مبلغ جديد على العميل بدون أن يعرفه ويوافق عليه».
 *
 * `selected_match_preview_id` بيفضل على الطلب حتى بعد ما القفل ينفك (سجل تاريخي لأي تذكرة
 * أنشأته) — اللي بينفك هو `requested_technician_id`، عشان كده الشرط على الاتنين مش على واحد.
 */
export function orderHasLockedProvider(
  order: Pick<Order, 'selectedMatchPreviewId' | 'requestedTechnicianId'>,
): boolean {
  return order.selectedMatchPreviewId !== null && order.requestedTechnicianId !== null;
}

/**
 * **هل سعر الطلب ده مربوط بمنفّذ بعينه؟** (ADR-0065 §3) — أوسع من `orderHasLockedProvider()`:
 * بتفضل `true` حتى بعد ما القفل ينفك، لأن السؤال هنا مش «مين المنفّذ دلوقتي؟» لكن «الفاتورة دي
 * اتحسبت على أساس فني معيّن؟». وده اللي بيقرر إن إعادة الاختيار لازم تعدّي من تذكرة جديدة بسعر
 * جديد بدل ما ترجّع الطلب للتوزيع بالسعر القديم.
 */
export function orderPriceIsProviderBound(order: Pick<Order, 'bookingContextHash'>): boolean {
  return order.bookingContextHash !== null;
}

/** رسالة العميل لما المنفّذ المقفول يضيع — بتقول اللي حصل وبتقول الخطوة الجاية، بلا مصطلح تقني. */
export const LOCKED_PROVIDER_LOST_MESSAGE_AR =
  'الفني اللي اخترته بقى مش متاح للموعد ده. مفيش حد اتحجزلك بدالُه ومفيش أي تغيير في السعر — اختار فني تاني وأكّد من جديد.';

/** سبب انفكاك القفل — بيتسجّل في `order_status_history.change_reason` وفي الـaudit. */
export type LockedProviderLostReason = 'technician_unavailable' | 'technician_declined' | 'offer_expired';

export const LOCKED_PROVIDER_LOST_REASON_AR: Record<LockedProviderLostReason, string> = {
  technician_unavailable: 'الفني المقفول بقى غير مؤهّل/غير متاح وقت التوزيع',
  technician_declined: 'الفني المقفول رفض الطلب',
  offer_expired: 'الفني المقفول ما ردّش خلال المهلة',
};

/** رسالة رفض التأكيد لما الفني المقفول يبقى مش متاح لحظة التأكيد (ADR-0065 §5). */
export const LOCKED_PROVIDER_UNAVAILABLE_AT_CONFIRM_AR =
  'الفني اللي اخترته مابقاش متاح للموعد ده. ماحجزناش حد تاني بدالُه وماغيّرناش السعر — اعمل معاينة جديدة واختار من الفنيين المتاحين.';
