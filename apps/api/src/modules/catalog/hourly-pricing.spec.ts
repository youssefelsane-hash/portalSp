import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { Service, PricingModel } from './entities/service.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ApiException } from '../../common/exceptions/api.exception';

/**
 * ADR-0031 Slice H — CatalogService.estimate() كانت فجوة موثّقة صراحة: PricingModel.HOURLY
 * (كانت موجودة أصلاً على Service من قبل هذا الفرع) ماكانش ليها أي فرع حساب مخصوص، فـ
 * base_price_cents كان بيتعامل معه كسعر ثابت حتى لو الخدمة hourly فعليًا (سعر الساعة مش بيتضرب
 * في duration_hours أبدًا). الإصلاح: باراميتر durationHours جديد (append-only) بيضاعف السعر
 * الأساسي قبل تطبيق مضاعف مستوى الفني/الطوارئ — بنفس الترتيب المستخدم لباقي عوامل السعر.
 */
describe('CatalogService.estimate() — ضرب سعر الساعة في duration_hours لخدمات pricing_model=hourly (ADR-0031 Slice H)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 10);
  const ids = { category: '', hourlyService: '', fixedService: '' };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData, ServicePricingTierPricing],
    });
    await dataSource.initialize();

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, display_order, is_active) VALUES ($1,$2,$3,0,true) RETURNING id`,
      [`فئة تسعير بالساعة ${runId}`, `Hourly Pricing Category ${runId}`, `test-hourly-pricing-cat-${runId}`],
    );
    ids.category = category.id;

    const [hourlyService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, requires_precise_schedule, min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'hourly',8000,true,'new',20,true) RETURNING id`,
      [ids.category, `خدمة بالساعة ${runId}`, `test-hourly-service-${runId}`],
    );
    ids.hourlyService = hourlyService.id;

    const [fixedService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, min_technician_level, commission_percentage, is_active)
       VALUES ($1,$2,$3,'fixed',50000,'new',20,true) RETURNING id`,
      [ids.category, `خدمة ثابتة ${runId}`, `test-fixed-service-${runId}`],
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
      new PricingEngineService({} as never, {} as never, {} as never),
      dataSource.getRepository(ServicePricingTierPricing),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM services WHERE id IN ($1,$2)`, [ids.hourlyService, ids.fixedService]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  }, 15000);

  it('من غير duration_hours: يرفض بدل fallback صامت إلى ساعة واحدة', async () => {
    await expect(service.estimate(ids.hourlyService)).rejects.toBeInstanceOf(ApiException);
  });

  it('بـduration_hours=3: السعر الأساسي بيتضاعف في عدد الساعات قبل أي مضاعف تاني', async () => {
    const estimate = await service.estimate(ids.hourlyService, undefined, undefined, false, undefined, undefined, 3);
    expect(estimate.base_price_cents).toBe(24000);
    expect(estimate.estimated_total_cents).toBe(24000);
  });

  it('خدمة pricing_model=fixed: duration_hours متبعتة بالغلط (أو من endpoint معاينة عام) بتتجاهَل تمامًا', async () => {
    const estimate = await service.estimate(ids.fixedService, undefined, undefined, false, undefined, undefined, 5);
    expect(estimate.base_price_cents).toBe(50000);
    expect(estimate.estimated_total_cents).toBe(50000);
  });
});
