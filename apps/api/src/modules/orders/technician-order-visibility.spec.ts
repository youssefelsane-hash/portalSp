import {
  ACTIVE_TECHNICIAN_ORDER_STATUSES,
  ENGAGED_TECHNICIAN_ORDER_STATUSES,
  TECHNICIAN_ATTENTION_ORDER_STATUSES,
  TECHNICIAN_POST_WORK_ORDER_STATUSES,
} from './order-state-machine';
import { OrderStatus } from './entities/order.entity';

/**
 * **«الطلب متعيّن لفني ومش ظاهر في تطبيقه»** (بلاغ المالك 2026-09-11).
 *
 * التدقيق الحي (`scripts/technician-order-visibility-audit.js`) لقى **٨ تركيبات** الطلب فيها
 * متعيّن لفني ومش راجع في ولا مسار من مسارات تطبيقه. الاختبار ده بيقفل القاعدة على مستوى
 * **تعريف المجموعات** نفسها، عشان أي حالة جديدة تتضاف لآلة الحالة تتحط في مكانها بوعي بدل ما
 * تقع في نفس الفجوة بصمت.
 */
describe('رؤية الفني للطلبات المتعيّنة له', () => {
  /** كل حالة الفني فيها متعيّن على الطلب ولسه له فيها دور — لازم تكون مغطّاة في مجموعة. */
  const MUST_BE_VISIBLE: OrderStatus[] = [
    OrderStatus.TECHNICIAN_ASSIGNED,
    OrderStatus.ACCEPTED,
    OrderStatus.TECHNICIAN_ON_WAY,
    OrderStatus.TECHNICIAN_ARRIVED,
    OrderStatus.IN_PROGRESS,
    OrderStatus.AWAITING_QUOTE_APPROVAL,
    OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL,
    OrderStatus.WORK_COMPLETED,
    OrderStatus.AWAITING_PAYMENT,
    OrderStatus.DISPUTED,
  ];

  const covered = new Set<string>([
    ...ACTIVE_TECHNICIAN_ORDER_STATUSES,
    ...TECHNICIAN_ATTENTION_ORDER_STATUSES,
    ...TECHNICIAN_POST_WORK_ORDER_STATUSES,
  ]);

  it.each(MUST_BE_VISIBLE)('حالة %s مغطّاة في مجموعة رؤية', (status) => {
    expect(covered.has(status)).toBe(true);
  });

  // ── الحاجز الأهم: الرؤية ماتتسربش لتعريف «الفني مشغول» ──────────────────
  //
  // `ACTIVE_TECHNICIAN_ORDER_STATUSES` مستخدمة في ١٥ موديول لتحديد أهلية المطابقة وسعة اليوم
  // والتتبّع وحذف الحساب. لو حد «صلّح» بَقّة الرؤية بإضافة `awaiting_payment` ليها، أي فني
  // خلّص شغله وبيستنى تحصيل يبقى **غير مؤهّل لأي شغل جديد** — عطل تشغيلي أسوأ من البَقّة
  // الأصلية بكتير. الاختبار ده بيمنع الخلط ده صراحةً.
  it('حالات ما بعد الشغل مش في تعريف «الفني مشغول»', () => {
    for (const status of TECHNICIAN_POST_WORK_ORDER_STATUSES) {
      expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).not.toContain(status);
      expect(ENGAGED_TECHNICIAN_ORDER_STATUSES).not.toContain(status);
    }
  });

  it('«متعيّن ولسه ما قبلش» مش في تعريف «الفني مشغول»', () => {
    // الفني ما قبلش الطلب لسه — حجزه كـ«مشغول» بيمنع عنه عروض تانية على أساس شغل مش مؤكّد.
    expect(ACTIVE_TECHNICIAN_ORDER_STATUSES).not.toContain(OrderStatus.TECHNICIAN_ASSIGNED);
    expect(ENGAGED_TECHNICIAN_ORDER_STATUSES).not.toContain(OrderStatus.TECHNICIAN_ASSIGNED);
  });

  it('مجموعات الرؤية مالهاش تقاطع — كل حالة ليها مكان واحد واضح', () => {
    const attention = new Set<string>(TECHNICIAN_ATTENTION_ORDER_STATUSES);
    for (const status of TECHNICIAN_POST_WORK_ORDER_STATUSES) {
      expect(attention.has(status)).toBe(false);
    }
    for (const status of ACTIVE_TECHNICIAN_ORDER_STATUSES) {
      expect(attention.has(status)).toBe(false);
      expect(TECHNICIAN_POST_WORK_ORDER_STATUSES).not.toContain(status);
    }
  });
});
