import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { Service } from './entities/service.entity';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { ServicePricingTierPricing } from './entities/service-pricing-tier-pricing.entity';
import { SettingsService } from '../settings/settings.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { TechnicianLevel } from '../technicians/entities/technician-profile.entity';

/**
 * ADR-0042 / docs/08 §64.و — طلب المالك: «الشركات مالهاش معاملات زيادة، الشركة دايمًا بالسعر
 * الأساسي… عايزين جوا كل شركة يكون فيه معامل زيادة خاص بيها».
 *
 * الاختبار ده بيثبّت التلات قواعد الحاكمة في الـADR:
 *  1. المعامل بيضرب سعر الشغل فعليًا (1.2 = +20%).
 *  2. بيحل **محل** مضاعف المستوى مش فوقه (مفيش تحصيل مزدوج).
 *  3. الافتراضي 1.00 = صفر تغيير سلوك للشركات الموجودة.
 */
describe('معامل سعر الشركة (ADR-0042، docs/08 §64.و)', () => {
  let dataSource: DataSource;
  let catalogService: CatalogService;
  const runId = Date.now().toString(36);
  const ids = { category: '', service: '' };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const settingsStub = { getNumber: async (_k: string, fallback: number) => fallback } as unknown as SettingsService;

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
        ServicePricingTierPricing, ServicePricingField, ServicePricingRule, ServicePricingEvaluation],
    });
    await dataSource.initialize();

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة معامل شركة ${runId}`,
      `Company Multiplier Category ${runId}`,
      `company-mult-cat-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, inspection_fee_cents)
       VALUES ($1,$2,$3,'formula',100000,20,0,0) RETURNING id`,
      [ids.category, `خدمة معامل شركة ${runId}`, `company-mult-service-${runId}`],
    );
    ids.service = service.id;

    // مضاعف مستوى حقيقي للخدمة دي (1.5) — عشان نثبت إن معامل الشركة **بيحل محله** مش بيتضرب فيه.
    await q(
      `INSERT INTO service_level_pricing (service_id, technician_level, price_multiplier, is_active)
       VALUES ($1,'premium',1.50,true)`,
      [ids.service],
    );

    catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsStub,
      realPricingEngineService(dataSource),
      dataSource.getRepository(ServicePricingTierPricing),
    );
  }, 20000);

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    await q(`DELETE FROM service_level_pricing WHERE service_id = $1`, [ids.service]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await dataSource.destroy();
  });

  it('من غير معامل: السعر الأساسي زي ما هو (سلوك كل الشركات الحالية، الافتراضي 1.00)', async () => {
    const estimate = await catalogService.estimate(ids.service, undefined, undefined, false, undefined, undefined, undefined, undefined, 1);
    expect(estimate.estimated_total_cents).toBe(100000);
    expect(estimate.level_price_multiplier).toBe(1);
  });

  it('معامل 1.20 بيزوّد السعر 20% فعليًا', async () => {
    const estimate = await catalogService.estimate(
      ids.service,
      undefined,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      1.2,
    );
    expect(estimate.estimated_total_cents).toBe(120000);
    expect(estimate.level_price_multiplier).toBe(1.2);
  });

  it('معامل الشركة بيحل **محل** مضاعف المستوى مش فوقه (مفيش تحصيل مزدوج)', async () => {
    // نفس الخدمة عندها مضاعف مستوى 1.5 لـpremium. لو الاتنين اتركّبوا كان الناتج 180000.
    const withLevelOnly = await catalogService.estimate(ids.service, undefined, TechnicianLevel.PREMIUM);
    expect(withLevelOnly.estimated_total_cents).toBe(150000);

    const companyBooking = await catalogService.estimate(
      ids.service,
      undefined,
      // حتى لو مستوى اتبعت بالغلط مع حجز شركة، المعامل هو اللي بيسري.
      TechnicianLevel.PREMIUM,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      1.2,
    );
    expect(companyBooking.estimated_total_cents).toBe(120000);
  });

  it('قيد الداتابيز بيرفض معامل بره المدى (أقل من 1 أو أكبر من 3)', async () => {
    const [company] = await q(
      `SELECT id FROM technician_companies LIMIT 1`,
    );
    if (!company) return; // مفيش شركات في القاعدة دي — القيد نفسه مختبَر بالـmigration
    await expect(q(`UPDATE technician_companies SET price_multiplier = 0.50 WHERE id = $1`, [company.id])).rejects.toThrow();
    await expect(q(`UPDATE technician_companies SET price_multiplier = 5.00 WHERE id = $1`, [company.id])).rejects.toThrow();
  });
});
