import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingRulesService } from './pricing-rules.service';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';

/**
 * Script 7 Phase 3 — بَقّة حقيقية اتلقطت أثناء مراجعة `resolveDefaultValue()` (اللي اتضافت في
 * Script 6 Part 3/4 لحقول CHECKBOX): القيمة الافتراضية (`default_value`) لأي حقل بيتاخد
 * `continue` فورًا في `validateAndNormalizeFieldValues()` (سطر 223) — يعني بتتجاوز تمامًا فحص
 * الحدود (`min_value`/`max_value` لحقول NUMBER/SLIDER) وفحص عضوية القيمة في `options` (حقول
 * DROPDOWN/MULTI_SELECT) اللي أي قيمة **مُدخَلة من العميل** بتتفحص بيهم في نفس الدالة (سطور
 * 226-252). النتيجة: أدمن يقدر يحفظ `default_value` غير صالح (رقم بره الحدود، أو قيمة مش من
 * ضمن الـoptions) بلا أي فحص وقت الحفظ ولا وقت التقييم — وأي عميل ما لمسش الحقل ده هياخد سعر
 * محسوب من قيمة افتراضية فاسدة بصمت، بلا أي خطأ يتبّه حد.
 *
 * الاختبار ده بيثبت الاستغلال حيًا (مش نظريًا): حقل NUMBER بحدود [1,100]، default_value='99999'
 * (بره الحدود تمامًا)، ومعادلة بتستخدمه مباشرة في السعر. النتيجة الفعلية قبل الإصلاح: السعر
 * بيتحسب بـ99999 من غير أي رفض — سعر خاطئ تمامًا بصمت.
 */
describe('PricingEngineService — default_value بتتجاوز فحص min/max وoptions (Script 7 Phase 3)', () => {
  let dataSource: DataSource;
  let pricingEngineService: PricingEngineService;
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
  const runId = Date.now().toString(36);
  const ids = { category: '', serviceOutOfRange: '', serviceInvalidOption: '', adminUser: '' };

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
      `فئة تجاوز افتراضي ${runId}`,
      `Default Bypass Category ${runId}`,
      `test-default-bypass-cat-${runId}`,
    ]);
    ids.category = category.id;

    const mkService = async (label: string) => {
      const [service] = await q(
        `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
         VALUES ($1,$2,$3,'formula',0,20,0) RETURNING id`,
        [ids.category, `خدمة ${label} ${runId}`, `test-default-bypass-${label}-${runId}`],
      );
      return service.id as string;
    };
    ids.serviceOutOfRange = await mkService('outofrange');
    ids.serviceInvalidOption = await mkService('invalidopt');

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2048${runId}`.slice(0, 15),
      `أدمن اختبار تجاوز ${runId}`,
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

    // خدمة #1: حقل NUMBER بحدود [1,100] لكن default_value='99999' (بره الحدود تمامًا).
    await fieldsService.create(ids.adminUser, ids.serviceOutOfRange, {
      field_key: 'area',
      label_ar: 'المساحة',
      field_type: PricingFieldType.NUMBER,
      is_required: false,
      min_value: 1,
      max_value: 100,
      default_value: '99999',
    });
    await rulesService.upsert(ids.adminUser, ids.serviceOutOfRange, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: { type: 'multiply', operands: [{ type: 'field_ref', field_key: 'area' }, { type: 'literal', value: 100 }] },
      },
    });

    // خدمة #2: حقل DROPDOWN بخيارات محدودة (small/large) لكن default_value='huge' (مش من ضمنها).
    await fieldsService.create(ids.adminUser, ids.serviceInvalidOption, {
      field_key: 'size',
      label_ar: 'الحجم',
      field_type: PricingFieldType.DROPDOWN,
      is_required: false,
      options: [
        { value: 'small', label_ar: 'صغير' },
        { value: 'large', label_ar: 'كبير' },
      ],
      default_value: 'huge',
    });
    await rulesService.upsert(ids.adminUser, ids.serviceInvalidOption, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'if',
          condition: { field_key: 'size', op: 'equals', value: 'large' },
          then: { type: 'literal', value: 20000 },
          else: { type: 'literal', value: 10000 },
        },
      },
    });

    pricingEngineService = new PricingEngineService(dataSource.getRepository(ServicePricingEvaluation), fieldsService, rulesService);
  });

  afterAll(async () => {
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = ANY($1)`, [
      [ids.serviceOutOfRange, ids.serviceInvalidOption],
    ]);
    await q(`DELETE FROM service_pricing_rules WHERE service_id = ANY($1)`, [[ids.serviceOutOfRange, ids.serviceInvalidOption]]);
    await q(`DELETE FROM service_pricing_fields WHERE service_id = ANY($1)`, [[ids.serviceOutOfRange, ids.serviceInvalidOption]]);
    await q(`DELETE FROM audit_logs WHERE actor_user_id = $1`, [ids.adminUser]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.adminUser]);
    await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceOutOfRange, ids.serviceInvalidOption]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('default_value بره حدود min/max: مينفعش يتحسب بيه السعر بصمت — لازم يترفض بوضوح وقت التقييم', async () => {
    // قبل الإصلاح: priceCents = 99999 × 100 = 9999900 (سعر خاطئ تمامًا بصمت). الإصلاح: نفس
    // فحص min/max اللي أي قيمة عميل بتتعرضله بالظبط — رفض واضح أسلم من "تخمين" قيمة مقصوصة،
    // لأن سعر مقصوص لسه ممكن يبقى غلط (العميل مش بيعرف السبب)، والرفض بيلفت نظر الأدمن فورًا
    // لخطأ الإعداد بدل ما يفضل يحسب أسعار غلط بصمت لحد ما حد يلاحظ.
    await expect(pricingEngineService.evaluateDraft(ids.serviceOutOfRange, {})).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('default_value مش من ضمن options الحقل: مينفعش يتحسب بيه السعر بصمت — لازم يترفض بوضوح وقت التقييم', async () => {
    // مفيش قيمة "صحيحة" منطقية نقصّ عليها default_value غير صالح لحقل dropdown (خلاف رقم بيتقصّ
    // على حد أدنى/أقصى واضح) — الرفض الصريح هنا أسلم من تخمين "أقرب قيمة صحيحة".
    await expect(pricingEngineService.evaluateDraft(ids.serviceInvalidOption, {})).rejects.toMatchObject({ code: 'VAL_001' });
  });
});
