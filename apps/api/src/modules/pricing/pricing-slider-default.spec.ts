import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogService } from '../audit/audit-log.service';
import { CreatePricingFieldDto } from './dto/create-pricing-field.dto';
import { UpdatePricingFieldDto } from './dto/update-pricing-field.dto';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { PricingRuleType, ServicePricingRule } from './entities/service-pricing-rule.entity';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingEngineService } from './pricing-engine.service';
import { realPricingEngineService } from './pricing-engine.testing';

describe('Pricing field defaults: existing mobile payloads, real database', () => {
  let db: DataSource;
  let fields: PricingFieldsService;
  let rules: PricingRulesService;
  let engine: PricingEngineService;
  let categoryId: string;
  let serviceId: string;
  const runId = `slider-${Date.now()}`;

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await db.initialize();
    const [category] = await db.query(
      'INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$1,$2) RETURNING id',
      ['Slider defaults test', runId],
    );
    categoryId = category.id;
    const [service] = await db.query(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',0) RETURNING id`,
      [categoryId, 'Slider defaults test', runId],
    );
    serviceId = service.id;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
    fields = new PricingFieldsService(db.getRepository(ServicePricingField), db.getRepository(ServicePricingRule), audit);
    rules = new PricingRulesService(db.getRepository(ServicePricingRule), db.getRepository(ServicePricingField), audit);
    engine = realPricingEngineService(db);
  });

  async function clearFields() {
    await db.query('DELETE FROM service_pricing_evaluations WHERE service_id = $1', [serviceId]);
    await db.query('DELETE FROM service_pricing_rules WHERE service_id = $1', [serviceId]);
    await db.query('DELETE FROM service_pricing_fields WHERE service_id = $1', [serviceId]);
  }

  beforeEach(clearFields);
  afterAll(async () => {
    if (!db?.isInitialized) return;
    await clearFields();
    await db.query('DELETE FROM services WHERE id = $1', [serviceId]);
    await db.query('DELETE FROM service_categories WHERE id = $1', [categoryId]);
    await db.destroy();
  });

  function create(overrides: Partial<CreatePricingFieldDto> = {}) {
    return fields.create('local-test-admin', serviceId, {
      field_key: 'count', label_ar: 'Count', field_type: PricingFieldType.SLIDER,
      is_required: false, min_value: 0, max_value: 10, ...overrides,
    });
  }

  it.each([
    ['omitted, min=0', {}, {}, 0],
    ['omitted, min=2', { min_value: 2 }, {}, 2],
    ['omitted, no min', { min_value: undefined }, {}, 0],
    ['omitted, default=3', { default_value: '3' }, {}, 3],
    ['explicit 5 overrides default=3', { default_value: '3' }, { count: 5 }, 5],
    ['explicit zero overrides default=3', { default_value: '3' }, { count: 0 }, 0],
    ['explicit string zero', { default_value: '3' }, { count: '0' }, '0'],
    ['empty input follows existing missing-input semantics', {}, { count: '' }, 0],
    ['decimal min', { min_value: 0.5 }, {}, 0.5],
  ] as [string, Partial<CreatePricingFieldDto>, Record<string, string | number | boolean>, string | number][])('%s', async (_name, config, input, expected) => {
    await create(config);
    expect(await engine.validateFieldValuesOnly(serviceId, input)).toEqual({ count: expected });
  });

  it('required slider still needs explicit input, even with a default', async () => {
    await create({ is_required: true, default_value: '3' });
    await expect(engine.validateFieldValuesOnly(serviceId, {})).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await engine.validateFieldValuesOnly(serviceId, { count: 0 })).toEqual({ count: 0 });
  });

  it.each([PricingFieldType.SLIDER, PricingFieldType.NUMBER])('%s rejects invalid numeric defaults before persistence', async (fieldType) => {
    for (const value of ['-1', '11', 'NaN', 'Infinity', '   ']) {
      await expect(create({ field_type: fieldType, default_value: value })).rejects.toMatchObject({ code: 'VAL_001' });
    }
    expect(await fields.listForService(serviceId)).toHaveLength(0);
  });

  it('min=0, max=100, default=0 persists and reloads without losing zero', async () => {
    const field = await create({ max_value: 100, default_value: '0' });
    const [stored] = await fields.listForService(serviceId);
    expect(stored.id).toBe(field.id);
    expect(stored.defaultValue).toBe('0');
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: 0 });
  });

  it('rejects a partial default or bound update against the merged existing settings', async () => {
    const field = await create({ default_value: '3' });
    for (const update of [{ default_value: '11' }, { min_value: 4 }, { max_value: 2 }]) {
      await expect(fields.update('local-test-admin', field.id, update)).rejects.toMatchObject({ code: 'VAL_001' });
    }
    const [stored] = await fields.listForService(serviceId);
    expect(stored.defaultValue).toBe('3');
    expect(Number(stored.minValue)).toBe(0);
    expect(Number(stored.maxValue)).toBe(10);
  });

  it('can update bounds and default together, then clear the default via null', async () => {
    const field = await create({ default_value: '3' });
    await fields.update('local-test-admin', field.id, { min_value: 4, default_value: '5' });
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: 5 });
    await fields.update('local-test-admin', field.id, { default_value: null });
    expect((await fields.listForService(serviceId))[0].defaultValue).toBeNull();
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: 4 });
  });

  it('legacy out-of-range default is rejected at evaluation; explicit valid input still wins', async () => {
    const field = await create();
    await db.query('UPDATE service_pricing_fields SET default_value = $1 WHERE id = $2', ['11', field.id]);
    await expect(engine.validateFieldValuesOnly(serviceId, {})).rejects.toMatchObject({ code: 'VAL_001' });
    expect(await engine.validateFieldValuesOnly(serviceId, { count: 5 })).toEqual({ count: 5 });
  });

  it('implicit slider default still passes the normal limits validator', async () => {
    await create({ min_value: undefined, max_value: -1 });
    await expect(engine.validateFieldValuesOnly(serviceId, {})).rejects.toMatchObject({ code: 'VAL_001' });
    await expect(engine.validateFieldValuesOnly(serviceId, { count: 20 })).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('number has no new implicit min fallback and retains explicit default behavior', async () => {
    const field = await create({ field_type: PricingFieldType.NUMBER });
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({});
    await fields.update('local-test-admin', field.id, { default_value: '3' });
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: 3 });
    expect(await engine.validateFieldValuesOnly(serviceId, { count: 0 })).toEqual({ count: 0 });
  });

  it('checkbox keeps false fallback, explicit true default, and explicit false override', async () => {
    const field = await create({ field_type: PricingFieldType.CHECKBOX, min_value: undefined, max_value: undefined });
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: false });
    await fields.update('local-test-admin', field.id, { default_value: 'true' });
    expect(await engine.validateFieldValuesOnly(serviceId, {})).toEqual({ count: true });
    expect(await engine.validateFieldValuesOnly(serviceId, { count: false })).toEqual({ count: false });
  });

  it('ironing formula resolves five untouched sliders identically in draft, production and snapshot', async () => {
    const keys = ['shirts', 'tshirts', 'trousers', 'dresses', 'jackets'];
    for (const field_key of keys) await create({ field_key });
    await rules.upsert('local-test-admin', serviceId, {
      rule_key: 'final_price', rule_type: PricingRuleType.FORMULA,
      payload: { price_cents: { type: 'add', operands: keys.map((field_key, index) => ({
        type: 'multiply', operands: [{ type: 'field_ref', field_key }, { type: 'literal', value: (index + 1) * 100 }],
      })) } },
    });
    expect((await engine.evaluateDraft(serviceId, {})).priceCents).toBe(0);
    const values = { shirts: 5, jackets: 2 };
    expect((await engine.evaluateDraft(serviceId, values)).priceCents).toBe(1500);
    const live = await engine.evaluate(serviceId, values);
    expect(live.priceCents).toBe(1500);
    const snapshot = await db.getRepository(ServicePricingEvaluation).findOneByOrFail({ id: live.evaluationId! });
    expect(snapshot.fieldValues).toEqual({ shirts: 5, tshirts: 0, trousers: 0, dresses: 0, jackets: 2 });
  });

  it('default nullable contract permits clearing without permitting empty strings or numbers', async () => {
    expect(await validate(plainToInstance(UpdatePricingFieldDto, { default_value: null }))).toHaveLength(0);
    for (const default_value of ['', 3]) {
      expect((await validate(plainToInstance(UpdatePricingFieldDto, { default_value }))).length).toBeGreaterThan(0);
    }
  });
});
