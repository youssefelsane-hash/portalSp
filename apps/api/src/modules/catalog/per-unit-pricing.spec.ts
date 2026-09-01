import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { PricingModel, Service } from './entities/service.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';

describe('CatalogService.estimate() - per-unit quantity', () => {
  let dataSource: DataSource;
  let catalog: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { category: '', perUnitService: '', fractionalService: '', monthlyService: '', fixedService: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Service,
        ServiceCategory,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        ServicePricingTierPricing,
      ],
    });
    await dataSource.initialize();

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, display_order, is_active)
       VALUES ($1,$2,$3,0,true) RETURNING id`,
      [`فئة بالوحدة ${runId}`, `Per-unit category ${runId}`, `test-per-unit-category-${runId}`],
    );
    ids.category = category.id;

    const [perUnitService] = await q(
      `INSERT INTO services
         (category_id, name_ar, slug, pricing_model, base_price_cents, unit_name_ar,
          quantity_min, quantity_max, quantity_step, quantity_precision,
          min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'per_unit',3000,'قطعة',1,10,1,0,'new',20,true) RETURNING id`,
      [ids.category, `خدمة بالقطعة ${runId}`, `test-per-unit-service-${runId}`],
    );
    ids.perUnitService = perUnitService.id;

    const [fractionalService] = await q(
      `INSERT INTO services
         (category_id, name_ar, slug, pricing_model, base_price_cents, unit_name_ar,
          quantity_min, quantity_max, quantity_step, quantity_precision,
          min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'per_unit',3000,'متر',0.5,100,0.5,1,'new',20,true) RETURNING id`,
      [ids.category, `خدمة كسرية ${runId}`, `test-fractional-service-${runId}`],
    );
    ids.fractionalService = fractionalService.id;

    const [monthlyService] = await q(
      `INSERT INTO services
         (category_id, name_ar, slug, pricing_model, base_price_cents, unit_name_ar,
          quantity_min, quantity_max, quantity_step, quantity_precision,
          min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'monthly',250000,'شهر',1,12,1,0,'new',20,true) RETURNING id`,
      [ids.category, `خدمة شهرية ${runId}`, `test-monthly-service-${runId}`],
    );
    ids.monthlyService = monthlyService.id;

    const [fixedService] = await q(
      `INSERT INTO services
         (category_id, name_ar, slug, pricing_model, base_price_cents,
          min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'fixed',50000,'new',20,true) RETURNING id`,
      [ids.category, `خدمة ثابتة ${runId}`, `test-per-unit-fixed-${runId}`],
    );
    ids.fixedService = fixedService.id;

    catalog = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never,
      new PricingEngineService({} as never, {} as never, {} as never),
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q('DELETE FROM services WHERE id IN ($1,$2,$3,$4)', [
        ids.perUnitService,
        ids.fractionalService,
        ids.monthlyService,
        ids.fixedService,
      ]);
      await q('DELETE FROM service_categories WHERE id = $1', [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  }, 15000);

  it('multiplies the unit price by the requested quantity', async () => {
    const estimate = await catalog.estimate(
      ids.perUnitService,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      4,
    );
    expect(estimate.base_price_cents).toBe(12000);
    expect(estimate.estimated_total_cents).toBe(12000);
  });

  it('supports fractional quantities without floating-point cents', async () => {
    const estimate = await catalog.estimate(
      ids.fractionalService,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      2.5,
    );
    expect(estimate.base_price_cents).toBe(7500);
  });

  it('multiplies the monthly rate by the visible number of months', async () => {
    const estimate = await catalog.estimate(
      ids.monthlyService,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      3,
    );
    expect(estimate.base_price_cents).toBe(750000);
    expect(estimate.estimated_total_cents).toBe(750000);
  });

  it('rejects a fraction for a service configured as whole pieces', async () => {
    await expect(
      catalog.estimate(ids.perUnitService, undefined, undefined, false, undefined, undefined, undefined, 2.5),
    ).rejects.toThrow('بدون كسور');
  });

  it('enforces configured minimum, maximum, and step', async () => {
    await expect(
      catalog.estimate(ids.fractionalService, undefined, undefined, false, undefined, undefined, undefined, 0.25),
    ).rejects.toThrow('أقل كمية');
    await expect(
      catalog.estimate(ids.fractionalService, undefined, undefined, false, undefined, undefined, undefined, 100.5),
    ).rejects.toThrow('أكبر كمية');
    await expect(
      catalog.estimate(ids.fractionalService, undefined, undefined, false, undefined, undefined, undefined, 2.7),
    ).rejects.toThrow('بخطوات 0.5');
  });

  it('does not apply pricing_quantity to a fixed-price service', async () => {
    const estimate = await catalog.estimate(
      ids.fixedService,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      9,
    );
    expect(estimate.base_price_cents).toBe(50000);
  });
});
