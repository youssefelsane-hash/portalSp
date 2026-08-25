import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { PricingModel, Service } from './entities/service.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';

describe('CatalogService.estimate() - per-unit quantity', () => {
  let dataSource: DataSource;
  let catalog: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { category: '', perUnitService: '', fixedService: '' };
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
          min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'per_unit',3000,'قطعة','new',20,true) RETURNING id`,
      [ids.category, `خدمة بالقطعة ${runId}`, `test-per-unit-service-${runId}`],
    );
    ids.perUnitService = perUnitService.id;

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
      {} as never,
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q('DELETE FROM services WHERE id IN ($1,$2)', [ids.perUnitService, ids.fixedService]);
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
      ids.perUnitService,
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
