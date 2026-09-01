import { PricingModel } from '../catalog/entities/service.entity';
import { buildPricingContext } from './pricing-context';
import { allPricingMethods, billedMonths, missingPricingInput, pricingMethod } from './pricing-methods';
import { evaluateFormulaNode } from './formula-evaluator';
import { pricingContextDateValues, pricingContextGeoPoints, pricingContextFormulaValues } from './pricing-context';

/**
 * ADR-0050 §1/§4 — سجل طرق الحساب.
 *
 * **الاختبار ده بينفّذ شجرة كل طريقة فعليًا** في نفس `evaluateFormulaNode()` اللي المعادلة
 * الديناميكية بتتنفّذ فيه — مش بيقرا الكود. لو حد رجّع منطق حساب لملف تاني، هيفترق عن الأرقام
 * دي فورًا.
 */
describe('سجل طرق حساب السعر (ADR-0050)', () => {
  const RATE = 50_000; // 500 جنيه بالقرش

  const priceOf = (model: PricingModel, context: ReturnType<typeof buildPricingContext>): number => {
    const node = pricingMethod(model).buildPrice({ type: 'literal', value: RATE });
    return evaluateFormulaNode(node, {
      fieldValues: pricingContextFormulaValues(context),
      constants: new Map(),
      lookupTables: new Map(),
      dateValues: pricingContextDateValues(context, context.serviceFieldValues),
      geoPoints: pricingContextGeoPoints(context, context.serviceFieldValues),
    });
  };

  it('السجل شامل لكل قيم PricingModel — قيمة جديدة بلا صف مستحيلة', () => {
    const covered = allPricingMethods().map((method) => method.key).sort();
    expect(covered).toEqual(Object.values(PricingModel).sort());
  });

  it('ثابت: السعر هو التعريفة مهما كان المدخل', () => {
    expect(priceOf(PricingModel.FIXED, buildPricingContext({ quantity: 7, durationHours: 3 }))).toBe(RATE);
  });

  it('بالساعة: التعريفة × الساعات', () => {
    expect(priceOf(PricingModel.HOURLY, buildPricingContext({ durationHours: 3 }))).toBe(RATE * 3);
  });

  it('بالوحدة: التعريفة × الكمية', () => {
    expect(priceOf(PricingModel.PER_UNIT, buildPricingContext({ quantity: 4 }))).toBe(RATE * 4);
  });

  it('كشف ثم عرض سعر: صفر وقت الحجز', () => {
    expect(priceOf(PricingModel.INSPECTION_THEN_QUOTE, buildPricingContext({}))).toBe(0);
  });

  // ===================== البَقّة المبلّغة =====================
  describe('شهري — «لما الشخص بيختار تاريخ بداية ونهاية، السيستم مش بيجيب الـdifference بينهم»', () => {
    const monthlyContext = (periodStart: string, periodEnd: string) =>
      buildPricingContext({ periodStart, periodEnd });

    it('3 شهور كاملة = التعريفة × 3', () => {
      expect(priceOf(PricingModel.MONTHLY, monthlyContext('2026-01-01', '2026-04-01'))).toBe(RATE * 3);
    });

    // الحالة اللي بتفضح أي حسبة بقسمة على 30: فبراير 28 يوم، ولسه شهر كامل واحد.
    it('فبراير القصير برضه شهر واحد', () => {
      expect(priceOf(PricingModel.MONTHLY, monthlyContext('2026-02-01', '2026-03-01'))).toBe(RATE);
    });

    it('شهرين ونص = 3 شهور فوترة (أي جزء من شهر = شهر كامل)', () => {
      expect(priceOf(PricingModel.MONTHLY, monthlyContext('2026-01-01', '2026-03-15'))).toBe(RATE * 3);
    });

    it('فترة أقصر من شهر لسه شهر واحد، مش كسر', () => {
      expect(priceOf(PricingModel.MONTHLY, monthlyContext('2026-01-01', '2026-01-10'))).toBe(RATE);
    });

    it('سنة كاملة = 12 شهر', () => {
      expect(priceOf(PricingModel.MONTHLY, monthlyContext('2026-01-01', '2027-01-01'))).toBe(RATE * 12);
    });

    it('billedMonths بتطابق الشجرة بالظبط (سعر المنطقة المطلق بيستخدمها)', () => {
      const context = monthlyContext('2026-01-01', '2026-03-15');
      expect(billedMonths(context)).toBe(3);
      expect(priceOf(PricingModel.MONTHLY, context)).toBe(RATE * billedMonths(context));
    });
  });

  describe('missingPricingInput — نفس السجل اللي بيبني الشجرة', () => {
    it('شهري بلا فترة بيترفض برسالة بتطلب التاريخين', () => {
      expect(missingPricingInput(PricingModel.MONTHLY, buildPricingContext({ quantity: 3 }))).toMatch(
        /تاريخ بداية وتاريخ نهاية/,
      );
    });

    it('شهري بفترة كاملة بيعدّي', () => {
      expect(
        missingPricingInput(PricingModel.MONTHLY, buildPricingContext({ periodStart: '2026-01-01', periodEnd: '2026-03-01' })),
      ).toBeNull();
    });

    it('بالساعة بلا مدة بيترفض، وبالوحدة بلا كمية بيترفض', () => {
      expect(missingPricingInput(PricingModel.HOURLY, buildPricingContext({}))).toMatch(/بالساعة/);
      expect(missingPricingInput(PricingModel.PER_UNIT, buildPricingContext({}))).toMatch(/بالوحدة/);
    });

    it('ثابت وكشف ومعادلة مالهمش أي مدخل إجباري', () => {
      for (const model of [PricingModel.FIXED, PricingModel.INSPECTION_THEN_QUOTE, PricingModel.FORMULA]) {
        expect(missingPricingInput(model, buildPricingContext({}))).toBeNull();
      }
    });
  });

  it('فترة معكوسة بترفض من بناء السياق نفسه — مش بتوصل للتسعير أصلاً', () => {
    expect(() => buildPricingContext({ periodStart: '2026-03-01', periodEnd: '2026-01-01' })).toThrow(
      /نهاية الفترة لازم تكون بعد بدايتها/,
    );
  });
});
