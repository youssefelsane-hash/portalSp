import { Order } from './entities/order.entity';

/**
 * **ADR-0068 — سلطة السعر مفصولة لتلات صلاحيات.**
 *
 * `orders.adjust_price` لوحدها كانت بتفتح سبع عمليات مختلفة تمامًا في الخطورة: من «خفّض سعر
 * لعميل زعلان» لحد «اعتمد سعر أعلى من السقف اللي العميل شافه». يعني موظف خدمة عملاء عايز يعمل
 * الأولى لازم تديله الصلاحية اللي بتعمل التانية كمان.
 *
 * الملف ده هو **المصدر الوحيد** لتعريف «إيه اللي يُعتبر زيادة» و«إيه اللي يُعتبر إعفاء من رسوم»
 * — لو التعريف اتكرر في الـcontroller وفي الخدمة كان هيفضل متطابق لحد أول تعديل في واحد بس.
 */
export const PERMISSION_APPROVE_PRICE_INCREASE = 'orders.approve_price_increase';
export const PERMISSION_WAIVE_FEES = 'orders.waive_fees';

export interface PriceChangeAuthority {
  canApprovePriceIncrease: boolean;
  canWaiveFees: boolean;
}

/**
 * الافتراضي للنداءات الداخلية اللي مالهاش فاعل بشري (مسارات النظام، والاختبارات اللي بتختبر
 * الحساب مش التصريح). أي مسار جايّ من طلب HTTP لازم يمرّر السلطة الحقيقية للأدمن.
 */
export const FULL_PRICE_AUTHORITY: PriceChangeAuthority = {
  canApprovePriceIncrease: true,
  canWaiveFees: true,
};

export interface PriceChangeKind {
  /** الإجمالي الجديد أكبر — العميل هيدفع زيادة ماشافهاش قبل كده. */
  isIncrease: boolean;
  /** الإجمالي الجديد بينزل تحت رسوم التقييم/المعاينة المسجّلة على الطلب — المنصة بتاكل الرسم. */
  waivesFees: boolean;
}

export function classifyPriceChange(
  order: Pick<Order, 'totalAmountCents' | 'inspectionFeeCents' | 'remoteAssessmentFeeCents'>,
  newTotalAmountCents: number,
): PriceChangeKind {
  const feeFloorCents = order.inspectionFeeCents + order.remoteAssessmentFeeCents;
  return {
    isIncrease: newTotalAmountCents > order.totalAmountCents,
    // شرط `>=` على الحالي مقصود: لو الطلب أصلاً تحت أرضية الرسوم (رسم اتعدّل قبل كده مثلاً)
    // فالخفض ده مش «إعفاء جديد» — الإعفاء اتعمل خلاص، ومحاسبة نفس القرار مرتين غلط.
    waivesFees:
      feeFloorCents > 0 &&
      order.totalAmountCents >= feeFloorCents &&
      newTotalAmountCents < feeFloorCents,
  };
}
