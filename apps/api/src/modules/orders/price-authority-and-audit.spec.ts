import { classifyPriceChange, FULL_PRICE_AUTHORITY } from './price-change-authority';
import { Order } from './entities/order.entity';

type FeeShape = Pick<Order, 'totalAmountCents' | 'inspectionFeeCents' | 'remoteAssessmentFeeCents'>;

const order = (total: number, inspection = 0, remote = 0): FeeShape => ({
  totalAmountCents: total,
  inspectionFeeCents: inspection,
  remoteAssessmentFeeCents: remote,
});

/**
 * **ADR-0068 §1 — تصنيف تغيير السعر هو اللي بيختار الصلاحية المطلوبة.**
 *
 * قبل كده `orders.adjust_price` كانت بتفتح سبع عمليات مختلفة الخطورة بصلاحية واحدة: موظف خدمة
 * عملاء عايز يخفّض لعميل زعلان لازم تديله نفس الصلاحية اللي بتخلّيه يعتمد زيادة فوق النطاق.
 *
 * التصنيف ده هو **المصدر الوحيد** للتعريفين، والاختبار بيقفل الحالات الحدّية اللي بتفرق فعلاً في
 * الفلوس — مش بس الحالة السهلة.
 */
describe('ADR-0068 — تصنيف تغيير السعر (زيادة / إعفاء رسوم / خفض عادي)', () => {
  it('الزيادة اتحددت بالإجمالي مش بالرسوم', () => {
    expect(classifyPriceChange(order(30_000), 35_000).isIncrease).toBe(true);
    expect(classifyPriceChange(order(30_000), 25_000).isIncrease).toBe(false);
  });

  it('النزول تحت أرضية الرسوم = إعفاء، والنزول اللي لسه فوقها = خفض عادي', () => {
    const withFees = order(30_000, 7_500, 0);
    expect(classifyPriceChange(withFees, 5_000).waivesFees).toBe(true);
    // 10,000 لسه فوق 7,500 — الرسم اتحصّل كامل، فده خفض في قيمة الشغل مش إعفاء.
    expect(classifyPriceChange(withFees, 10_000).waivesFees).toBe(false);
  });

  it('رسم المعاينة والتقييم عن بُعد بيتجمعوا في أرضية واحدة', () => {
    const both = order(30_000, 5_000, 4_000);
    expect(classifyPriceChange(both, 8_000).waivesFees).toBe(true);
    expect(classifyPriceChange(both, 9_500).waivesFees).toBe(false);
  });

  it('طلب بلا رسوم خالص عمره ما يتحسب إعفاء — حتى لو نزل لصفر', () => {
    expect(classifyPriceChange(order(30_000), 0).waivesFees).toBe(false);
  });

  it('طلب أصلاً تحت أرضية الرسوم: الخفض التاني مش إعفاء جديد — مفيش محاسبة لنفس القرار مرتين', () => {
    // إجمالي 5,000 وأرضية 7,500 يعني الإعفاء اتعمل قبل كده؛ النزول لـ3,000 قرار تاني مختلف.
    expect(classifyPriceChange(order(5_000, 7_500, 0), 3_000).waivesFees).toBe(false);
  });

  it('الزيادة والإعفاء مش متنافيين منطقيًا — التصنيف بيرجّع الاتنين مستقلين', () => {
    // زيادة من 3,000 لـ6,000 على طلب أرضيته 7,500: زيادة أيوة، إعفاء لأ (كان تحتها أصلاً).
    const change = classifyPriceChange(order(3_000, 7_500, 0), 6_000);
    expect(change.isIncrease).toBe(true);
    expect(change.waivesFees).toBe(false);
  });

  it('السلطة الكاملة هي الافتراضي للنداءات الداخلية بس — الحقلين الاتنين true', () => {
    expect(FULL_PRICE_AUTHORITY).toEqual({ canApprovePriceIncrease: true, canWaiveFees: true });
  });
});
