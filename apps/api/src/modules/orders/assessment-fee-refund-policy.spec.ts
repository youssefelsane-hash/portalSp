import { resolveCancellationRefund } from './assessment-fee-refund-policy';
import { Order } from './entities/order.entity';

type PolicyShape = Pick<
  Order,
  'inspectionFeeCents' | 'assessmentType' | 'assessmentFeeRefundableAfterVisitSnapshot'
>;

const order = (
  overrides: Partial<PolicyShape> = {},
): PolicyShape => ({
  inspectionFeeCents: 7_500,
  assessmentType: 'onsite',
  assessmentFeeRefundableAfterVisitSnapshot: false,
  ...overrides,
});

/**
 * **ADR-0069 — رسم المعاينة بعد زيارة حصلت فعلاً.**
 *
 * الفجوة اللي المراجعة كشفتها: طلب معاينة في الموقع مدفوع مقدمًا، الفني سافر وعاين وسعّر، العميل
 * لغى من `AWAITING_INITIAL_QUOTE_APPROVAL` — المبلغ **كله** كان بيترجع بما فيه رسم مقابل زيارة
 * اتعملت، والفني ماخدش ولا مليم.
 *
 * الاختبار بيقفل الشرط بحالاته الأربعة: السياسة، نوع التقييم، وجود الزيارة فعلاً، ووجود رسم أصلاً.
 */
describe('ADR-0069 — قرار استرداد رسم المعاينة عند الإلغاء', () => {
  it('الافتراضي (السياسة مفتوحة) بيرجّع الكل — صفر تغيير سلوك يوم النشر', () => {
    const decision = resolveCancellationRefund(
      order({ assessmentFeeRefundableAfterVisitSnapshot: true }),
      { onsiteQuoteExists: true, paidAmountCents: 30_000 },
    );
    expect(decision).toEqual({ refundableCents: 30_000, withheldCents: 0 });
  });

  it('السياسة مقفولة + زيارة حصلت: الرسم بيتحجز والباقي بيرجع', () => {
    const decision = resolveCancellationRefund(order(), { onsiteQuoteExists: true, paidAmountCents: 30_000 });
    expect(decision).toEqual({ refundableCents: 22_500, withheldCents: 7_500 });
  });

  it('السياسة مقفولة بس الزيارة ماحصلتش: بيرجع الكل — الحجز مقابل زيارة، مش مقابل نية', () => {
    const decision = resolveCancellationRefund(order(), { onsiteQuoteExists: false, paidAmountCents: 30_000 });
    expect(decision).toEqual({ refundableCents: 30_000, withheldCents: 0 });
  });

  it('التقييم بالصور بيرجع كامل مهما كانت السياسة — قرار المالك في §115 بند 9 محفوظ', () => {
    const decision = resolveCancellationRefund(order({ assessmentType: 'remote' }), {
      onsiteQuoteExists: true,
      paidAmountCents: 30_000,
    });
    expect(decision).toEqual({ refundableCents: 30_000, withheldCents: 0 });
  });

  it('خدمة معاينتها ببلاش: مفيش حاجة تتحجز', () => {
    const decision = resolveCancellationRefund(order({ inspectionFeeCents: 0 }), {
      onsiteQuoteExists: true,
      paidAmountCents: 30_000,
    });
    expect(decision).toEqual({ refundableCents: 30_000, withheldCents: 0 });
  });

  it('المدفوع = الرسم بالظبط: بيتحجز كله ومفيش استرداد — من غير مبلغ سالب', () => {
    const decision = resolveCancellationRefund(order(), { onsiteQuoteExists: true, paidAmountCents: 7_500 });
    expect(decision).toEqual({ refundableCents: 0, withheldCents: 7_500 });
  });

  it('المدفوع أقل من الرسم: الحجز بيتقصّ على المدفوع، مفيش دين على العميل', () => {
    const decision = resolveCancellationRefund(order(), { onsiteQuoteExists: true, paidAmountCents: 5_000 });
    expect(decision).toEqual({ refundableCents: 0, withheldCents: 5_000 });
  });
});
