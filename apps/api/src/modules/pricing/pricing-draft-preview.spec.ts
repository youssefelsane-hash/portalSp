import { Service } from '../catalog/entities/service.entity';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingRuleTestsService } from './pricing-rule-tests.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';
import { ServicePricingRuleTest } from './entities/service-pricing-rule-test.entity';

// اختبار حي ضد Postgres حقيقي — معاينة مسوّدة + حالات اختبار محفوظة (Script 4 Part L §47-48).
// كانت فجوة موثّقة صراحة: المعاينة الوحيدة الموجودة (evaluate-price) بتقرا القواعد المحفوظة
// فعليًا بس — الأدمن مضطر يحفظ (ينشر لعملاء حقيقيين) قبل ما يقدر يعاين نتيجة تعديله.
describe('PricingEngineService.evaluateDraft() + PricingRuleTestsService (Script 4 Part L §47-48)', () => {
  let dataSource: DataSource;
  let pricingEngineService: PricingEngineService;
  let ruleTestsService: PricingRuleTestsService;
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
  const runId = Date.now().toString(36);
  const ids = {
    category: '',
    service: '',
    adminUser: '',
  };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServicePricingField, ServicePricingRule, ServicePricingEvaluation, ServicePricingRuleTest],
    });
    await dataSource.initialize();

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة معاينة تسعير ${runId}`,
      `Pricing Draft Category ${runId}`,
      `test-pricing-draft-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',0,20,0) RETURNING id`,
      [ids.category, `خدمة معاينة تسعير ${runId}`, `test-pricing-draft-svc-${runId}`],
    );
    ids.service = service.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2046${runId}`.slice(0, 15),
      `أدمن معاينة تسعير ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    // حقل رقمي "area" — نفس نمط المعادلة الحقيقية المستخدمة في اختبارات formula-evaluator.
    const fieldsService = new PricingFieldsService(dataSource.getRepository(ServicePricingField), dataSource.getRepository(ServicePricingRule), { record: auditLogRecord } as unknown as AuditLogService);
    await fieldsService.create(ids.adminUser, ids.service, {
      field_key: 'area',
      label_ar: 'المساحة',
      field_type: PricingFieldType.NUMBER,
      is_required: true,
    });

    const rulesService = new PricingRulesService(dataSource.getRepository(ServicePricingRule), dataSource.getRepository(ServicePricingField), { record: auditLogRecord } as unknown as AuditLogService);
    // القاعدة الحية: price_cents = area × 100 (100 قرش للمتر)
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: { price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] } },
    });

    pricingEngineService = new PricingEngineService(dataSource.getRepository(ServicePricingEvaluation), fieldsService, rulesService, dataSource.getRepository(Service));
    ruleTestsService = new PricingRuleTestsService(
      dataSource.getRepository(ServicePricingRuleTest),
      pricingEngineService,
      { record: auditLogRecord } as unknown as AuditLogService,
    );
  });

  afterEach(() => {
    auditLogRecord.mockClear();
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM service_pricing_rule_tests WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM service_pricing_rules WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM service_pricing_fields WHERE service_id = $1`, [ids.service]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.adminUser]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('evaluateDraft() بدون override — بيرجع نفس نتيجة القاعدة الحية، وصفر كتابة في service_pricing_evaluations', async () => {
    const before = await q(`SELECT count(*)::int AS c FROM service_pricing_evaluations WHERE service_id = $1`, [ids.service]);
    const result = await pricingEngineService.evaluateDraft(ids.service, { area: 10 });
    expect(result.priceCents).toBe(1000);
    const after = await q(`SELECT count(*)::int AS c FROM service_pricing_evaluations WHERE service_id = $1`, [ids.service]);
    expect(after[0].c).toBe(before[0].c);
  });

  it('evaluateDraft() مع override — بيقيّم المسوّدة مش القاعدة المحفوظة، وبرضه صفر كتابة', async () => {
    const draftPayload = {
      price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 250 }] },
    };
    const result = await pricingEngineService.evaluateDraft(ids.service, { area: 10 }, draftPayload);
    expect(result.priceCents).toBe(2500);

    // القاعدة الحية لسه زي ما هي (100 مش 250) — evaluateDraft ما عدّلتش أي حاجة محفوظة
    const liveResult = await pricingEngineService.evaluateDraft(ids.service, { area: 10 });
    expect(liveResult.priceCents).toBe(1000);
  });

  it('evaluateDraft() بيرفض override بشكل غير صالح (نفس validateFinalPriceFormulaPayload المستخدمة وقت الحفظ)', async () => {
    await expect(pricingEngineService.evaluateDraft(ids.service, { area: 10 }, { not_price_cents: 5 } as never)).rejects.toThrow();
    await expect(
      pricingEngineService.evaluateDraft(ids.service, { area: 10 }, { price_cents: { type: 'eval', code: 'alert(1)' } } as never),
    ).rejects.toThrow();
  });

  it('PricingRuleTestsService: CRUD + runAll ضد القاعدة الحية (بدون override) — نجاح وفشل', async () => {
    const passing = await ruleTestsService.create(ids.adminUser, ids.service, {
      label: 'مساحة 10 = 1000 قرش',
      field_values: { area: 10 },
      expected_price_cents: 1000,
    });
    const failing = await ruleTestsService.create(ids.adminUser, ids.service, {
      label: 'توقّع خاطئ عمدًا',
      field_values: { area: 10 },
      expected_price_cents: 9999,
    });

    const list = await ruleTestsService.listForService(ids.service);
    expect(list.map((t) => t.id).sort()).toEqual([passing.id, failing.id].sort());

    const results = await ruleTestsService.runAll(ids.service);
    const passingResult = results.find((r) => r.id === passing.id)!;
    const failingResult = results.find((r) => r.id === failing.id)!;
    expect(passingResult.passed).toBe(true);
    expect(passingResult.actual_price_cents).toBe(1000);
    expect(failingResult.passed).toBe(false);
    expect(failingResult.actual_price_cents).toBe(1000);
    expect(failingResult.expected_price_cents).toBe(9999);

    await ruleTestsService.delete(ids.adminUser, failing.id);
    const afterDelete = await ruleTestsService.listForService(ids.service);
    expect(afterDelete.map((t) => t.id)).toEqual([passing.id]);
  });

  it('runAll() مع formula_payload override — بيشغّل كل الحالات ضد المسوّدة بدل القاعدة الحية', async () => {
    const test = await ruleTestsService.create(ids.adminUser, ids.service, {
      label: 'حالة ضد مسوّدة',
      field_values: { area: 4 },
      expected_price_cents: 1000, // متوقّع لمعادلة مسوّدة (250/متر) مش الحية (100/متر)
    });
    const draftPayload = {
      price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 250 }] },
    };

    const resultsAgainstLive = await ruleTestsService.runAll(ids.service);
    const liveOutcome = resultsAgainstLive.find((r) => r.id === test.id)!;
    expect(liveOutcome.passed).toBe(false); // 4×100=400 != 1000 المتوقّع لمعادلة المسوّدة

    const resultsAgainstDraft = await ruleTestsService.runAll(ids.service, draftPayload);
    const draftOutcome = resultsAgainstDraft.find((r) => r.id === test.id)!;
    expect(draftOutcome.passed).toBe(true); // 4×250=1000

    await ruleTestsService.delete(ids.adminUser, test.id);
  });

  it('delete() لحالة اختبار مش موجودة يرفض بوضوح', async () => {
    await expect(ruleTestsService.delete(ids.adminUser, '00000000-0000-0000-0000-000000000000')).rejects.toThrow();
  });
});
