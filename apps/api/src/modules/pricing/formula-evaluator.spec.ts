import { ApiException } from '../../common/exceptions/api.exception';
import { evaluateFormulaNode, FormulaEvaluationContext, validateFormulaNode } from './formula-evaluator';
import { FormulaNode } from './pricing-formula.types';

function context(overrides: Partial<FormulaEvaluationContext> = {}): FormulaEvaluationContext {
  return {
    fieldValues: {},
    constants: new Map(),
    lookupTables: new Map(),
    ...overrides,
  };
}

describe('formula-evaluator', () => {
  describe('validateFormulaNode — القايمة المسموحة بس', () => {
    it('يقبل شجرة عمليات مسموحة صحيحة', () => {
      const node: FormulaNode = {
        type: 'if',
        condition: { field_key: 'floor', op: 'gt', value: 5 },
        then: { type: 'add', operands: [{ type: 'literal', value: 100 }, { type: 'field_ref', field_key: 'area' }] },
        else: { type: 'literal', value: 0 },
      };
      expect(() => validateFormulaNode(node)).not.toThrow();
    });

    it('يرفض نوع عقدة مش في القايمة المسموحة (زي محاولة حقن كود)', () => {
      const malicious = { type: 'eval', code: 'process.exit(1)' };
      expect(() => validateFormulaNode(malicious)).toThrow(ApiException);
    });

    it('يرفض عقدة مش object خالص', () => {
      expect(() => validateFormulaNode('require("child_process")')).toThrow(ApiException);
      expect(() => validateFormulaNode(42)).toThrow(ApiException);
      expect(() => validateFormulaNode(null)).toThrow(ApiException);
    });

    it('يرفض شجرة أعمق من الحد المسموح (دفاع ضد DoS)', () => {
      let node: FormulaNode = { type: 'literal', value: 1 };
      for (let i = 0; i < 20; i++) {
        node = { type: 'add', operands: [node] };
      }
      expect(() => validateFormulaNode(node)).toThrow(ApiException);
    });

    it('يرفض condition.op غير مسموح', () => {
      const node = { type: 'if', condition: { field_key: 'x', op: 'DROP TABLE', value: 1 }, then: { type: 'literal', value: 1 }, else: { type: 'literal', value: 0 } };
      expect(() => validateFormulaNode(node)).toThrow(ApiException);
    });

    it('يرفض add.operands فاضية', () => {
      expect(() => validateFormulaNode({ type: 'add', operands: [] })).toThrow(ApiException);
    });
  });

  describe('evaluateFormulaNode — عمليات حسابية', () => {
    it('add بيجمع كل الـ operands', () => {
      const node: FormulaNode = { type: 'add', operands: [{ type: 'literal', value: 10 }, { type: 'literal', value: 5 }, { type: 'literal', value: 2 }] };
      expect(evaluateFormulaNode(node, context())).toBe(17);
    });

    it('subtract بيطرح من اليسار لليمين', () => {
      const node: FormulaNode = { type: 'subtract', operands: [{ type: 'literal', value: 100 }, { type: 'literal', value: 30 }] };
      expect(evaluateFormulaNode(node, context())).toBe(70);
    });

    it('multiply بيضرب كل الـ operands', () => {
      const node: FormulaNode = { type: 'multiply', operands: [{ type: 'literal', value: 6 }, { type: 'literal', value: 7 }] };
      expect(evaluateFormulaNode(node, context())).toBe(42);
    });

    it('divide بيرفض القسمة على صفر بوضوح', () => {
      const node: FormulaNode = { type: 'divide', operands: [{ type: 'literal', value: 10 }, { type: 'literal', value: 0 }] };
      expect(() => evaluateFormulaNode(node, context())).toThrow(ApiException);
    });

    it('percentage بيزود بالنسبة المئوية الصح', () => {
      // مطابق لمثال المحارة في docs/08 §1.8: IF سمك=3 THEN +15%
      const node: FormulaNode = { type: 'percentage', base: { type: 'literal', value: 200 }, percent: { type: 'literal', value: 15 } };
      // toBeCloseTo عمدًا مش toBe — عشان الفاصلة العائمة (200 × 1.15 = 229.99999999999997 في IEEE
      // 754)، مش بَقّة. price_cents النهائي دايمًا بيتقرّب بـ Math.round() في PricingEngineService
      // فمفيش أثر عملي، بس نفس المشكلة ممكن تظهر في نتائج intermediate تانية فعشان كده الاختبار
      // نفسه لازم يعبّر عنها صح بدل ما يخفيها.
      expect(evaluateFormulaNode(node, context())).toBeCloseTo(230, 5);
    });

    it('min/max/round', () => {
      expect(evaluateFormulaNode({ type: 'min', operands: [{ type: 'literal', value: 5 }, { type: 'literal', value: 2 }] }, context())).toBe(2);
      expect(evaluateFormulaNode({ type: 'max', operands: [{ type: 'literal', value: 5 }, { type: 'literal', value: 2 }] }, context())).toBe(5);
      expect(evaluateFormulaNode({ type: 'round', value: { type: 'literal', value: 12.678 }, decimals: 1 }, context())).toBe(12.7);
    });

    // Script 2 Part H (finding #43) — ceil()/floor() جداد جنب round()، لسياسة "أي جزء من الوحدة
    // يُحسب وحدة كاملة" اللي round() العادية معندهاش طريقة تعبّر عنها.
    it('ceil بيقرّب لأعلى دايمًا حتى لو الكسر صغير (سياسة "أي جزء = وحدة كاملة")', () => {
      expect(evaluateFormulaNode({ type: 'ceil', value: { type: 'literal', value: 5.01 } }, context())).toBe(6);
      expect(evaluateFormulaNode({ type: 'ceil', value: { type: 'literal', value: 5 } }, context())).toBe(5);
      expect(evaluateFormulaNode({ type: 'ceil', value: { type: 'literal', value: 12.34 }, decimals: 1 }, context())).toBe(12.4);
    });

    it('floor بيقرّب لأسفل دايمًا', () => {
      expect(evaluateFormulaNode({ type: 'floor', value: { type: 'literal', value: 5.99 } }, context())).toBe(5);
      expect(evaluateFormulaNode({ type: 'floor', value: { type: 'literal', value: 12.34 }, decimals: 1 }, context())).toBe(12.3);
    });

    it('ceil/floor مسموحين في validateFormulaNode زي round بالظبط', () => {
      expect(() => validateFormulaNode({ type: 'ceil', value: { type: 'literal', value: 1 } })).not.toThrow();
      expect(() => validateFormulaNode({ type: 'floor', value: { type: 'literal', value: 1 } })).not.toThrow();
      expect(() => validateFormulaNode({ type: 'ceil', value: { type: 'literal', value: 1 }, decimals: 'x' })).toThrow();
    });
  });

  describe('evaluateFormulaNode — مراجع (field_ref/constant_ref/lookup_ref)', () => {
    it('field_ref بيرجع قيمة الحقل من fieldValues', () => {
      const node: FormulaNode = { type: 'field_ref', field_key: 'area' };
      expect(evaluateFormulaNode(node, context({ fieldValues: { area: 150 } }))).toBe(150);
    });

    it('field_ref بيرفض بوضوح لو الحقل مش موجود في السياق', () => {
      const node: FormulaNode = { type: 'field_ref', field_key: 'missing' };
      expect(() => evaluateFormulaNode(node, context())).toThrow(ApiException);
    });

    // Script 2 Part H (finding #42) — كانت بَقّة حقيقية: قيمة نصية مش رقمية كانت بتتحول لـNaN
    // بصمت وتتسرّب عبر باقي المعادلة (add/multiply/...) لحد السعر النهائي، عكس تعليق الدالة
    // اللي بيدّعي "بيرفض بوضوح... بدل NaN بصمت".
    it('field_ref بيرفض بوضوح لو قيمة الحقل نص مش رقمي خالص ("hello" مش "3")', () => {
      const node: FormulaNode = { type: 'field_ref', field_key: 'area' };
      expect(() => evaluateFormulaNode(node, context({ fieldValues: { area: 'hello' } }))).toThrow(ApiException);
    });

    it('add/multiply يرفضوا بوضوح لو أحد الـoperands field_ref بقيمة غير رقمية — NaN ماتوصلش للسعر النهائي', () => {
      const addNode: FormulaNode = {
        type: 'add',
        operands: [{ type: 'literal', value: 100 }, { type: 'field_ref', field_key: 'area' }],
      };
      expect(() => evaluateFormulaNode(addNode, context({ fieldValues: { area: 'garbage' } }))).toThrow(ApiException);

      const multiplyNode: FormulaNode = {
        type: 'multiply',
        operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 165 }],
      };
      expect(() => evaluateFormulaNode(multiplyNode, context({ fieldValues: { area: 'garbage' } }))).toThrow(ApiException);
    });

    it('constant_ref بيرجع قيمة الثابت', () => {
      const node: FormulaNode = { type: 'constant_ref', rule_key: 'price_per_meter' };
      const constants = new Map([['price_per_meter', { value: 140 }]]);
      expect(evaluateFormulaNode(node, context({ constants }))).toBe(140);
    });

    it('lookup_ref بيرجع القيمة الصح حسب اختيار العميل', () => {
      // مطابق لمثال المحارة: lookup لسعر المتر حسب نوع المحارة
      const node: FormulaNode = { type: 'lookup_ref', rule_key: 'price_per_meter_by_type', field_key: 'wall_type' };
      const lookupTables = new Map([['price_per_meter_by_type', { field_key: 'wall_type', values: { internal: 140, external: 165, ceiling: 180 } }]]);
      expect(evaluateFormulaNode(node, context({ fieldValues: { wall_type: 'external' }, lookupTables }))).toBe(165);
    });

    it('lookup_ref بيرفض بوضوح لو الاختيار مش موجود في الجدول', () => {
      const node: FormulaNode = { type: 'lookup_ref', rule_key: 'price_per_meter_by_type', field_key: 'wall_type' };
      const lookupTables = new Map([['price_per_meter_by_type', { field_key: 'wall_type', values: { internal: 140 } }]]);
      expect(() => evaluateFormulaNode(node, context({ fieldValues: { wall_type: 'unknown_type' }, lookupTables }))).toThrow(ApiException);
    });
  });

  describe('evaluateFormulaNode — if/else بكل عمليات المقارنة', () => {
    it.each([
      ['equals', 5, 5, true],
      ['equals', 5, 6, false],
      ['not_equals', 5, 6, true],
      ['gt', 6, 5, true],
      ['gt', 5, 5, false],
      ['gte', 5, 5, true],
      ['lt', 4, 5, true],
      ['lte', 5, 5, true],
    ] as const)('%s: %d مقابل %d => %s', (op, fieldValue, compareTo, expected) => {
      const node: FormulaNode = {
        type: 'if',
        condition: { field_key: 'floor', op, value: compareTo },
        then: { type: 'literal', value: 1 },
        else: { type: 'literal', value: 0 },
      };
      expect(evaluateFormulaNode(node, context({ fieldValues: { floor: fieldValue } }))).toBe(expected ? 1 : 0);
    });

    it('equals بيقارن رقميًا لو حقل dropdown رجع نص رقمي ("3") مقابل شرط رقم (3)', () => {
      // حقول dropdown (زي "السمك") قيمتها دايمًا نص حتى لو شكلها رقمي — راجع docs/08 §1.8.
      const node: FormulaNode = {
        type: 'if',
        condition: { field_key: 'thickness_cm', op: 'equals', value: 3 },
        then: { type: 'literal', value: 1 },
        else: { type: 'literal', value: 0 },
      };
      expect(evaluateFormulaNode(node, context({ fieldValues: { thickness_cm: '3' } }))).toBe(1);
      expect(evaluateFormulaNode(node, context({ fieldValues: { thickness_cm: '2.5' } }))).toBe(0);
    });

    it('equals بيقارن نصيًا لو القيم مش رقمية (اختيارات dropdown نصية)', () => {
      const node: FormulaNode = {
        type: 'if',
        condition: { field_key: 'wall_type', op: 'equals', value: 'external' },
        then: { type: 'literal', value: 1 },
        else: { type: 'literal', value: 0 },
      };
      expect(evaluateFormulaNode(node, context({ fieldValues: { wall_type: 'external' } }))).toBe(1);
      expect(evaluateFormulaNode(node, context({ fieldValues: { wall_type: 'internal' } }))).toBe(0);
    });
  });

  it('مثال متكامل مطابق لمثال المحارة الخارجية في docs/08 §1.8', () => {
    // مساحة 120م² × سعر متر خارجي 165 + IF سمك=3 THEN +15% + IF دور>5 THEN +ثابت 500
    const node: FormulaNode = {
      type: 'add',
      operands: [
        {
          type: 'if',
          condition: { field_key: 'thickness_cm', op: 'equals', value: 3 },
          then: { type: 'percentage', base: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'lookup_ref', rule_key: 'price_per_meter', field_key: 'wall_type' }] }, percent: { type: 'literal', value: 15 } },
          else: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'lookup_ref', rule_key: 'price_per_meter', field_key: 'wall_type' }] },
        },
        {
          type: 'if',
          condition: { field_key: 'floor', op: 'gt', value: 5 },
          then: { type: 'constant_ref', rule_key: 'floor_surcharge' },
          else: { type: 'literal', value: 0 },
        },
      ],
    };
    const ctx = context({
      fieldValues: { area: 120, thickness_cm: 3, floor: 7, wall_type: 'external' },
      lookupTables: new Map([['price_per_meter', { field_key: 'wall_type', values: { internal: 140, external: 165, ceiling: 180 } }]]),
      constants: new Map([['floor_surcharge', { value: 500 }]]),
    });
    // (120 × 165 × 1.15) + 500 = 22770 + 500 = 23270
    expect(evaluateFormulaNode(node, ctx)).toBeCloseTo(23270, 5);
  });
});
