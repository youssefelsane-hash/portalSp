import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { TechnicianLevel, TechnicianPricingTier } from '../technicians/entities/technician-profile.entity';

/**
 * **سلسلة تكوين السعر كاملة، بالترتيب** (طلب مالك 2026-09-19، docs/08 §170).
 *
 * المالك سأل: «إحنا عندنا كام حاجة بتتحكم في السعر بالظبط؟». الإجابة موثّقة هنا **كاختبار**
 * مش كنص، فأي مضاعف يتضاف أو يتشال أو يتغيّر ترتيبه بيكسر السويت دي:
 *
 *   ناتج المعادلة
 *     × (1 + نسبة المنطقة)        ← `service_zone_pricing.modifier_percentage`
 *     × مضاعف الذروة               ← **مثبّت على 1 دلوقتي** (العمود موجود والمحرك مابيقراهوش)
 *     × مضاعف فئة الفني            ← `service_pricing_tier_pricing.price_multiplier`
 *     ثم القصّ على حدود الخدمة
 *     + رسم المعاينة
 *     + رسم الطوارئ (نسبة من المجموع + رسم المعاينة)
 */
describe('CatalogService.estimate() — سلسلة مضاعفات السعر (docs/08 §170)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { country: '', city: '', zone: '', category: '', service: '' };
  const BASE = 100_00;
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData,
        ServicePricingTierPricing, ServicePricingField, ServicePricingRule, ServicePricingEvaluation,
      ],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة مضاعفات ${runId}`, `MultCity ${runId}`, `mult-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city, `نطاق مضاعفات ${runId}`, `MultZone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة مضاعفات ${runId}`, `MultCat ${runId}`, `mult-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [svc] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',$4) RETURNING id`,
      [ids.category, `خدمة مضاعفات ${runId}`, `mult-service-${runId}`, BASE],
    );
    ids.service = svc.id;

    // نسبة المنطقة +٥٠٪، ومعاها مضاعف ذروة ٢× على **الاتنين** (صف التسعير والنطاق نفسه).
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage, surge_multiplier)
       VALUES ($1,$2,'percentage',50,2.00)`,
      [ids.service, ids.zone],
    );
    await q(`UPDATE service_zones SET surge_multiplier = 2.00 WHERE id = $1`, [ids.zone]);

    // الفئات الأربعة (migration 0355) — سلّم صاعد واضح عشان أي خلط في الترتيب يبان.
    for (const [tier, multiplier] of [['beginner', 0.80], ['standard', 1.00], ['advanced', 1.20], ['expert', 1.50]] as const) {
      await q(
        `INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier, is_active) VALUES ($1,$2,$3,true)`,
        [ids.service, tier, multiplier],
      );
    }

    service = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      { getNumber: async (_key: string, fallback: number) => fallback } as never,
      realPricingEngineService(dataSource),
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_pricing_tier_pricing WHERE service_id = $1`, [ids.service]);
    await q(`DELETE FROM service_zone_pricing WHERE service_id = $1`, [ids.service]);
    await q(`DELETE FROM service_pricing_evaluations WHERE service_id = $1`, [ids.service]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('١) نسبة المنطقة بتتطبّق **بس** لما يوصل `zoneId` — وده كان سبب «المنطقة مالهاش تأثير»', async () => {
    // الواجهة اللي بتنسى تبعت المنطقة بتعرض رقم أقل من اللي هيتحصّل فعلاً وقت التأكيد.
    const withoutZone = await service.estimate(ids.service);
    const withZone = await service.estimate(ids.service, ids.zone);
    expect(withoutZone.estimated_total_cents).toBe(BASE);
    expect(withZone.estimated_total_cents).toBe(150_00);
    expect(withZone.zone_surge_cents).toBe(50_00);
    expect(withZone.price_formation.zone_modifier_percentage).toBe(50);
  });

  it('٢) مضاعف الذروة مثبّت على 1 — العمود بيتحفظ وماليهوش أي أثر (فجوة موثّقة)', async () => {
    // ٢× على النطاق و٢× على صف التسعير، والنتيجة نفس الـ١٥٠ بالظبط. أي تفعيل مستقبلي للذروة
    // لازم يكسر الاختبار ده عمدًا ويتكتب معاه قرار «الذروة بتشتغل إمتى».
    const estimate = await service.estimate(ids.service, ids.zone);
    expect(estimate.surge_multiplier).toBe(1);
    expect(estimate.estimated_total_cents).toBe(150_00);
  });

  it('٣) الفئات الأربعة بترتيبها — «متقدم» بين القياسي والخبير (migration 0355)', async () => {
    const priceOf = async (tier: TechnicianPricingTier) =>
      (await service.estimate(ids.service, ids.zone, undefined, false, undefined, tier)).estimated_total_cents;
    const beginner = await priceOf(TechnicianPricingTier.BEGINNER);
    const standard = await priceOf(TechnicianPricingTier.STANDARD);
    const advanced = await priceOf(TechnicianPricingTier.ADVANCED);
    const expert = await priceOf(TechnicianPricingTier.EXPERT);
    expect([beginner, standard, advanced, expert]).toEqual([120_00, 150_00, 180_00, 225_00]);
    expect(beginner).toBeLessThan(standard);
    expect(standard).toBeLessThan(advanced);
    expect(advanced).toBeLessThan(expert);
  });

  it('٤) الرتبة التشغيلية احتياطي بس — الفئة الصريحة بتكسب لما الاتنين يتبعتوا', async () => {
    // الرتبة `new` بتترجم لـ`beginner`، لكن الفئة الصريحة `expert` هي اللي بتتحسب.
    const explicit = await service.estimate(
      ids.service, ids.zone, TechnicianLevel.NEW, false, undefined, TechnicianPricingTier.EXPERT,
    );
    expect(explicit.estimated_total_cents).toBe(225_00);
    expect(explicit.price_formation.pricing_tier).toBe(TechnicianPricingTier.EXPERT);
  });

  it('٥) خريطة الرتبة ← الفئة لما مفيش فئة صريحة (نسخ تطبيق قديمة)', async () => {
    const priceOfLevel = async (level: TechnicianLevel) =>
      (await service.estimate(ids.service, ids.zone, level)).estimated_total_cents;
    expect(await priceOfLevel(TechnicianLevel.NEW)).toBe(120_00);          // مبتدئ
    expect(await priceOfLevel(TechnicianLevel.VERIFIED)).toBe(150_00);      // قياسي
    expect(await priceOfLevel(TechnicianLevel.PROFESSIONAL)).toBe(180_00);  // متقدم (اتغيّرت في 0355)
    expect(await priceOfLevel(TechnicianLevel.PREMIUM)).toBe(225_00);       // خبير
    expect(await priceOfLevel(TechnicianLevel.TEAM_LEADER)).toBe(225_00);   // خبير
  });

  it('٦) معامل الشركة **بديل** عن فئة الفني مش فوقها (ADR-0042)', async () => {
    const company = await service.estimate(
      ids.service, ids.zone, TechnicianLevel.PREMIUM, false, undefined, TechnicianPricingTier.EXPERT,
      undefined, undefined, 1.10,
    );
    expect(company.estimated_total_cents).toBe(165_00); // 150 × 1.10، مش × 1.5 كمان
    expect(company.price_formation.multiplier_source).toBe('company');
  });

  it('٧) رسم الطوارئ بيتحسب **بعد** كل المضاعفات، على المجموع + رسم المعاينة', async () => {
    const emergency = await service.estimate(
      ids.service, ids.zone, undefined, true, undefined, TechnicianPricingTier.EXPERT,
    );
    const base = emergency.estimated_total_cents + emergency.inspection_fee_cents;
    expect(emergency.estimated_total_cents).toBe(225_00);
    expect(emergency.emergency_surcharge_cents).toBeGreaterThan(0);
    expect(emergency.emergency_surcharge_cents).toBeLessThanOrEqual(base);
  });
});
