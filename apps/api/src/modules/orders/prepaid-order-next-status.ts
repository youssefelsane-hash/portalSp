import { OrderPriceStatus, OrderStatus, OrderAssessmentType } from './entities/order.entity';

/**
 * الحالة اللي طلب `PENDING_PAYMENT` بيروحها بعد ما دفعه يتأكد (بند 9).
 *
 * دالة نقية عشان القرار ده يبقى قابل للاختبار لوحده: هو الفرق بين «ابعت فني دلوقتي» و«روح
 * لفرز الإدارة»، وغلطة فيه معناها إما فني بيتبعت لشغل مالوش سعر، أو طلب مدفوع بيقف مستني
 * توزيع مش المفروض يحصل.
 *
 * القاعدة: لو اللي اتدفع هو **رسم تقييم بالصور** (مش سعر شغل)، الطلب بيروح للإدارة تفرزه —
 * مفيش شغل متسعّر عشان يتوزّع على حد.
 */
export function prepaidOrderNextStatus(order: {
  assessmentType: OrderAssessmentType | null;
  priceStatus: OrderPriceStatus;
}): { nextStatus: OrderStatus; dispatchStarted: boolean } {
  const isRemoteAssessmentFee =
    order.assessmentType === 'remote' && order.priceStatus === OrderPriceStatus.WAITING_ASSESSMENT;
  return isRemoteAssessmentFee
    ? { nextStatus: OrderStatus.AWAITING_ADMIN_QUOTE, dispatchStarted: false }
    : { nextStatus: OrderStatus.SEARCHING_TECHNICIAN, dispatchStarted: true };
}
