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

/**
 * ADR-0029 (docs/08 §42 Phase A.4 Slice 1) — نموذج تسعير Service.pricingModel=worker_rate،
 * أول خطوة في هجرة حجز الشغالة للمحرك الموحّد. الاختبار ده بيغطي فرع estimate() الجديد بمعزل
 * (بلا OrdersService/DomesticWorkerProfile خالص — CatalogService ماعندهاش أي علم بيهم عمدًا):
 * 1. precomputedWorkerRateCents مفقودة → يترفض VAL_001 (خدمة worker_rate محتاجة فني يتحدد الأول).
 * 2. precomputedWorkerRateCents موجودة → السعر بيترجع زي ما هو بالحرف، بلا level_price_multiplier
 *    أو zone override (حتى لو موجودين على الخدمة) — السعر النهائي المتفق عليه شخصيًا.
 * 3. رجريشن: خدمة fixed عادية (pricingModel != worker_rate) صفر تأثير من الباراميتر الجديد حتى
 *    لو اتبعت غلط.
 */
describe('CatalogService.estimate() — نموذج تسعير worker_rate (ADR-0029، docs/08 §42 Phase A.4)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { category: '', zone: '', city: '', country: '', workerRateService: '', fixedService: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData, ServicePricingTierPricing],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة سعر فني ${runId}`, `Worker Rate City ${runId}`, `worker-rate-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق سعر فني ${runId}`,
      `Worker Rate Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة سعر فني ${runId}`,
      `Worker Rate Category ${runId}`,
      `worker-rate-category-${runId}`,
    ]);
    ids.category = category.id;

    // خدمة worker_rate — base_price_cents مالوش معنى (0)، السعر من الفني المحدد وقت الحجز.
    const [workerRateService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, cash_allowed)
       VALUES ($1,$2,$3,'worker_rate',0,false) RETURNING id`,
      [ids.category, `خدمة سعر فني ${runId}`, `worker-rate-service-${runId}`],
    );
    ids.workerRateService = workerRateService.id;
    // zone override موجود عمدًا — لازم يتجاهَل تمامًا لخدمة worker_rate (مش زي fixed/hourly).
    await q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, price_cents, surge_multiplier, is_active, valid_from)
       VALUES ($1,$2,'override',999999,1.5,true, now() - interval '1 day')`,
      [ids.workerRateService, ids.zone],
    );

    const [fixedService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',50000) RETURNING id`,
      [ids.category, `خدمة عادية ${runId}`, `worker-rate-fixed-service-${runId}`],
    );
    ids.fixedService = fixedService.id;

    service = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never,
      {} as never,
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_zone_pricing WHERE service_id = $1`, [ids.workerRateService]);
    await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.workerRateService, ids.fixedService]]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('worker_rate + precomputedWorkerRateCents مفقودة: يترفض VAL_001', async () => {
    await expect(service.estimate(ids.workerRateService, ids.zone)).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('worker_rate + precomputedWorkerRateCents موجودة: السعر النهائي بيترجع بالحرف، بلا zone override ولا level multiplier', async () => {
    const estimate = await service.estimate(ids.workerRateService, ids.zone, undefined, false, undefined, undefined, 72000);
    expect(estimate.base_price_cents).toBe(72000);
    expect(estimate.estimated_total_cents).toBe(72000);
    expect(estimate.level_price_multiplier).toBe(1);
    expect(estimate.surge_multiplier).toBe(1);
    expect(estimate.emergency_surcharge_cents).toBe(0);
  });

  it('رجريشن: خدمة fixed عادية صفر تأثير من precomputedWorkerRateCents حتى لو اتبعت غلط', async () => {
    const estimate = await service.estimate(ids.fixedService, ids.zone, undefined, false, undefined, undefined, 999999);
    expect(estimate.estimated_total_cents).toBe(50000);
  });
});
