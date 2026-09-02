import { DataSource } from 'typeorm';
import { Service } from '../catalog/entities/service.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule } from './entities/service-pricing-rule.entity';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { PricingTemplatesService } from './pricing-templates.service';
import { PricingTemplateKey, pricingTemplateFinalPricePayload } from './pricing-templates';

// اختبار حي ضد Postgres حقيقي — قوالب التسعير (ADR-0060، docs/08 §113).
//
// الملف ده بديل `hourly-pricing.spec.ts` و`per-unit-pricing.spec.ts` القديمين. الاتنين دول
// كانوا بيختبروا **أوضاع تشغيل** (`pricing_model=hourly` / `per_unit`) اللي اتشالت بالكامل.
// اللي بيتختبر دلوقتي هو نفس السلوك التجاري بالظبط، بس عبر المسار الوحيد الباقي: قالب بيزرع
// حقول ومعادلة، والمحرك بيقيّمها.
//
// المالك طلب حرفيًا: «نجرب كل ده ونتأكد إن الفلو بتاع كل واحدة شغال على حدة».
describe('قوالب التسعير — كل قالب بيولّد فلو شغّال فعليًا (ADR-0060)', () => {
  let dataSource: DataSource;
  let templatesService: PricingTemplatesService;
  let engine: PricingEngineService;
  const runId = Date.now().toString(36);
  const ids: { category: string; services: string[] } = { category: '', services: [] };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function makeService(label: string, basePriceCents: number): Promise<string> {
    const [row] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',$4) RETURNING id`,
      [ids.category, `خدمة ${label} ${runId}`, `tpl-${label}-${runId}`, basePriceCents],
    );
    ids.services.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();
    const auditStub = { record: async () => undefined } as never;
    const fieldsService = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      auditStub,
    );
    const rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      auditStub,
    );
    engine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
      dataSource.getRepository(Service),
    );
    templatesService = new PricingTemplatesService(
      dataSource.getRepository(Service),
      dataSource.getRepository(ServicePricingField),
      fieldsService,
      rulesService,
      auditStub,
    );

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة قوالب ${runId}`,
      `Templates ${runId}`,
      `tpl-cat-${runId}`,
    ]);
    ids.category = category.id;
  });

  afterAll(async () => {
    if (ids.services.length) {
      await q(`DELETE FROM service_pricing_rules WHERE service_id = ANY($1::uuid[])`, [ids.services]);
      await q(`DELETE FROM service_pricing_fields WHERE service_id = ANY($1::uuid[])`, [ids.services]);
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [ids.services]);
    }
    if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('سعر ثابت: مفيش أي حقل بيتطلب، والسعر هو الرقم نفسه', async () => {
    const serviceId = await makeService('fixed', 1);
    const result = await templatesService.apply('admin-1', serviceId, PricingTemplateKey.FIXED, 50000);
    expect(result.created_field_keys).toEqual([]);

    const price = await engine.evaluate(serviceId, {});
    expect(price.priceCents).toBe(50000);
  });

  it('بالساعة: بيزرع حقل «عدد الساعات» والسعر = الساعات × سعر الساعة', async () => {
    const serviceId = await makeService('hourly', 1);
    const result = await templatesService.apply('admin-1', serviceId, PricingTemplateKey.HOURLY, 8000);
    expect(result.created_field_keys).toEqual(['hours']);

    expect((await engine.evaluate(serviceId, { hours: 3 })).priceCents).toBe(24000);
    expect((await engine.evaluate(serviceId, { hours: 1 })).priceCents).toBe(8000);
  });

  it('باليوم: بيزرع حقل «عدد الأيام» والسعر = الأيام × سعر اليوم', async () => {
    const serviceId = await makeService('daily', 1);
    const result = await templatesService.apply('admin-1', serviceId, PricingTemplateKey.DAILY, 20000);
    expect(result.created_field_keys).toEqual(['days']);
    expect((await engine.evaluate(serviceId, { days: 4 })).priceCents).toBe(80000);
  });

  it('بالقطعة: بيزرع حقل «الكمية» والسعر = الكمية × سعر الوحدة', async () => {
    const serviceId = await makeService('per-unit', 1);
    const result = await templatesService.apply('admin-1', serviceId, PricingTemplateKey.PER_UNIT, 3000);
    expect(result.created_field_keys).toEqual(['units']);
    expect((await engine.evaluate(serviceId, { units: 5 })).priceCents).toBe(15000);
  });

  // ده البلاغ الأصلي بالحرف: «مش عارف إزاي أحط الحجز بالشهر». التاريخين بيتحطوا كحقلين عاديين
  // في الفورم، والمعادلة بتقرا منهم — مفيش أي مدخل نظامي منفصل، ومفيش أربع حقول تاريخ.
  it('بالشهر: حقلين تاريخ في الفورم، وشهور الفوترة بتتحسب منهم (أي جزء من شهر = شهر كامل)', async () => {
    const serviceId = await makeService('monthly', 1);
    const result = await templatesService.apply('admin-1', serviceId, PricingTemplateKey.MONTHLY, 250000);
    expect(result.created_field_keys).toEqual(['period_start', 'period_end']);

    const fields = await q(
      `SELECT field_key, field_type FROM service_pricing_fields WHERE service_id = $1 AND deleted_at IS NULL ORDER BY display_order`,
      [serviceId],
    );
    expect(fields.map((f: { field_key: string }) => f.field_key)).toEqual(['period_start', 'period_end']);
    expect(fields.every((f: { field_type: string }) => f.field_type === 'date')).toBe(true);

    // شهر بالظبط
    expect(
      (await engine.evaluate(serviceId, { period_start: '2026-01-01', period_end: '2026-02-01' })).priceCents,
    ).toBe(250000);
    // تلات شهور بالظبط
    expect(
      (await engine.evaluate(serviceId, { period_start: '2026-01-01', period_end: '2026-04-01' })).priceCents,
    ).toBe(750000);
    // شهر ويوم = شهرين (ceil)
    expect(
      (await engine.evaluate(serviceId, { period_start: '2026-01-01', period_end: '2026-02-02' })).priceCents,
    ).toBe(500000);
    // أقل من شهر = شهر واحد (الحد الأدنى)
    expect(
      (await engine.evaluate(serviceId, { period_start: '2026-01-01', period_end: '2026-01-10' })).priceCents,
    ).toBe(250000);
  });

  it('خدمة لسه بلا معادلة: بتشتغل كسعر ثابت عند base_price_cents بدل ما ترمي خطأ', async () => {
    const serviceId = await makeService('nodata', 33000);
    expect((await engine.evaluate(serviceId, {})).priceCents).toBe(33000);
  });

  // تكافؤ الهجرة: migration 0242 مكتوبة SQL خام (لقطة تاريخية مجمّدة)، فالتكافؤ مع دوال القوالب
  // مش مفترض — مُثبت هنا على صف حقيقي اتحوّل فعليًا.
  it('الهجرة 0242 كتبت نفس شجرة قالب «سعر ثابت» بالحرف للخدمات القديمة', async () => {
    const [migrated] = await q(
      `SELECT r.payload, s.base_price_cents, s.min_price_cents, s.max_price_cents
         FROM service_pricing_rules r
         JOIN services s ON s.id = r.service_id
        WHERE r.rule_key = 'final_price'
          AND r.payload->'price_cents'->>'type' = 'literal'
          AND s.id <> ALL($1::uuid[])
        LIMIT 1`,
      [ids.services],
    );
    if (!migrated) return; // قاعدة نضيفة بلا خدمات قديمة — مفيش حاجة تتقارن
    expect(migrated.payload).toEqual(
      pricingTemplateFinalPricePayload(
        PricingTemplateKey.FIXED,
        migrated.base_price_cents,
        migrated.min_price_cents,
        migrated.max_price_cents,
      ),
    );
  });
});
