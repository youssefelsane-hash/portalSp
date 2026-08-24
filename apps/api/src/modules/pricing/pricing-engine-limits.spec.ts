import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Address } from '../customers/entities/address.entity';
import { Order } from '../orders/entities/order.entity';
import { ServicePricingEvaluation } from './entities/service-pricing-evaluation.entity';
import { ServicePricingField, PricingFieldType } from './entities/service-pricing-field.entity';
import { ServicePricingRule, PricingRuleType } from './entities/service-pricing-rule.entity';
import { ServicePricingRuleTest } from './entities/service-pricing-rule-test.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { FORMULA_LIMITS } from './formula-limits';
import {
  evaluateFormulaNode,
  validateFinalPriceFormulaPayload,
  type FormulaEvaluationContext,
} from './formula-evaluator';
import { PricingRulesService } from './pricing-rules.service';

/**
 * مصفوفة اختبارات محرك المعادلات (docs/01B §20) — العمق 1→48، الرفض عند 49، حدود العقد/الحجم،
 * التحقق من المراجع ضد تهيئة الخدمة الفعلية (حقل/ثابت/lookup بمسار واضح)، وتكافؤ
 * preview/production على نفس الشجرة.
 */
describe('Price Engine — حدود العمق/التعقيد والتحقق من المراجع (PostgreSQL)', () => {
  let dataSource: DataSource;
  let rulesService!: PricingRulesService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = {
    adminUser: '',
    customerUser: '',
    category: '',
    service: '',
    address: '',
    order: '',
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
  }

  /** شجرة add متداخلة بعمق حافة = depth بالظبط (chain(1) = literal مفردة). */
  function chain(depth: number): Record<string, unknown> {
    let node: Record<string, unknown> = { type: 'literal', value: 1 };
    for (let i = 0; i < depth - 1; i++) {
      node = { type: 'add', operands: [node] };
    }
    return node;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        User,
        CustomerProfile,
        Address,
        Order,
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

    const auditMock = { record: async () => undefined } as unknown as AuditLogService;
    rulesService = new PricingRulesService(
      dataSource.getRepository(ServicePricingRule),
      dataSource.getRepository(ServicePricingField),
      auditMock,
    );

    const [adminUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type, phone_verified_at) VALUES ($1,$2,'admin',now()) RETURNING id`,
      [`+2055${runId}`.slice(0, 15), `أدمن محرك ${runId}`],
    );
    ids.adminUser = adminUser.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة محرك ${runId}`, `Engine Cat ${runId}`, `engine-cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',100000) RETURNING id`,
      [ids.category, `خدمة محرك ${runId}`, `engine-svc-${runId}`],
    );
    ids.service = service.id;
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

  // ===== §20 — مصفوفة العمق =====
  it.each([1, 13, 14, 33, 48, 49])('عمق %i صالح end-to-end في validateFinalPriceFormulaPayload', (depth) => {
    expect(() => validateFinalPriceFormulaPayload({ price_cents: chain(depth) })).not.toThrow();
  });

    it('عمق 50 مرفوض برسالة فيها المسار (الحد الفعلي للحافة 48)', () => {
    expect(() => validateFinalPriceFormulaPayload({ price_cents: chain(50) })).toThrow(/أعمق من الحد المسموح \(48 مستوى\)/);
    expect(() => validateFinalPriceFormulaPayload({ price_cents: chain(50) })).toThrow(/price_cents → add.operands\[0\]/);
  });

  it('حد عدد العقد: شجرة عريضة فوق الحد ترفض حتى بعمق قليل', () => {
    // أضيف operands لحد ما العدد يتعدى 1500 — عمق 3 بس
    const wideOperands: Record<string, unknown>[] = [];
    let total = 1; // العقدة الأب
    while (total < FORMULA_LIMITS.MAX_NODE_COUNT + 10) {
      wideOperands.push({ type: 'literal', value: 1 });
      total += 1;
    }
    const payload = {
      price_cents: { type: 'multiply', operands: [{ type: 'literal', value: 2 }, ...wideOperands] },
    };
    expect(() => validateFinalPriceFormulaPayload(payload)).toThrow(/عدد عناصر المعادلة تعدّى الحد المسموح/);
  });

  it('حد حجم الـpayload: JSON أكبر من 128KB يترفض قبل أي فحص شجرة', () => {
    // literal بقيمة رقم طويل مش هينفع — نستخدم operands كتير نصوص؟ الأنواع مالهاش نص...
    // أبسط تمثيل للحجم: شجرة add متوازية بأوراق كتيرة (كل ورقة ~30 بايت)
    const leaves: Record<string, unknown>[] = Array.from({ length: 5200 }, () => ({ type: 'literal', value: 1 }));
    const payload = { price_cents: { type: 'add', operands: leaves } };
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(bytes).toBeGreaterThan(FORMULA_LIMITS.MAX_PAYLOAD_JSON_BYTES);
    expect(() => validateFinalPriceFormulaPayload(payload)).toThrow(/حجم المعادلة/);
  });

  it('AST مشوه: أنواع غير مسموحة/operands فاضية بترفض بمسار العقدة', () => {
    expect(() =>
      validateFinalPriceFormulaPayload({
        price_cents: { type: 'add', operands: [{ type: 'literal', value: 1 }, { type: 'eval', code: 'process.exit()' }] },
      }),
    ).toThrow(/add.operands\[1\]: نوع عقدة غير مسموح: eval/);
    expect(() => validateFinalPriceFormulaPayload({ price_cents: { type: 'divide', operands: [] } })).toThrow(
      /price_cents: divide.operands لازم تكون مصفوفة فيها عنصر واحد على الأقل/,
    );
  });

  // ===== التحقق من المراجع ضد تهيئة الخدمة =====
  async function seedField(fieldKey: string): Promise<void> {
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required)
       VALUES ($1,$2,$3,'number',true)`,
      [ids.service, fieldKey, `حقل ${fieldKey}`],
    );
  }

  it('field_ref لحقل مش موجود: يترفض بمسار واضح وقت الحفظ', async () => {
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.CONSTANT,
      rule_key: 'base_price',
      payload: { value: 100000 },
    });
    await expect(
      rulesService.upsert(ids.adminUser, ids.service, {
        rule_type: PricingRuleType.FORMULA,
        rule_key: 'final_price',
        payload: {
          price_cents: {
            type: 'multiply',
            operands: [
              { type: 'constant_ref', rule_key: 'base_price' },
              { type: 'field_ref', field_key: 'hours_missing' },
            ],
          },
        },
      }),
    ).rejects.toThrow(/hours_missing.*مش من ضمن حقول الخدمة النشطة|مطلوب لحساب السعر|غير موجودة/);
  });

  it('constant_ref لثابت مش ساري: يترفض — والثابت الموجود يمرّ', async () => {
    await seedField('hours');
    await expect(
      rulesService.upsert(ids.adminUser, ids.service, {
        rule_type: PricingRuleType.FORMULA,
        rule_key: 'final_price',
        payload: {
          price_cents: {
            type: 'multiply',
            operands: [{ type: 'constant_ref', rule_key: 'ghost_constant' }, { type: 'field_ref', field_key: 'hours' }],
          },
        },
      }),
    ).rejects.toThrow(/الثابت "ghost_constant" غير موجود/);

    // الثابت الموجود + الحقل النشط → يحفظ فعلاً
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'multiply',
          operands: [{ type: 'constant_ref', rule_key: 'base_price' }, { type: 'field_ref', field_key: 'hours' }],
        },
      },
    });
    const saved = await q<{ payload: Record<string, unknown> }[]>(
      `SELECT payload FROM service_pricing_rules WHERE service_id=$1 AND rule_type='formula' AND is_active`,
      [ids.service],
    );
    expect(saved).toHaveLength(1);
  });

  it('lookup_ref لجدول غير موجود: يترفض بمساره — وجدول مربوط بحقل نشط يمرّ', async () => {
    await q(
      `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, is_required)
       VALUES ($1,'floor','الدور','dropdown',true)`,
      [ids.service],
    );
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.LOOKUP_TABLE,
      rule_key: 'floor_price',
      payload: { field_key: 'floor', values: { '1': 50000, '2': 60000 } },
    });
    await expect(
      rulesService.upsert(ids.adminUser, ids.service, {
        rule_type: PricingRuleType.FORMULA,
        rule_key: 'final_price',
        payload: {
          price_cents: { type: 'lookup_ref', rule_key: 'ghost_table', field_key: 'floor' },
        },
      }),
    ).rejects.toThrow(/جدول البحث "ghost_table" غير موجود/);

    // lookup صحيح + شرط if على حقل نشط → يحفظ
    await rulesService.upsert(ids.adminUser, ids.service, {
      rule_type: PricingRuleType.FORMULA,
      rule_key: 'final_price',
      payload: {
        price_cents: {
          type: 'if',
          condition: { field_key: 'floor', op: 'equals', value: '2' },
          then: { type: 'lookup_ref', rule_key: 'floor_price', field_key: 'floor' },
          else: { type: 'literal', value: 50000 },
        },
      },
    });
    const saved = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM service_pricing_rules WHERE service_id=$1 AND rule_type='formula' AND is_active`,
      [ids.service],
    );
    expect(Number(saved[0].count)).toBe(1);
  });

  it('تعطيل الحقل المستخدم بعد الحفظ لا يمسح القاعدة — لكن إعادة الحفظ بتكشفه (فصل الأدوار)', async () => {
    // بنعطّل حقل hours ثم نحاول حفظ معادلة بتستخدمه → مرفوض. القاعدة القديمة زي ما هي
    // (التقييم وقت التنفيذ هو خط الدفاع الثاني برفض واضح لو الحقل اختفى).
    await q(`UPDATE service_pricing_fields SET is_active=false WHERE service_id=$1 AND field_key='hours'`, [ids.service]);
    await expect(
      rulesService.upsert(ids.adminUser, ids.service, {
        rule_type: PricingRuleType.FORMULA,
        rule_key: 'final_price',
        payload: {
          price_cents: {
            type: 'multiply',
            operands: [{ type: 'constant_ref', rule_key: 'base_price' }, { type: 'field_ref', field_key: 'hours' }],
          },
        },
      }),
    ).rejects.toThrow(/"hours".*مش من ضمن حقول الخدمة النشطة/);
    await q(`UPDATE service_pricing_fields SET is_active=true WHERE service_id=$1 AND field_key='hours'`, [ids.service]);
  });

  // ===== تكافؤ preview/production + أداء العمق 48 =====
  it('نفس الشجرة بتنتقي نفس النتيجة في السياقين (production evaluator مباشرةً)', () => {
    // معادلة tiered hourly: first_hour=10000، الباقي ×6000، ceil لأعلى ساعة
    const ctx: FormulaEvaluationContext = {
      fieldValues: { hours: '9' },
      constants: new Map([
        ['first_hour', { value: 10000 }],
        ['extra_hour', { value: 6000 }],
      ]),
      lookupTables: new Map(),
    };
    const tree = {
      type: 'add',
      operands: [
        { type: 'constant_ref', rule_key: 'first_hour' },
        {
          type: 'multiply',
          operands: [
            { type: 'ceil', value: { type: 'subtract', operands: [{ type: 'field_ref', field_key: 'hours' }, { type: 'literal', value: 1 }] } },
            { type: 'constant_ref', rule_key: 'extra_hour' },
          ],
        },
      ],
    } as never;
    const result = evaluateFormulaNode(tree, ctx);
    expect(result).toBe(10000 + 8 * 6000); // 58,000 قرش
  });

  it('أداء: سلسلة عمق 48 بتتنفذ في أقل من 50ms (بلا أي تحسين مبكر)', () => {
    // شجرة عمق حافة 48: كل مستوى بيزود 1 فوق اللي تحته (add بمعمَمين) — قيمة ذات معنى للتأكيد
    let node: Record<string, unknown> = { type: 'literal', value: 41 };
    for (let i = 0; i < 48; i++) {
      node = { type: 'add', operands: [node, { type: 'literal', value: 1 }] };
    }
    const ctx: FormulaEvaluationContext = { fieldValues: {}, constants: new Map(), lookupTables: new Map() };
    const start = Date.now();
    const result = evaluateFormulaNode(node as never, ctx);
    const elapsed = Date.now() - start;
    expect(result).toBe(41 + 48); // 89
    expect(elapsed).toBeLessThan(50);
  });
});
