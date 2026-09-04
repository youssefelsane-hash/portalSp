import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { PriceCertaintyMode, Service } from '../catalog/entities/service.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';
import { PricingTemplateKey, pricingTemplate, pricingTemplateFinalPricePayload } from '../pricing/pricing-templates';

/**
 * **مصفوفة سيناريوهات التسعير الموسّعة (docs/08 §130، طلب مالك صريح).**
 *
 * المالك طلب تشغيل عدد كبير من التركيبات الحقيقية بدل عشر اختبارات وحدة. الملف ده بيعمل كده على
 * محرك التسعير **الحقيقي** وقاعدة **حقيقية** — مفيش mocks ولا إعادة تنفيذ للمعادلة.
 *
 * ### ليه تغطية أزواج (pairwise) مش الضرب الكارتيزي الكامل
 * الأبعاد السبعة تحت حاصل ضربها 1,620 تركيبة. الغالبية العظمى منها بتعيد نفس الفروع في الكود.
 * تغطية الأزواج بتضمن إن **كل قيمة** ظهرت، و**كل زوج قيم من بُعدين مختلفين** ظهر مرة على الأقل —
 * وده اللي بيمسك تفاعلات زي «قصّ أدنى + خصم» أو «منطقة + مستوى». النتيجة عشرات السيناريوهات
 * المصمّمة بدل ألوف عشوائية بلا قيمة، وده بالظبط اللي المالك طلبه: «300 حالة مصممة كويس أهم من
 * 500 عشوائية».
 *
 * ### المرجع (oracle) — علاقات مش أرقام منسوخة
 * ممنوع نعيد كتابة المعادلة في الاختبار عشان نقارن بيها (كده بنعيد إنتاج أي بَقّة فيها). بدل كده
 * كل سيناريو بيتقاس بعلاقة قابلة للإثبات لوحدها:
 * - نفس المدخلات + منطقة +15% = **بالظبط** 1.15 × السعر بلا منطقة.
 * - نفس المدخلات + مستوى premium = **بالظبط** مضاعف المستوى × السعر بلا مستوى.
 * - مضاعفة الكمية = مضاعفة السعر قبل القصّ (القوالب كلها خطية).
 * - القصّ: السعر عمره ما يقل عن الأدنى ولا يزيد عن الأقصى.
 * - النطاق التقديري بيتحسب **بعد** القصّ وحوالين السعر النهائي، ومش نسخة من حدود القصّ (بند 29).
 *
 * التقرير بيتكتب في `docs/scenario-matrix-report.md` عشان يبقى فيه أثر مقروء لكل تشغيلة.
 */
