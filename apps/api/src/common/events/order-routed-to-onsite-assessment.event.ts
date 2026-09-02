export const ORDER_ROUTED_TO_ONSITE_ASSESSMENT_EVENT = 'order.routed_to_onsite_assessment';

/**
 * ADR-0067 §1 — الأدمن حوّل طلب «تقييم بالصور» لمعاينة في الموقع.
 *
 * الحالة الجديدة `SEARCHING_TECHNICIAN` بيوصلها الطلب العادي كمان، واللي مالوش إشعار عمدًا، فمش
 * ممكن نعلّق الرسالة على الحالة. والأهم إن التحويل بيضيف **رسم معاينة** على الطلب — مبلغ جديد
 * لازم العميل يعرفه.
 */
export class OrderRoutedToOnsiteAssessmentEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly inspectionFeeCents: number,
    public readonly reason: string,
  ) {}
}
