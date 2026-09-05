import { Service } from '../catalog/entities/service.entity';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';
import { purgeAuditLogs } from '../../common/db/audit-purge.testing';

// اختبار حي ضد Postgres حقيقي — Script 6 Part 3/4 (بَقّة حقيقية: CHECKBOX اختياري متلمسش كان
// بيكسر تقييم السعر بالكامل بـ400 بدل ما ياخد قيمته الافتراضية). سيناريوهات السكريبت الثلاثة
// بالحرف: has_bathtub=false untouched → السعر بيتحسب، true → الإضافة تظهر، false تاني → تختفي.
describe('PricingEngineService — قيمة افتراضية لحقل CHECKBOX اختياري (Script 6 Part 3/4)', () => {
  let dataSource: DataSource;
  let pricingEngineService: PricingEngineService;
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
  const runId = Date.now().toString(36);
  const ids = { category: '', serviceImplicit: '', serviceExplicit: '', adminUser: '' };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة افتراضي ${runId}`,
      `Default Value Category ${runId}`,
      `test-default-value-cat-${runId}`,
    ]);
    ids.category = category.id;

    const mkService = async (label: string) => {
      const [service] = await q(
        `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
         VALUES ($1,$2,$3,'formula',0,20,0) RETURNING id`,
        [ids.category, `خدمة ${label} ${runId}`, `test-default-value-${label}-${runId}`],
      );
      return service.id as string;
    };
    ids.serviceImplicit = await mkService('implicit');
    ids.serviceExplicit = await mkService('explicit');

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2047${runId}`.slice(0, 15),
      `أدمن اختبار افتراضي ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    const fieldsService = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      { record: auditLogRecord } as unknown as AuditLogService,
    );
    const rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      { record: auditLogRecord } as unknown as AuditLogService,
    );

    // خدمة #1: has_bathtub اختياري بلا default_value مُعدّ — لازم ياخد الافتراض الضمني false.
    await fieldsService.create(ids.adminUser, ids.serviceImplicit, {
      field_key: 'area', label_ar: 'المساحة', field_type: PricingFieldType.NUMBER, is_required: true,
    });
    await fieldsService.create(ids.adminUser, ids.serviceImplicit, {
      field_key: 'has_bathtub', label_ar: 'هل يوجد بانيو؟', field_type: PricingFieldType.CHECKBOX, is_required: false,
    });
    await rulesService.upsert(ids.adminUser, ids.serviceImplicit, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'add',
          operands: [
            { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] },
            { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'has_bathtub' }, { type: 'literal', value: 5000 }] },
          ],
        },
      },
    });

    // خدمة #2: has_bathtub اختياري بـdefault_value='true' مُعدّ صراحة — لازم ياخد true لو متلمسش.
    await fieldsService.create(ids.adminUser, ids.serviceExplicit, {
      field_key: 'area', label_ar: 'المساحة', field_type: PricingFieldType.NUMBER, is_required: true,
    });
    await fieldsService.create(ids.adminUser, ids.serviceExplicit, {
      field_key: 'has_bathtub', label_ar: 'هل يوجد بانيو؟', field_type: PricingFieldType.CHECKBOX, is_required: false, default_value: 'true',
    });
    await rulesService.upsert(ids.adminUser, ids.serviceExplicit, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'add',
          operands: [
            { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] },
            { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'has_bathtub' }, { type: 'literal', value: 5000 }] },
          ],
        },
      },
    });

    pricingEngineService = new PricingEngineService(dataSource.getRepository(ServicePricingEvaluation), fieldsService, rulesService, dataSource.getRepository(Service));
  });

  afterAll(async () => {
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = ANY($1)`, [[ids.serviceImplicit, ids.serviceExplicit]]);
    await q(`DELETE FROM service_pricing_rules WHERE service_id = ANY($1)`, [[ids.serviceImplicit, ids.serviceExplicit]]);
    await q(`DELETE FROM service_pricing_fields WHERE service_id = ANY($1)`, [[ids.serviceImplicit, ids.serviceExplicit]]);
    await purgeAuditLogs(dataSource, `DELETE FROM audit_logs WHERE actor_user_id = $1`, [ids.adminUser]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.adminUser]);
    await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceImplicit, ids.serviceExplicit]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('سيناريو A — has_bathtub متلمسش (مش مبعوت خالص في field_values): السعر بيتحسب بالافتراض false، صفر إضافة', async () => {
    const result = await pricingEngineService.evaluateDraft(ids.serviceImplicit, { area: 10 });
    expect(result.priceCents).toBe(1000); // 10×100 + false(0)×5000
  });

  it('سيناريو B — has_bathtub=true: الإضافة (5000) بتظهر', async () => {
    const result = await pricingEngineService.evaluateDraft(ids.serviceImplicit, { area: 10, has_bathtub: true });
    expect(result.priceCents).toBe(6000); // 10×100 + true(1)×5000
  });

  it('سيناريو C — has_bathtub=false صراحة: الإضافة بتختفي تاني', async () => {
    const result = await pricingEngineService.evaluateDraft(ids.serviceImplicit, { area: 10, has_bathtub: false });
    expect(result.priceCents).toBe(1000);
  });

  it('default_value مُعدّ صراحة (true) على حقل متلمسش: بياخد القيمة المُعدّة مش false الضمني', async () => {
    const result = await pricingEngineService.evaluateDraft(ids.serviceExplicit, { area: 10 });
    expect(result.priceCents).toBe(6000); // 10×100 + true(1)×5000 من default_value
  });

  it('حقل رقمي مطلوب (area) متلمسش: لسه بيترفض بوضوح (مفيش افتراض ضمني لأنواع غير checkbox)', async () => {
    await expect(pricingEngineService.evaluateDraft(ids.serviceImplicit, {})).rejects.toMatchObject({ code: 'VAL_001' });
  });
});