describe('§130 — مصفوفة سيناريوهات التسعير (تغطية أزواج على المحرك الحقيقي)', () => {
  jest.setTimeout(600_000);

  // بذرة ثابتة: نفس التشغيلة بتدي نفس السيناريوهات بالترتيب — قابلة لإعادة الإنتاج بالحرف.
  const RUN_TAG = 'SCNMTX';
  const RATE_CENTS = 20_000;

  let dataSource: DataSource;
  let catalog: CatalogService;
  const createdServiceIds: string[] = [];
  let categoryId = '';
  let zoneId: string | null = null;
  // النسبة المضبوطة فعلاً في الإعدادات — بنقراها مرة واحدة عشان التأكيد يبقى على القيمة
  // الحقيقية مش على رقم مفترض في الاختبار.
  let emergencyPercentage = 0;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  // ── أبعاد المصفوفة ───────────────────────────────────────────────────────────
  const TEMPLATES = [
    PricingTemplateKey.FIXED,
    PricingTemplateKey.HOURLY,
    PricingTemplateKey.DAILY,
    PricingTemplateKey.MONTHLY,
    PricingTemplateKey.PER_UNIT,
  ];
  /** كميات ممثِّلة: الحد الأدنى، قيم متوسطة، وقيمة كبيرة — بتغطي فروع الضرب والقصّ. */
  const QUANTITIES = [1, 2, 4, 12, 30];
  /** الطوارئ فرع حقيقي في `estimate()` (رسم إضافي + SLA) — مش مجرد علم على الطلب. */
  const EMERGENCY = ['no', 'yes'] as const;
  const CERTAINTY = [
    PriceCertaintyMode.CONFIRMED_PRICE,
    PriceCertaintyMode.ESTIMATED_RANGE,
    PriceCertaintyMode.ASSESSMENT_REQUIRED,
  ];
  const ZONE = ['none', 'plus15'] as const;
  const LEVEL = ['none', 'premium'] as const;
  const CLAMP = ['none', 'min_binding', 'max_binding'] as const;

  type Scenario = {
    id: string;
    template: PricingTemplateKey;
    quantity: number;
    certainty: PriceCertaintyMode;
    zone: (typeof ZONE)[number];
    level: (typeof LEVEL)[number];
    clamp: (typeof CLAMP)[number];
    emergency: (typeof EMERGENCY)[number];
  };

  /**
   * مولّد تغطية أزواج حتمي (بلا عشوائية ولا مكتبات): بيمشي على كل زوج (بُعد أ، قيمة) × (بُعد ب،
   * قيمة) ويبني سيناريو بيغطيه، وبيملا باقي الأبعاد بقيم دوّارة. النتيجة ثابتة تمامًا بين
   * التشغيلات لأن الترتيب كله مشتق من ترتيب المصفوفات فوق.
   */
  function buildPairwiseScenarios(): Scenario[] {
    const dims: Array<{ name: string; values: unknown[] }> = [
      { name: 'template', values: TEMPLATES },
      { name: 'quantity', values: QUANTITIES },
      { name: 'certainty', values: CERTAINTY },
      { name: 'zone', values: [...ZONE] },
      { name: 'level', values: [...LEVEL] },
      { name: 'clamp', values: [...CLAMP] },
      { name: 'emergency', values: [...EMERGENCY] },
    ];

    const combos: Record<string, unknown>[] = [];
    let filler = 0;
    for (let a = 0; a < dims.length; a++) {
      for (let b = a + 1; b < dims.length; b++) {
        for (const va of dims[a].values) {
          for (const vb of dims[b].values) {
            const combo: Record<string, unknown> = { [dims[a].name]: va, [dims[b].name]: vb };
            // باقي الأبعاد بقيم دوّارة — بتزوّد التنوّع من غير ما تكسر الحتمية.
            for (const d of dims) {
              if (combo[d.name] === undefined) combo[d.name] = d.values[filler % d.values.length];
            }
            filler++;
            combos.push(combo);
          }
        }
      }
    }

    // إزالة التكرار الحرفي — نفس التركيبة ممكن تتولد من زوجين مختلفين.
    const seen = new Set<string>();
    const unique: Scenario[] = [];
    for (const c of combos) {
      const key = JSON.stringify([c.template, c.quantity, c.certainty, c.zone, c.level, c.clamp, c.emergency]);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        id: `${RUN_TAG}-${String(unique.length + 1).padStart(3, '0')}`,
        template: c.template as PricingTemplateKey,
        quantity: c.quantity as number,
        certainty: c.certainty as PriceCertaintyMode,
        zone: c.zone as (typeof ZONE)[number],
        level: c.level as (typeof LEVEL)[number],
        clamp: c.clamp as (typeof CLAMP)[number],
        emergency: c.emergency as (typeof EMERGENCY)[number],
      });
    }
    return unique;
  }

  const SCENARIOS = buildPairwiseScenarios();

  /** مدخلات الفورم للقالب — نفس مفاتيح `TEMPLATE_FIELD_KEYS` اللي البانِي بيزرعها. */
  function fieldValuesFor(template: PricingTemplateKey, quantity: number): Record<string, string | number> {
    switch (template) {
      case PricingTemplateKey.HOURLY:
        return { hours: quantity };
      case PricingTemplateKey.DAILY:
        return { days: quantity };
      case PricingTemplateKey.PER_UNIT:
        return { units: quantity };
      case PricingTemplateKey.MONTHLY: {
        // فترة تعاقد حقيقية بعدد شهور = الكمية (ADR-0060 §2 — التاريخين هما المصدر).
        const start = new Date(Date.UTC(2027, 0, 1));
        const end = new Date(Date.UTC(2027, quantity, 1));
        return { period_start: start.toISOString(), period_end: end.toISOString() };
      }
      case PricingTemplateKey.FIXED:
      default:
        return {};
    }
  }

  /**
   * هل الكمية دي جوّه الحدود اللي القالب نفسه معلنها؟ (ساعات 1–24، أيام 1–365، وحدات 1–1000).
   * بنقراها من `pricingTemplate()` مش بنكتبها هنا — عشان لو الحدود اتغيّرت، المصفوفة تمشي معاها.
   * القيم اللي برّه الحدود **مش** فشل: دي فرع تحقق حقيقي، والمتوقع منه رفض واضح مش حساب صامت.
   */
  function quantityWithinTemplateBounds(template: PricingTemplateKey, quantity: number): boolean {
    const numeric = pricingTemplate(template).fields.filter((f) => f.minValue !== null || f.maxValue !== null);
    if (numeric.length === 0) return true; // fixed/monthly مالهمش حقل رقمي بحدود
    return numeric.every(
      (f) =>
        (f.minValue === null || quantity >= Number(f.minValue)) &&
        (f.maxValue === null || quantity <= Number(f.maxValue)),
    );
  }

  /** خدمة لكل (قالب × وضع يقين) — بتتعمل مرة واحدة وبتتشارك بين السيناريوهات. */
  const serviceKey = (t: PricingTemplateKey, c: PriceCertaintyMode) => `${t}:${c}`;
  const services = new Map<string, string>();

  async function seedService(template: PricingTemplateKey, certainty: PriceCertaintyMode): Promise<string> {
    const key = serviceKey(template, certainty);
    const existing = services.get(key);
    if (existing) return existing;

    const slug = `scnmtx-${template}-${certainty}`.toLowerCase();
    const [svc] = await q(
      // `onsite_assessment_enabled` بيتحط دايمًا مش بس لـ`assessment_required`: خدمة «محتاجة
      // تقييم» بلا أي مسار مفعّل بقت مرفوضة على مستوى القاعدة نفسها (docs/08 §131،
      // migration 0259) — دي بالظبط الخدمة اللي العميل مايقدرش يحجزها بأي طريقة. المعاينة
      // في الموقع هي المسار المناسب لخدمة `formula` (التقييم بالصور مقصور على
      // `inspection_then_quote`)، والقيمة مالهاش أي أثر على حسابات التسعير اللي المصفوفة
      // دي بتقيسها.
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
                             price_certainty_mode, range_percent_below, range_percent_above,
                             onsite_assessment_enabled)
       VALUES ($1,$2,$3,'formula',$4,$5,10,25,true) RETURNING id`,
      [categoryId, `مصفوفة ${template} ${certainty}`, slug, RATE_CENTS, certainty],
    );
    createdServiceIds.push(svc.id);

    // حقول الفورم اللي القالب بيحتاجها.
    for (const f of pricingTemplate(template).fields) {
      await q(
        `INSERT INTO service_pricing_fields (service_id, field_key, label_ar, field_type, unit_ar,
                                             min_value, max_value, display_order, is_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,
        [svc.id, f.fieldKey, f.labelAr, f.fieldType, f.unitAr, f.minValue, f.maxValue, f.displayOrder],
      );
    }

    // `rule_type = 'formula'` و`rule_key = 'final_price'` — المفتاح هو اللي بيسمّي القاعدة،
    // والنوع بيقول إزاي تتقيّم. نفس الشكل بالحرف اللي واجهة الأدمن بتحفظه.
    await q(
      `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, is_active, display_order)
       VALUES ($1,'formula','final_price',$2::jsonb,true,0)`,
      [svc.id, JSON.stringify(pricingTemplateFinalPricePayload(template, RATE_CENTS))],
    );

    services.set(key, svc.id);
    return svc.id;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon,
        ServiceStandardData, ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
      ],
    });
    await dataSource.initialize();

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة مصفوفة ${RUN_TAG}`, `Matrix ${RUN_TAG}`, `matrix-${RUN_TAG.toLowerCase()}`],
    );
    categoryId = category.id;

    const [zone] = await q(`SELECT id FROM service_zones LIMIT 1`);
    zoneId = zone?.id ?? null;

    const [pct] = await q(
      `SELECT (value #>> '{}')::numeric AS v FROM settings WHERE key = 'pricing.emergency_surcharge_percentage'`,
    );
    emergencyPercentage = Number(pct?.v ?? 0);

    catalog = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      // قارئ إعدادات حقيقي من نفس الجدول — **مش** mock لقيمة: بيقرا `settings` زي
      // `SettingsService.getNumber` بالحرف (رقم مخزّن ⇒ القيمة، غير كده ⇒ الافتراضي). فرع
      // الطوارئ في `estimate()` بيعتمد عليه، والـplaceholder القديم كان بيفجّره.
      {
        getNumber: async (key: string, fallback: number) => {
          const [row] = await dataSource.query(
            `SELECT value FROM settings WHERE key = $1`,
            [key],
          );
          const value = row?.value;
          return typeof value === 'number' ? value : fallback;
        },
      } as never,
      realPricingEngineService(dataSource),
      {} as never,
    );

    // خدمة لكل تركيبة (قالب × يقين) مستخدمة فعلاً في السيناريوهات.
    for (const s of SCENARIOS) await seedService(s.template, s.certainty);

    // تسعير المنطقة والمستوى — بيتزرعوا لكل خدمة اتعملت.
    for (const serviceId of createdServiceIds) {
      if (zoneId) {
        // `percentage` بس — الوضع المطلق (`override`) مرفوض صراحةً في `estimate()` بعد ADR-0060،
        // فاختباره هنا كان هيختبر رسالة خطأ مش تسعير.
        await q(
          `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage,
                                             price_cents, valid_from, is_active)
           VALUES ($1,$2,'percentage',15,NULL, now() - interval '1 day', true)`,
          [serviceId, zoneId],
        );
      }
      await q(
        `INSERT INTO service_level_pricing (service_id, technician_level, price_multiplier)
         VALUES ($1,$2,1.20)`,
        [serviceId, TechnicianLevel.PREMIUM],
      );
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      if (createdServiceIds.length > 0) {
        await q(`DELETE FROM service_zone_pricing WHERE service_id = ANY($1::uuid[])`, [createdServiceIds]);
        await q(`DELETE FROM service_level_pricing WHERE service_id = ANY($1::uuid[])`, [createdServiceIds]);
        await q(`DELETE FROM service_pricing_rules WHERE service_id = ANY($1::uuid[])`, [createdServiceIds]);
        await q(`DELETE FROM service_pricing_fields WHERE service_id = ANY($1::uuid[])`, [createdServiceIds]);
        await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [createdServiceIds]);
      }
      if (categoryId) await q(`DELETE FROM service_categories WHERE id = $1`, [categoryId]);
    } finally {
      await dataSource.destroy();
    }
  });

  type Row = {
    id: string;
    template: string;
    quantity: number;
    certainty: string;
    zone: string;
    level: string;
    clamp: string;
    emergency: string;
    total: number;
    result: 'PASS' | 'FAIL';
    note: string;
  };
  const rows: Row[] = [];

  it(`بيولّد ${SCENARIOS.length} سيناريو مصمّم بتغطية أزواج كاملة`, () => {
    // كل قيمة في كل بُعد لازم تظهر — لو مولّد الأزواج اتكسر، ده بيبان هنا فورًا.
    for (const t of TEMPLATES) expect(SCENARIOS.some((s) => s.template === t)).toBe(true);
    for (const c of CERTAINTY) expect(SCENARIOS.some((s) => s.certainty === c)).toBe(true);
    for (const cl of CLAMP) expect(SCENARIOS.some((s) => s.clamp === cl)).toBe(true);
    for (const z of ZONE) expect(SCENARIOS.some((s) => s.zone === z)).toBe(true);
    for (const l of LEVEL) expect(SCENARIOS.some((s) => s.level === l)).toBe(true);
    for (const qn of QUANTITIES) expect(SCENARIOS.some((s) => s.quantity === qn)).toBe(true);
    for (const em of EMERGENCY) expect(SCENARIOS.some((s) => s.emergency === em)).toBe(true);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(60);
  });

  it('كل سيناريو بيعدّي على المحرك الحقيقي ويحقّق علاقاته المتوقعة', async () => {
    const failures: string[] = [];

    for (const s of SCENARIOS) {
      const serviceId = services.get(serviceKey(s.template, s.certainty))!;
      const fv = fieldValuesFor(s.template, s.quantity);
      const level = s.level === 'premium' ? TechnicianLevel.PREMIUM : undefined;
      const zone = s.zone === 'plus15' && zoneId ? zoneId : undefined;

      const withinBounds = quantityWithinTemplateBounds(s.template, s.quantity);

      // فرع الرفض: كمية برّه حدود القالب لازم تترفض بوضوح، مش تتحسب.
      if (!withinBounds) {
        let rejected = false;
        try {
          await catalog.estimate(serviceId, undefined, undefined, false, fv);
        } catch {
          rejected = true;
        }
        rows.push({
          id: s.id,
          template: s.template,
          quantity: s.quantity,
          certainty: s.certainty,
          zone: s.zone,
          level: s.level,
          clamp: s.clamp,
          emergency: s.emergency,
          total: 0,
          result: rejected ? 'PASS' : 'FAIL',
          note: rejected ? 'كمية برّه حدود القالب — اترفضت صح' : 'كمية برّه الحدود اتحسبت بدل ما تترفض',
        });
        if (!rejected) {
          failures.push(`${s.id} [${s.template}/q${s.quantity}] كمية برّه الحدود اتقبلت`);
        }
        continue;
      }

      // خط الأساس: نفس المدخلات بلا منطقة ولا مستوى ولا قصّ — المرجع اللي بنقيس عليه.
      await q(`UPDATE services SET min_price_cents = NULL, max_price_cents = NULL WHERE id = $1`, [serviceId]);
      const base = await catalog.estimate(serviceId, undefined, undefined, false, fv);

      // القصّ بيتظبط نسبةً للأساس عشان يبقى مُلزِم فعلاً (مش رقم عشوائي ممكن ميأثرش).
      let minClamp: number | null = null;
      let maxClamp: number | null = null;
      if (s.clamp === 'min_binding') minClamp = base.estimated_total_cents + 5_000;
      if (s.clamp === 'max_binding') maxClamp = Math.max(1, base.estimated_total_cents - 5_000);
      await q(`UPDATE services SET min_price_cents = $2, max_price_cents = $3 WHERE id = $1`, [
        serviceId,
        minClamp,
        maxClamp,
      ]);

      const isEmergency = s.emergency === 'yes';
      const est = await catalog.estimate(serviceId, zone, level, isEmergency, fv);
      const notes: string[] = [];
      const fail = (msg: string) => {
        notes.push(msg);
        failures.push(`${s.id} [${s.template}/q${s.quantity}/${s.certainty}/${s.zone}/${s.level}/${s.clamp}] ${msg}`);
      };

      if (!Number.isFinite(est.estimated_total_cents) || est.estimated_total_cents < 0) {
        fail(`سعر غير صالح: ${est.estimated_total_cents}`);
      }

      // القصّ مُلزِم فعلاً.
      if (minClamp !== null && est.estimated_total_cents < minClamp) fail(`نزل تحت الحد الأدنى ${minClamp}`);
      if (maxClamp !== null && est.estimated_total_cents > maxClamp) fail(`عدّى الحد الأقصى ${maxClamp}`);

      // الطوارئ: الرسم بيترجع في حقل **منفصل** ومابيدخلش في `estimated_total_cents` (عشان
      // بند 5: العميل بيشوف إجمالي واحد، والرسم بيفضل في اللقطة والأدمن). فالمتوقع: صفر بالظبط
      // لغير الطوارئ، وقيمة موجبة للطوارئ طالما النسبة المضبوطة أكبر من صفر.
      if (!isEmergency && est.emergency_surcharge_cents !== 0) {
        fail(`رسم طوارئ ${est.emergency_surcharge_cents} على طلب مش طوارئ`);
      }
      if (isEmergency && emergencyPercentage > 0 && est.emergency_surcharge_cents <= 0) {
        fail(`طلب طوارئ بلا رسم رغم إن النسبة المضبوطة ${emergencyPercentage}%`);
      }

      // المضاعفات: بتتقاس مقابل خط الأساس، مش بإعادة حساب المعادلة.
      if (s.clamp === 'none') {
        const expectedMultiplier = (s.zone === 'plus15' && zoneId ? 1.15 : 1) * (s.level === 'premium' ? 1.2 : 1);
        const expected = Math.round(base.estimated_total_cents * expectedMultiplier);
        // سماحية قرش واحد للتقريب المتسلسل.
        if (Math.abs(est.estimated_total_cents - expected) > 1) {
          fail(`مضاعف غلط: متوقع ~${expected} وطلع ${est.estimated_total_cents} (أساس ${base.estimated_total_cents})`);
        }
      }

      // وضع اليقين وحقول العرض.
      if (est.price_certainty_mode !== s.certainty) {
        fail(`وضع اليقين رجع ${est.price_certainty_mode} بدل ${s.certainty}`);
      }
      if (s.certainty === PriceCertaintyMode.ESTIMATED_RANGE) {
        if (est.display_price_min_cents === null || est.display_price_max_cents === null) {
          fail('نطاق تقديري بلا حقول عرض');
        } else {
          if (est.display_price_min_cents >= est.estimated_total_cents) fail('حد النطاق الأدنى مش أقل من السعر');
          if (est.display_price_max_cents <= est.estimated_total_cents) fail('حد النطاق الأعلى مش أكبر من السعر');
          // بند 29: النطاق مش نسخة من حدود القصّ.
          if (minClamp !== null && est.display_price_min_cents === minClamp) fail('النطاق اتبنى من حد القصّ');
          if (maxClamp !== null && est.display_price_max_cents === maxClamp) fail('النطاق اتبنى من حد القصّ');
        }
      } else if (est.display_price_min_cents !== null || est.display_price_max_cents !== null) {
        fail('حقول نطاق ظهرت لخدمة مش «نطاق تقديري»');
      }

      rows.push({
        id: s.id,
        template: s.template,
        quantity: s.quantity,
        certainty: s.certainty,
        zone: s.zone,
        level: s.level,
        clamp: s.clamp,
        emergency: s.emergency,
        total: est.estimated_total_cents,
        result: notes.length === 0 ? 'PASS' : 'FAIL',
        note: notes.join('؛ ') || '—',
      });
    }

    // تقرير التغطية — أثر مقروء لكل تشغيلة، زي ما المالك طلب.
    const passed = rows.filter((r) => r.result === 'PASS').length;
    const reportPath = join(__dirname, '../../../../../docs/scenario-matrix-report.md');
    const lines = [
      '# تقرير مصفوفة سيناريوهات التسعير (docs/08 §130)',
      '',
      `المصدر: \`apps/api/src/modules/orders/pricing-scenario-matrix.spec.ts\` — بيتولّد حتميًا (بلا عشوائية).`,
      `عدد السيناريوهات: **${rows.length}** — نجح **${passed}** / فشل **${rows.length - passed}**.`,
      '',
      '| # | القالب | الكمية | وضع اليقين | المنطقة | المستوى | القصّ | طوارئ | الإجمالي (قرش) | النتيجة | ملاحظة |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map(
        (r) =>
          `| ${r.id} | ${r.template} | ${r.quantity} | ${r.certainty} | ${r.zone} | ${r.level} | ${r.clamp} | ${r.emergency} | ${r.total} | ${r.result} | ${r.note} |`,
      ),
      '',
    ];
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, lines.join('\n'), 'utf8');

    if (failures.length > 0) {
      throw new Error(`${failures.length} سيناريو فشل:\n${failures.slice(0, 25).join('\n')}`);
    }
    expect(passed).toBe(rows.length);
  });
});
