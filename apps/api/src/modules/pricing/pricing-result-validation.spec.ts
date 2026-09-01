import { ApiException } from '../../common/exceptions/api.exception';
import { FormulaEvaluationContext } from './formula-evaluator';
import { PricingEngineService } from './pricing-engine.service';
import { FinalPriceFormulaPayload } from './pricing-formula.types';

const evaluationContext: FormulaEvaluationContext = {
  fieldValues: {},
  constants: new Map(),
  lookupTables: new Map(),
};

describe('PricingEngine semantic result validation', () => {
  const engine = new PricingEngineService({} as never, {} as never, {} as never);
  const compute = (payload: FinalPriceFormulaPayload) =>
    (engine as unknown as {
      computeResult: (formula: FinalPriceFormulaPayload, context: FormulaEvaluationContext) => unknown;
    }).computeResult(payload, evaluationContext);

  it('يرفض min أكبر من max والقيم المالية السالبة', () => {
    expect(() =>
      compute({
        price_cents: { type: 'literal', value: 100 },
        min_price_cents: { type: 'literal', value: 200 },
        max_price_cents: { type: 'literal', value: 150 },
      }),
    ).toThrow(ApiException);
    expect(() =>
      compute({
        price_cents: { type: 'literal', value: 100 },
        min_price_cents: { type: 'literal', value: -1 },
      }),
    ).toThrow(ApiException);
  });

  it('يرفض طاقم كسري أو أقل من الحد المنطقي', () => {
    expect(() =>
      compute({
        price_cents: { type: 'literal', value: 100 },
        required_technicians: { type: 'literal', value: 1.5 },
      }),
    ).toThrow(ApiException);
    expect(() =>
      compute({
        price_cents: { type: 'literal', value: 100 },
        required_technicians: { type: 'literal', value: 0 },
      }),
    ).toThrow(ApiException);
    expect(() =>
      compute({
        price_cents: { type: 'literal', value: 100 },
        required_assistants: { type: 'literal', value: -1 },
      }),
    ).toThrow(ApiException);
  });

  it('يرفض overflow قبل وصول القيمة لعمود integer في قاعدة البيانات', () => {
    expect(() => compute({ price_cents: { type: 'literal', value: 2_147_483_648 } })).toThrow(ApiException);
  });
});
