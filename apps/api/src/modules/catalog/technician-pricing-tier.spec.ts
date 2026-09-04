import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { Service } from './entities/service.entity';
import { CatalogService } from './catalog.service';
import { TechnicianLevel, TechnicianPricingTier } from '../technicians/entities/technician-profile.entity';

// فئة تسعير الفني (docs/08 §36.24، ADR-0025) — اختبار حي ضد Postgres حقيقي. تسعير-الفئة لازم
// يغلب تسعير-المستوى القديم لو نشط، وخدمة من غير أي صف فئة لازم تفضل تستخدم تسعير المستوى
// (رجريشن كامل)، وتغيير فئة الفني منفصل تمامًا عن مستواه التشغيلي.
describe('CatalogService.estimate() — فئة تسعير الفني (docs/08 §36.24، ADR-0025)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { category: '', zone: '', city: '', country: '', tierService: '', levelOnlyService: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData, ServicePricingTierPricing, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country?.id ?? (await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة فئة ${runId}`, `Tier Country ${runId}`, Math.random().toString(36).slice(2, 4).toUpperCase(), '+000', 'EGP'],
    ))[0].id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة فئة ${runId}`, `Tier City ${runId}`, `tier-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق فئة ${runId}`,
      `Tier Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة خدمة فئة ${runId}`,
      `Tier Category ${runId}`,
      `tier-category-${runId}`,
    ]);
    ids.category = category.id;

    // خدمة عندها الاتنين: تسعير مستوى قديم (professional=1.2) وتسعير فئة جديد (premium=1.5) — لازم
    // الفئة الجديدة تغلب.
    const [tierService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة فئة ${runId}`, `tier-service-${runId}`],
    );
    ids.tierService = tierService.id;
    await q(
      `INSERT INTO service_level_pricing (service_id, technician_level, price_multiplier) VALUES ($1,'professional',1.2)`,
      [ids.tierService],
    );
    await q(
      `INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier) VALUES ($1,'premium',1.5)`,
      [ids.tierService],
    );

    // خدمة من غير أي صف فئة خالص — لازم تفضل تستخدم تسعير المستوى القديم بالحرف (رجريشن).
    const [levelOnlyService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة مستوى بس ${runId}`, `level-only-service-${runId}`],
    );
    ids.levelOnlyService = levelOnlyService.id;
    await q(
      `INSERT INTO service_level_pricing (service_id, technician_level, price_multiplier) VALUES ($1,'professional',1.2)`,
      [ids.levelOnlyService],
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
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_pricing_tier_pricing WHERE service_id = ANY($1::uuid[])`, [[ids.tierService, ids.levelOnlyService]]);
    await q(`DELETE FROM service_level_pricing WHERE service_id = ANY($1::uuid[])`, [[ids.tierService, ids.levelOnlyService]]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.tierService, ids.levelOnlyService]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('تسعير الفئة (premium=1.5) بيغلب تسعير المستوى (professional=1.2) لما الاتنين موجودين', async () => {
    const estimate = await service.estimate(
      ids.tierService,
      undefined,
      TechnicianLevel.PROFESSIONAL,
      false,
      undefined,
      TechnicianPricingTier.PREMIUM,
    );
    expect(estimate.level_price_multiplier).toBe(1.5);
    expect(estimate.base_price_cents).toBe(10000);
    expect(estimate.estimated_total_cents).toBe(15000);
  });

  it('من غير pricingTier خالص — نفس الخدمة بترجع لتسعير المستوى وحده (professional=1.2)', async () => {
    const estimate = await service.estimate(ids.tierService, undefined, TechnicianLevel.PROFESSIONAL);
    expect(estimate.level_price_multiplier).toBe(1.2);
    expect(estimate.estimated_total_cents).toBe(12000);
  });

  it('رجريشن — خدمة من غير أي صف تسعير-فئة تفضل تستخدم تسعير المستوى القديم بالحرف حتى لو pricingTier اتبعت', async () => {
    const estimate = await service.estimate(
      ids.levelOnlyService,
      undefined,
      TechnicianLevel.PROFESSIONAL,
      false,
      undefined,
      TechnicianPricingTier.PREMIUM,
    );
    expect(estimate.level_price_multiplier).toBe(1.2);
    expect(estimate.estimated_total_cents).toBe(12000);
  });

  it('فئة تسعير من غير صف نشط لها (standard) — مضاعف=1 بلا أي كسر', async () => {
    const estimate = await service.estimate(
      ids.tierService,
      undefined,
      undefined,
      false,
      undefined,
      TechnicianPricingTier.STANDARD,
    );
    expect(estimate.level_price_multiplier).toBe(1);
    expect(estimate.estimated_total_cents).toBe(10000);
  });
});
