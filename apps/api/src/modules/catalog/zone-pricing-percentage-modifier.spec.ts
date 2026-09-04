import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { CatalogService } from './catalog.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { PricingFieldsService } from '../pricing/pricing-fields.service';
import { PricingRulesService } from '../pricing/pricing-rules.service';
import { PricingFieldType, ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { PricingRuleType, ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';

// تسعير المنطقة كمُعدِّل نسبي (docs/08 §36.22-23، ADR-0024) — اختبار حي ضد Postgres حقيقي.
// override (السلوك القديم) لازم يفضل زي ما هو بالحرف (رجريشن)، percentage جديد ولازم يتحدّث
// تلقائيًا مع أي تغيير في base_price_cents بلا أي تعديل يدوي على صف تسعير المنطقة.
describe('CatalogService.estimate() — تسعير المنطقة override/percentage (docs/08 §36.22-23، ADR-0024)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { category: '', zone: '', city: '', country: '', overrideService: '', percentageService: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country?.id ?? (await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة تسعير ${runId}`, `Pricing Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    ))[0].id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة تسعير ${runId}`, `Pricing City ${runId}`, `pricing-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق تسعير ${runId}`,
      `Pricing Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة تسعير ${runId}`,
      `Pricing Category ${runId}`,
      `pricing-category-${runId}`,
    ]);
    ids.category = category.id;

    const [overrideService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة override ${runId}`, `override-service-${runId}`],
    );
    ids.overrideService = overrideService.id;
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, price_cents)
       VALUES ($1,$2,'override',50000)`,
      [ids.overrideService, ids.zone],
    );

    const [percentageService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة نسبة ${runId}`, `percentage-service-${runId}`],
    );
    ids.percentageService = percentageService.id;
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage, surge_multiplier)
       VALUES ($1,$2,'percentage',15,0.60)`,
      [ids.percentageService, ids.zone],
    );

    service = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never,
      realPricingEngineService(dataSource),
      {} as never, // docs/08 §36.24 ADR-0025 — ServicePricingTierPricing repo جديد
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_zone_pricing WHERE service_id = ANY($1::uuid[])`, [[ids.overrideService, ids.percentageService]]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.overrideService, ids.percentageService]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  // ADR-0060 §1 — الاستبدال المطلق كان **مرفوض أصلاً** لخدمات `formula` من قبل القرار ده (السعر
  // مش «سعر وحدة» يتضرب في كمية معروفة). بعد ما كل الخدمات بقت معادلة، الوضع ده بقى مرفوض
  // دايمًا، والنسبة المئوية هي طريقة تسعير المناطق الوحيدة. الاختبار اتقلب عشان يوثّق ده صراحة
  // بدل ما يختفي.
  it('override — مرفوض دلوقتي لأي خدمة، والرسالة بتوجّه للنسبة المئوية (ADR-0060)', async () => {
    await expect(service.estimate(ids.overrideService, ids.zone)).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('percentage — نسبة مئوية فوق السعر الأساسي الحالي (10000 + 15% = 11500)', async () => {
    const estimate = await service.estimate(ids.percentageService, ids.zone);
    expect(estimate.base_price_cents).toBe(11500);
    expect(estimate.estimated_total_cents).toBe(11500);
  });

  it('percentage — تغيير السعر الأساسي بينعكس تلقائيًا بلا أي تعديل على صف تسعير المنطقة', async () => {
    await q(`UPDATE services SET base_price_cents = 20000 WHERE id = $1`, [ids.percentageService]);
    const estimate = await service.estimate(ids.percentageService, ids.zone);
    expect(estimate.base_price_cents).toBe(23000); // 20000 * 1.15
  });

  it('من غير zoneId خالص — السعر الأساسي العادي بلا أي تعديل (مفيش تسعير منطقة يتفحص أصلاً)', async () => {
    const estimate = await service.estimate(ids.percentageService);
    expect(estimate.base_price_cents).toBe(20000);
  });

  it.each([
    [20, 18000],
    [-20, 12000],
    [70, 25500],
    [130, 34500],
  ])('percentage — إدخال %s يعني النسبة نفسها حتى لو الصف فيه surge قديم مخفي', async (modifier, expected) => {
    await q(
      `UPDATE services SET base_price_cents = 15000 WHERE id = $1`,
      [ids.percentageService],
    );
    await q(
      `UPDATE service_zone_pricing SET modifier_percentage = $2, surge_multiplier = 0.60
       WHERE service_id = $1 AND pricing_mode = 'percentage'`,
      [ids.percentageService, modifier],
    );
    const estimate = await service.estimate(ids.percentageService, ids.zone);
    expect(estimate.base_price_cents).toBe(expected);
    expect(estimate.estimated_total_cents).toBe(expected);
    expect(estimate.surge_multiplier).toBe(1);
  });
});

// docs/08 §108-G — بلاغ مالك: تسعير المناطق «مش بيأثرش في السعر خالص». السبب الجذري الحقيقي:
// فرع pricing_model=formula في CatalogService.estimate() بيرجّع نتيجته بـ`return` مبكر **قبل**
// ما كود تسعير المنطقة يتنفّذ خالص — يعني أي خدمة formula (المحرك الديناميكي، §1، أهم حاجة في
// المشروع) كانت زون برايسينج ليها صفر تأثير مضمون، بغض النظر عن أي إصلاح جوّه الفرع القديم
// (594346e كان بيصلح رياضيات الفرع ده بس، مش وصول formula له أصلًا). اختبار حي كامل هنا: خدمة
// formula حقيقية بقاعدة تسعير فعلية (`price_cents = area × 100`)، وتأكيد إن نسبة المنطقة بتتطبّق
// على ناتج المعادلة، مش بس على base_price_cents (اللي أصلًا مش مستخدم في formula).
describe('CatalogService.estimate() — تسعير المنطقة على خدمات formula (docs/08 §108-G)', () => {
  let dataSource: DataSource;
  let catalogService: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
  const ids = { category: '', zone: '', city: '', country: '', formulaService: '', adminUser: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service,
        ServiceCategory,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        ServicePricingField,
        ServicePricingRule,
        ServicePricingEvaluation,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country?.id ?? (await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة formula ${runId}`, `Formula Zone Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    ))[0].id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة formula zone ${runId}`, `Formula Zone City ${runId}`, `formula-zone-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق formula ${runId}`,
      `Formula Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة formula zone ${runId}`,
      `Formula Zone Category ${runId}`,
      `formula-zone-category-${runId}`,
    ]);
    ids.category = category.id;
    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2047${runId}`.slice(0, 15),
      `أدمن formula zone ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const [formulaService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',0,20,0) RETURNING id`,
      [ids.category, `خدمة formula zone ${runId}`, `formula-zone-service-${runId}`],
    );
    ids.formulaService = formulaService.id;

    // نفس نمط pricing-draft-preview.spec.ts — حقل مساحة رقمي + قاعدة: price_cents = area × 100.
    const fieldsService = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      { record: auditLogRecord } as unknown as AuditLogService,
    );
    await fieldsService.create(ids.adminUser, ids.formulaService, {
      field_key: 'area',
      label_ar: 'المساحة',
      field_type: PricingFieldType.NUMBER,
      is_required: true,
    });
    const rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      { record: auditLogRecord } as unknown as AuditLogService,
    );
    await rulesService.upsert(ids.adminUser, ids.formulaService, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: { price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] } },
    });
    const pricingEngineService = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
      dataSource.getRepository(Service),
    );

    // نسبة منطقة +15% — نفس صف تسعير المناطق العادي، بس على خدمة formula هنا.
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage)
       VALUES ($1,$2,'percentage',15)`,
      [ids.formulaService, ids.zone],
    );

    catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      { getNumber: async (_key: string, fallback: number) => fallback } as never,
      pricingEngineService,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [ids.formulaService]);
    await q(`DELETE FROM service_pricing_rules WHERE service_id = $1`, [ids.formulaService]);
    await q(`DELETE FROM service_pricing_fields WHERE service_id = $1`, [ids.formulaService]);
    await q(`DELETE FROM service_zone_pricing WHERE service_id = $1`, [ids.formulaService]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.formulaService]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.adminUser]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('بلا zoneId: السعر = ناتج المعادلة الخام بلا أي تعديل (مساحة 50 × 100 = 5000)', async () => {
    const estimate = await catalogService.estimate(ids.formulaService, undefined, undefined, false, { area: 50 });
    expect(estimate.base_price_cents).toBe(5000);
    expect(estimate.estimated_total_cents).toBe(5000);
  });

  it('مع zoneId: نسبة المنطقة (+15%) بتتطبّق على ناتج المعادلة نفسه — كانت قبل الإصلاح بتتجاهل تمامًا', async () => {
    const estimate = await catalogService.estimate(ids.formulaService, ids.zone, undefined, false, { area: 50 });
    // 50 × 100 = 5000 (ناتج المعادلة)، × 1.15 (نسبة المنطقة) = 5750.
    expect(estimate.base_price_cents).toBe(5750);
    expect(estimate.estimated_total_cents).toBe(5750);
  });

  it('تغيير مساحة العميل بيتضاعف مع نسبة المنطقة تلقائيًا (100 × 100 × 1.15 = 11500)', async () => {
    const estimate = await catalogService.estimate(ids.formulaService, ids.zone, undefined, false, { area: 100 });
    expect(estimate.base_price_cents).toBe(11500);
    expect(estimate.estimated_total_cents).toBe(11500);
  });
});
