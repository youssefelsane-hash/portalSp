import { evaluateFormulaNode, FormulaEvaluationContext, validateFinalPriceFormulaPayload } from './formula-evaluator';
import { FormulaNode } from './pricing-formula.types';

/**
 * ADR-0050 §2/§3 — العقدتين الجداد جوّه المحرك نفسه (تحقق + تنفيذ + رسايل الرفض).
 *
 * `pricing-temporal.spec.ts` بيغطّي الحسبة نفسها؛ الملف ده بيغطّي **التكامل**: هل الشجرة
 * بتعدّي التحقق، وبتقرا المصادر الصح، وبترفض بوضوح لما المصدر ناقص.
 */
describe('date_diff / distance جوّه محرك المعادلات (ADR-0050)', () => {
  const contextWith = (
    dates: Record<string, string> = {},
    geo: Record<string, { lat: number; lng: number }> = {},
  ): FormulaEvaluationContext => ({
    fieldValues: {},
    constants: new Map(),
    lookupTables: new Map(),
    dateValues: new Map(Object.entries(dates).map(([key, value]) => [key, new Date(value)])),
    geoPoints: new Map(Object.entries(geo)),
  });

  describe('date_diff', () => {
    const node: FormulaNode = {
      type: 'date_diff',
      from: { kind: 'period_start' },
      to: { kind: 'period_end' },
      unit: 'months',
      rounding: 'ceil',
    };

    it('بيقرا مصادر النظام (بداية/نهاية الفترة)', () => {
      const context = contextWith({
        period_start: '2026-01-01T09:00:00Z',
        period_end: '2026-03-15T09:00:00Z',
      });
      expect(evaluateFormulaNode(node, context)).toBe(3);
    });

    it('بيقرا حقول الفورم', () => {
      const context = contextWith({
        'field:check_in': '2026-06-01T09:00:00Z',
        'field:check_out': '2026-06-08T09:00:00Z',
      });
      expect(
        evaluateFormulaNode(
          { type: 'date_diff', from: { kind: 'field', field_key: 'check_in' }, to: { kind: 'field', field_key: 'check_out' }, unit: 'days' },
          context,
        ),
      ).toBe(7);
    });

    // **أهم رسالة في الملف**: المالك بلّغ عن حقل تاريخ في الفورم مالوش أي استهلاك. لو المصدر
    // ناقص لازم يبان بالاسم، مش يرجّع صفر ولا NaN بصمت.
    it('مصدر ناقص بيترفض برسالة بتسمّي المصدر — مش صفر بصمت', () => {
      expect(() => evaluateFormulaNode(node, contextWith({ period_start: '2026-01-01T09:00:00Z' }))).toThrow(
        /نهاية الفترة/,
      );
    });

    it('حقل ناقص بيترفض باسم الحقل', () => {
      expect(() =>
        evaluateFormulaNode(
          { type: 'date_diff', from: { kind: 'field', field_key: 'check_in' }, to: { kind: 'now' }, unit: 'days' },
          contextWith(),
        ),
      ).toThrow(/check_in/);
    });

    it('`now` بيتحسب لحظة التنفيذ — سياق فاضي بيكفيه', () => {
      const context = contextWith({ 'field:start': new Date(Date.now() - 3 * 3_600_000).toISOString() });
      const hours = evaluateFormulaNode(
        { type: 'date_diff', from: { kind: 'field', field_key: 'start' }, to: { kind: 'now' }, unit: 'hours', rounding: 'round' },
        context,
      );
      expect(hours).toBe(3);
    });
  });

  describe('distance', () => {
    it('بيحسب المسافة بين حقل موقع ونقطة ثابتة', () => {
      const context = contextWith({}, { 'field:site': { lat: 30.0287, lng: 31.2599 } });
      const km = evaluateFormulaNode(
        {
          type: 'distance',
          from: { kind: 'field', field_key: 'site' },
          to: { kind: 'point', lat: 30.0444, lng: 31.2357 },
          unit: 'km',
        },
        context,
      );
      expect(km).toBeGreaterThan(2.5);
      expect(km).toBeLessThan(3.5);
    });

    it('وحدة المتر = ×1000', () => {
      const context = contextWith({}, { order_location: { lat: 30.0287, lng: 31.2599 } });
      const base: Omit<Extract<FormulaNode, { type: 'distance' }>, 'unit'> = {
        type: 'distance',
        from: { kind: 'order_location' },
        to: { kind: 'point', lat: 30.0444, lng: 31.2357 },
      };
      const km = evaluateFormulaNode({ ...base, unit: 'km' }, context);
      const m = evaluateFormulaNode({ ...base, unit: 'm' }, context);
      expect(m).toBeCloseTo(km * 1000, 6);
    });

    it('موقع الطلب الناقص بيترفض بوضوح', () => {
      expect(() =>
        evaluateFormulaNode(
          { type: 'distance', from: { kind: 'order_location' }, to: { kind: 'point', lat: 30, lng: 31 }, unit: 'km' },
          contextWith(),
        ),
      ).toThrow(/موقع الطلب/);
    });
  });

  describe('التحقق وقت الحفظ', () => {
    it('بيقبل شجرة فيها العقدتين', () => {
      expect(() =>
        validateFinalPriceFormulaPayload({
          price_cents: {
            type: 'multiply',
            operands: [
              { type: 'date_diff', from: { kind: 'period_start' }, to: { kind: 'period_end' }, unit: 'months', rounding: 'ceil' },
              { type: 'literal', value: 50000 },
            ],
          },
        }),
      ).not.toThrow();
    });

    it('بيرفض وحدة مش من القايمة', () => {
      expect(() =>
        validateFinalPriceFormulaPayload({
          price_cents: { type: 'date_diff', from: { kind: 'now' }, to: { kind: 'now' }, unit: 'fortnights' },
        }),
      ).toThrow(/date_diff.unit/);
    });

    it('بيرفض مصدر تاريخ مش معروف', () => {
      expect(() =>
        validateFinalPriceFormulaPayload({
          price_cents: { type: 'date_diff', from: { kind: 'whenever' }, to: { kind: 'now' }, unit: 'days' },
        }),
      ).toThrow(/مصدر تاريخ غير مسموح/);
    });

    it('بيرفض نقطة ثابتة بإحداثيات مستحيلة', () => {
      expect(() =>
        validateFinalPriceFormulaPayload({
          price_cents: {
            type: 'distance',
            from: { kind: 'order_location' },
            to: { kind: 'point', lat: 300, lng: 31 },
            unit: 'km',
          },
        }),
      ).toThrow(/lat\/lng/);
    });
  });

  // ADR-0050 §5 — الرسالة بتسمّي البديل بدل «مش رقم» وخلاص.
  it('field_ref على حقل تاريخ بيرفض ويقترح date_diff', () => {
    const context: FormulaEvaluationContext = {
      fieldValues: { move_date: '2026-06-01' },
      constants: new Map(),
      lookupTables: new Map(),
      dateValues: new Map([['field:move_date', new Date('2026-06-01T00:00:00Z')]]),
      geoPoints: new Map(),
    };
    expect(() => evaluateFormulaNode({ type: 'field_ref', field_key: 'move_date' }, context)).toThrow(
      /فرق بين تاريخين/,
    );
  });
});
