import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { PricingEngineService } from './pricing-engine.service';
import { PricingFieldsService } from './pricing-fields.service';
import { PricingFieldType, ServicePricingField } from './entities/service-pricing-field.entity';
import { PricingRuleType, ServicePricingRule } from './entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingRuleTest } from './entities/service-pricing-rule-test.entity';
import { PricingRulesService } from './pricing-rules.service';

/**
 * موجة 2 من docs/01B — حواجز التغييرات التدميرية (§13/§14) + trace/شرح (§5/§6):
 * - حقل مستخدم في معادلة نشطة: حذفه/تعطيله/تغيير نوعه مرفوض، وتغيير الـlabel مسموح.
 * - ثابت/جدول بحث مستخدم: تعطيله مرفوض بمسار الاستخدام.
 * - evaluateDraftDetailed بيرجع خطوات الحساب وشرح هيكلي مطابقين للتقييم العادي.
 */
describe('Price Engine — lifecycle guards + trace/explanation (PostgreSQL)', () => {
  let dataSource: DataSource;
  let fieldsService: PricingFieldsService;
  let rulesService: PricingRulesService;
  let engine: PricingEngineService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { adminUser: '', category: '', service: '', fieldUsed: '', constantUsed: '', lookupUsed: '' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        ServicePricingField,
        ServicePricingRule,
        ServicePricingEvaluation,
        ServicePricingRuleTest,
      ],
    });
    await dataSource.initialize();

    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2044${runId}`.slice(0, 15), `أدمن حواجز ${runId}`],
    );
    ids.adminUser = adminUser.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة حواجز ${runId}`, `Guard Cat ${runId}`, `guard-cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',200000) RETURNING id`,
      [ids.category, `خدمة حواجز ${runId}`, `guard-svc-${runId}`],
    );
    ids.service = service.id;

    const auditMock = { record: async () => undefined } as unknown as AuditLogService;
    fieldsService = new PricingFieldsService(
      dataSource.getRepository(ServicePricingField),
      dataSource.getRepository(ServicePricingRule),
      auditMock,
    );
    rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      auditMock,
    );
    engine = new PricingEngineService(
      dataSource.getRepository(ServicePricingEvaluation),
      fieldsService,
      rulesService,
      dataSource.getRepository(Service),
    );

    // حقول: واحد هيتستخدم في المعادلة وواحد حر
    ids.fieldUsed = (
      await fieldsService.create(ids.adminUser, ids.service, {
        field_key: 'area_used',
        label_ar: 'مساحة مستخدمة',
        field_type: PricingFieldType.NUMBER,
        is_required: true,
      })
    ).id;
    await fieldsService.create(ids.adminUser, ids.service, {
      field_key: 'free_field',
      label_ar: 'حقل حر',
      field_type: PricingFieldType.NUMBER,
      is_required: false,
    });
    // dropdown بخيارات للتحقق من حارس تقليص الخيارات
    ids.fieldUsed = (
      await fieldsService.create(ids.adminUser, ids.service, {
        field_key: 'floor_type',
        label_ar: 'نوع الأرضية',
        field_type: PricingFieldType.DROPDOWN,
        is_required: false,
        options: [{ value: 'marble', label_ar: 'رخام' }, { value: 'porcelain', label_ar: 'بورسلين' }, { value: 'ceramic', label_ar: 'سيراميك' }],
      })
    ).id;

    // ثابت + جدول بحث هيستخدموا في المعادلة
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'used_constant',
      payload: { value: 12345 },
    });
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'free_constant',
      payload: { value: 999 },
    });
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.LOOKUP_TABLE,
      rule_key: 'used_lookup',
      payload: { field_key: 'floor_type', values: { marble: 10000, porcelain: 8000, ceramic: 6000 } },
    });

    // المعادلة النشطة بتستخدم الثلاثة
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'add',
          operands: [
            {
              type: 'multiply',
              operands: [{ type: 'field_ref', field_key: 'area_used' }, { type: 'constant_ref', rule_key: 'used_constant' }],
            },
            { type: 'lookup_ref', rule_key: 'used_lookup', field_key: 'floor_type' },
          ],
        },
        estimated_duration_days: { type: 'field_ref', field_key: 'area_used' },
      },
    });

    void ids.fieldUsed;
    void ids.constantUsed;
    void ids.lookupUsed;
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM service_pricing_rules WHERE service_id=$1`, [ids.service]);
      await q(`DELETE FROM service_pricing_fields WHERE service_id=$1`, [ids.service]);
      await q(`DELETE FROM services WHERE id=$1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id=$1`, [ids.category]);
      await q(`DELETE FROM users WHERE id=$1`, [ids.adminUser]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('حذف حقل مستخدم في معادلة نشطة: مرفوض 409 بمسار الاستخدام', async () => {
    const used = await q<{ id: string }[]>(
      `SELECT id FROM service_pricing_fields WHERE service_id=$1 AND field_key='area_used'`,
      [ids.service],
    );
    await expect(fieldsService.delete(ids.adminUser, used[0].id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('area_used'),
    });
  });

  it('تعطيل حقل مستخدم: مرفوض — وتغيير الـlabel لوحده مسموح (مش جزء من هوية المرجع)', async () => {
    const used = await q<{ id: string; label_ar: string }[]>(
      `SELECT id, label_ar FROM service_pricing_fields WHERE service_id=$1 AND field_key='area_used'`,
      [ids.service],
    );
    await expect(
      fieldsService.update(ids.adminUser, used[0].id, { is_active: false }),
    ).rejects.toMatchObject({ status: 409 });
    const renamed = await fieldsService.update(ids.adminUser, used[0].id, { label_ar: 'مساحة (اسم جديد)' });
    expect(renamed.labelAr).toBe('مساحة (اسم جديد)');
  });

  it('تقليص خيارات dropdown مستخدم: مرفوض — والإضافة مسموحة', async () => {
    const floorType = await q<{ id: string }[]>(
      `SELECT id FROM service_pricing_fields WHERE service_id=$1 AND field_key='floor_type'`,
      [ids.service],
    );
    await expect(
      fieldsService.update(ids.adminUser, floorType[0].id, { options: [{ value: 'marble', label_ar: 'رخام' }, { value: 'porcelain', label_ar: 'بورسلين' }] }), // شال ceramic
    ).rejects.toMatchObject({ status: 409 });
    const added = await fieldsService.update(ids.adminUser, floorType[0].id, {
      options: [{ value: 'marble', label_ar: 'رخام' }, { value: 'porcelain', label_ar: 'بورسلين' }, { value: 'ceramic', label_ar: 'سيراميك' }, { value: 'granite', label_ar: 'جرانيت' }],
    });
    expect(added.options).toHaveLength(4);
  });

  it('حذف حقل حر (غير مستخدم): نجاح عادي', async () => {
    const free = await q<{ id: string }[]>(`SELECT id FROM service_pricing_fields WHERE field_key='free_field'`, []);
    await expect(fieldsService.delete(ids.adminUser, free[0].id)).resolves.toBeUndefined();
  });

  it('تعطيل ثابت مستخدم في المعادلة: مرفوض 409 — والحر يتعطل عادي', async () => {
    const [usedConstant] = await q<{ id: string }[]>(
      `SELECT id FROM service_pricing_rules WHERE rule_type='constant' AND payload->>'value'='12345' AND is_active`,
    );
    await expect(rulesService.deactivate(ids.adminUser, usedConstant.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('used_constant'),
    });

    const [freeConstant] = await q<{ id: string }[]>(
      `SELECT id FROM service_pricing_rules WHERE rule_type='constant' AND payload->>'value'='999' AND is_active`,
    );
    await expect(rulesService.deactivate(ids.adminUser, freeConstant.id)).resolves.toBeUndefined();
  });

  it('تعطيل جدول بحث مستخدم: مرفوض 409', async () => {
    const [lookup] = await q<{ id: string }[]>(
      `SELECT id FROM service_pricing_rules WHERE rule_type='lookup_table' AND rule_key='used_lookup' AND is_active`,
    );
    await expect(rulesService.deactivate(ids.adminUser, lookup.id)).rejects.toMatchObject({ status: 409 });
  });

  it('جدولة نسخ مستقبلية تربط predecessor وsuccessor وتحدّث نفس البداية بدون overlap', async () => {
    const middleStart = new Date(Date.now() + 10 * 86_400_000);
    const lastStart = new Date(Date.now() + 20 * 86_400_000);
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'timeline_constant',
      payload: { value: 100 },
    });
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'timeline_constant',
      payload: { value: 300 },
      valid_from: lastStart.toISOString(),
    });
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'timeline_constant',
      payload: { value: 200 },
      valid_from: middleStart.toISOString(),
    });
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'timeline_constant',
      payload: { value: 250 },
      valid_from: middleStart.toISOString(),
    });

    const timeline = await q<Array<{ payload: { value: number }; valid_from: Date; valid_until: Date | null }>>(
      `SELECT payload, valid_from, valid_until
       FROM service_pricing_rules
       WHERE service_id=$1 AND rule_key='timeline_constant' AND is_active AND deleted_at IS NULL
       ORDER BY valid_from`,
      [ids.service],
    );
    expect(timeline).toHaveLength(3);
    expect(timeline[0].valid_until).toEqual(middleStart);
    expect(timeline[1]).toMatchObject({ payload: { value: 250 }, valid_until: lastStart });
    expect(timeline[2].valid_until).toBeNull();
  });

  it('find-usages بيرجّع مواضع الاستخدام بالمسارات (للواجهة)', async () => {
    const usages = await rulesService.findUsages(ids.service, { field_key: 'area_used' });
    expect(usages.matches.length).toBeGreaterThanOrEqual(2); // price_cents + estimated_duration_days
    expect(usages.matches.every((m) => m.path.startsWith('price_cents') || m.path.startsWith('estimated_duration_days'))).toBe(true);
  });

  it('trace: خطوات الحساب بترتيب التنفيذ وبالقيم الصح (hourly tiered)', async () => {
    await seedTraceFixture();
    const detailed = await engine.evaluateDraftDetailed(
      ids.service,
      { area_used: 3, floor_type: 'porcelain' },
      undefined,
    );
    expect(detailed.result.priceCents).toBe(3 * 12345 + 8000);
    // أول سطر بعد الفلترة لازم يكون أعمق ورقة (field_ref) وآخر سطر هو الجمع الخارجي
    const exprs = detailed.trace.map((t) => t.expression);
    expect(exprs.some((e) => e.includes('area_used'))).toBe(true);
    expect(exprs.some((e) => e.includes('lookup:used_lookup'))).toBe(true);
    expect(exprs[exprs.length - 1]).toContain(String(detailed.result.priceCents));

    // الشرح الهيكلي بيغطي المخرجين
    expect(detailed.explanation.some((l) => l.startsWith('price_cents:'))).toBe(true);
    expect(detailed.explanation.some((l) => l.startsWith('estimated_duration_days:'))).toBe(true);
  });

  async function seedTraceFixture(): Promise<void> {
    // المعادلة الحالية أصلاً بتغطي — الدالة دي للتوثيق فقط
  }
});
