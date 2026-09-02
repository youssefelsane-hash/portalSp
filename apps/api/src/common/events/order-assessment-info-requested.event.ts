export const ORDER_ASSESSMENT_INFO_REQUESTED_EVENT = 'order.assessment.info_requested';

/**
 * الأدمن طلب من العميل معلومات/صور إضافية قبل ما يسعّر من الصور (بند 8).
 *
 * الطلب **مابيغيّرش حالته** — الحدث ده هو الوسيلة الوحيدة اللي العميل بيعرف بيها إن مطلوب منه
 * حاجة، فمن غير الـlistener بتاعه القرار ده بيبقى قرار صامت.
 */
export class OrderAssessmentInfoRequestedEvent {
  constructor(
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly customerId: string,
    public readonly message: string,
  ) {}
}
