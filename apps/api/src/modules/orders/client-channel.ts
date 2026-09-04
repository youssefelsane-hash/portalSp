import { OrderSourceChannel } from './entities/order.entity';

/**
 * القناة اللي الطلب جه منها، من هيدر `X-Client-Channel` (docs/08 §133).
 *
 * **بَقّة بيانات حقيقية بتقفلها**: `sourceChannel` كان مثبّت على `customer_app` لأي طلب مش
 * مركز اتصال، يعني كل طلب من `customer-web` كان بيتسجّل إنه من تطبيق الموبايل — والـenum
 * فيه `web` ومحدش بيستخدمه. أي تقرير «الطلبات جاية منين» كان بيدّي رقم غلط.
 *
 * الدالة نقية عشان تتاخد باختبار لوحدها: هيدر مش معروف أو ناقص بيرجّع الافتراضي الآمن بدل
 * ما يرمي — قيمة غلط في هيدر تحليلي **مايصحّش** تمنع عميل من إنشاء طلب.
 */
export function resolveClientChannel(header: string | undefined): OrderSourceChannel {
  const value = header?.trim().toLowerCase();
  const allowed = Object.values(OrderSourceChannel) as string[];
  // `call_center` مستثنى عمدًا: بيتحدد من صلاحية الأدمن في الباك-إند، مش من هيدر عميل —
  // وإلا أي عميل يقدر يزوّر مصدر الطلب.
  if (value && value !== OrderSourceChannel.CALL_CENTER && allowed.includes(value)) {
    return value as OrderSourceChannel;
  }
  return OrderSourceChannel.CUSTOMER_APP;
}
