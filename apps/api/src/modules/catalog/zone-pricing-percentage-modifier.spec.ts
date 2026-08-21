import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing, ZonePricingMode } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { CatalogService } from './catalog.service';

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
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData],
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
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة override ${runId}`, `override-service-${runId}`],
    );
    ids.overrideService = overrideService.id;
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, price_cents)
       VALUES ($1,$2,'override',50000)`,
      [ids.overrideService, ids.zone],
    );

    const [percentageService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة نسبة ${runId}`, `percentage-service-${runId}`],
    );
    ids.percentageService = percentageService.id;
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage)
       VALUES ($1,$2,'percentage',15)`,
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
      {} as never,
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

  it('override — رقم مطلق يستبدل السعر الأساسي بالكامل (السلوك القديم بالحرف)', async () => {
    const estimate = await service.estimate(ids.overrideService, ids.zone);
    expect(estimate.base_price_cents).toBe(50000);
    expect(estimate.estimated_total_cents).toBe(50000);
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
});
