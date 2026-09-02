import { PriceCertaintyMode } from '../catalog/entities/service.entity';
import { OrderPriceStatus } from './entities/order.entity';

/**
 * حالة سعر الطلب وقت الإنشاء (ADR-0063).
 *
 * دالة نقية لأن الإجابة دي بيعتمد عليها أكتر من مسار: زرار «إرسال سعر بعد المعاينة» في تطبيق
 * الفني، وطابور التقييم في الأدمن، وتوجيه الطلب المدفوع. غلطة فيها بتنتشر في كلهم.
 *
 * بَقّة اتصلحت هنا: خدمة «يحتاج تقييم» متحجوزة **بمعاينة في الموقع** (مش بالصور) كانت بتتسجّل
 * `CONFIRMED` رغم إنها مالهاش سعر أصلاً — الطلب بيقول «سعره مؤكد» وهو صفر.
 */
export function initialPriceStatus(input: {
  hasLockedMatchPreview: boolean;
  remoteQuoteRequested: boolean;
  priceCertaintyMode: PriceCertaintyMode;
}): OrderPriceStatus {
  if (input.hasLockedMatchPreview) return OrderPriceStatus.LOCKED;
  if (input.remoteQuoteRequested) return OrderPriceStatus.WAITING_ASSESSMENT;
  if (input.priceCertaintyMode === PriceCertaintyMode.ASSESSMENT_REQUIRED) {
    return OrderPriceStatus.WAITING_ASSESSMENT;
  }
  if (input.priceCertaintyMode === PriceCertaintyMode.ESTIMATED_RANGE) {
    return OrderPriceStatus.PROVISIONAL;
  }
  return OrderPriceStatus.CONFIRMED;
}
