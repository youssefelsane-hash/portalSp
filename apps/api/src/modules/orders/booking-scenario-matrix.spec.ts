import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { realPricingEngineService } from '../pricing/pricing-engine.testing';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { Service, PriceCertaintyMode } from '../catalog/entities/service.entity';
import { ServicePricingField } from '../pricing/entities/service-pricing-field.entity';
import { ServicePricingRule } from '../pricing/entities/service-pricing-rule.entity';
import { ServicePricingEvaluation } from '../pricing/entities/service-pricing-evaluation.entity';
import { OrderPriceStatus } from './entities/order.entity';
import { initialPriceStatus } from './initial-price-status';

/**
 * **بند 18 — مصفوفة سيناريوهات الحجز اللي المالك سمّاها بالاسم.**
 *
 * الملف ده **مش** بيعيد اختبار حاجة متغطّية. غرضه اتنين:
 *
 * 1. يغطي السيناريوهين اللي ماكانش ليهم تغطية أصلاً: `fixed` (سعر مؤكد) و`range` (نطاق تقديري).
 *    اتأكدت إن مفيش أي spec بيذكر `confirmed_price` ولا `estimated_range` قبل الملف ده.
 *
 * 2. يبقى **الفهرس الواحد** للمصفوفة: كل سيناريو مسمّى → الـspec اللي بيغطيه. والاختبار بيتأكد
 *    إن الملفات دي لسه موجودة فعلاً، فلو حد شال أو غيّر اسم spec بيغطي سيناريو للمالك، ده بيفشل
 *    هنا بدل ما التغطية تختفي في صمت ومحدش ياخد باله.
 */
describe('بند 18 — مصفوفة سيناريوهات الحجز', () => {
  jest.setTimeout(60_000);

  let dataSource: DataSource;
  let catalog: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { category: '', fixedService: '', rangeService: '' };
  const BASE_CENTS = 40_000;

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

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
      [`فئة مصفوفة ${runId}`, `Matrix Cat ${runId}`, `matrix-cat-${runId}`],
    );
    ids.category = category.id;

    // fixed = سعر مؤكد: رقم واحد، مفيش نطاق.
    const [fixed] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, price_certainty_mode)
       VALUES ($1,$2,$3,'formula',$4,'confirmed_price') RETURNING id`,
      [ids.category, `خدمة سعر مؤكد ${runId}`, `matrix-fixed-${runId}`, BASE_CENTS],
    );
    ids.fixedService = fixed.id;

    // range = نطاق تقديري: نفس السعر، بس بيتعرض كنطاق ±.
    const [range] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
                             price_certainty_mode, range_percent_below, range_percent_above)
       VALUES ($1,$2,$3,'formula',$4,'estimated_range',10,25) RETURNING id`,
      [ids.category, `خدمة نطاق ${runId}`, `matrix-range-${runId}`, BASE_CENTS],
    );
    ids.rangeService = range.id;

    catalog = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never,
      realPricingEngineService(dataSource),
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM services WHERE id = ANY($1::uuid[])`, [[ids.fixedService, ids.rangeService]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    } finally {
      await dataSource.destroy();
    }
  });

  // ===== السيناريو الناقص الأول: fixed =====

  describe('fixed — سعر مؤكد', () => {
    it('بيرجّع رقم واحد بلا نطاق، وحالة السعر «مؤكد»', async () => {
      const estimate = await catalog.estimate(ids.fixedService);

      expect(estimate.estimated_total_cents).toBe(BASE_CENTS);
      // مفيش نطاق يتعرض لخدمة سعرها نهائي — عرضه بيقلّل ثقة العميل في رقم مؤكد.
      expect(estimate.display_price_min_cents).toBeNull();
      expect(estimate.display_price_max_cents).toBeNull();
      expect(estimate.price_certainty_mode).toBe(PriceCertaintyMode.CONFIRMED_PRICE);

      expect(
        initialPriceStatus({
          hasLockedMatchPreview: false,
          remoteQuoteRequested: false,
          priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE,
        }),
      ).toBe(OrderPriceStatus.CONFIRMED);
    });
  });

  // ===== السيناريو الناقص التاني: range =====

  describe('range — نطاق تقديري', () => {
    it('النطاق بيتحسب حوالين السعر المحسوب، وحالة السعر «مبدئي»', async () => {
      const estimate = await catalog.estimate(ids.rangeService);

      expect(estimate.estimated_total_cents).toBe(BASE_CENTS);
      // -10% / +25% حوالين 40000.
      expect(estimate.display_price_min_cents).toBe(36_000);
      expect(estimate.display_price_max_cents).toBe(50_000);
      expect(estimate.price_certainty_mode).toBe(PriceCertaintyMode.ESTIMATED_RANGE);

      expect(
        initialPriceStatus({
          hasLockedMatchPreview: false,
          remoteQuoteRequested: false,
          priceCertaintyMode: PriceCertaintyMode.ESTIMATED_RANGE,
        }),
      ).toBe(OrderPriceStatus.PROVISIONAL);
    });

    it('النطاق **مش** حدود القصّ — الحقلين مستقلين تمامًا (بند 29)', async () => {
      // قصّ ضيّق جدًا: لو النطاق كان مبني على القصّ كان هيطلع 39000–39000.
      await q(`UPDATE services SET min_price_cents = 39000, max_price_cents = 39000 WHERE id = $1`, [
        ids.rangeService,
      ]);
      const estimate = await catalog.estimate(ids.rangeService);

      // السعر نفسه اتقصّ.
      expect(estimate.estimated_total_cents).toBe(39_000);
      expect(estimate.min_price_cents).toBe(39_000);
      expect(estimate.max_price_cents).toBe(39_000);
      // والنطاق اتحسب **بعد** القصّ على القيمة المقصوصة — مش نسخة من الحدود.
      expect(estimate.display_price_min_cents).toBe(35_100);
      expect(estimate.display_price_max_cents).toBe(48_750);

      await q(`UPDATE services SET min_price_cents = NULL, max_price_cents = NULL WHERE id = $1`, [
        ids.rangeService,
      ]);
    });
  });

  // ===== الفهرس: باقي سيناريوهات المالك وأماكن تغطيتها =====

  describe('باقي المصفوفة — كل سيناريو والـspec اللي بيغطيه', () => {
    const MATRIX: { scenario: string; spec: string }[] = [
      { scenario: 'قفل السعر + ضياع المرشّح', spec: 'orders/provider-lock-no-silent-replacement.spec.ts' },
      { scenario: 'سعر خارج النطاق + موافقة مزدوجة', spec: 'orders/assessment-triage.spec.ts' },
      { scenario: 'معاينة بالموقع + تسعير عن بُعد', spec: 'orders/inspection-then-quote.spec.ts' },
      { scenario: 'خصم رسم التقييم من فاتورة التنفيذ', spec: 'orders/assessment-triage.spec.ts' },
      { scenario: 'اختيار المنفّذ بعد العرض + فرق المستوى مرة واحدة', spec: 'orders/post-quote-provider-selection.spec.ts' },
      { scenario: 'عقد أجسام المعاينة والإنشاء', spec: 'orders/booking-match-preview-contract.spec.ts' },
      { scenario: 'استرداد رسم التقييم بعد الإلغاء', spec: 'orders/orders-cancel-prepaid-refund.spec.ts' },
      { scenario: 'حالة السعر وقت الإنشاء', spec: 'orders/initial-price-status.spec.ts' },
      { scenario: 'نطاق العرض مقابل حدود القصّ (وحدة)', spec: 'catalog/estimated-display-range.spec.ts' },
    ];

    it.each(MATRIX)('$scenario → $spec موجود', ({ spec }) => {
      // `__dirname` = modules/orders، فالمسارات فوق نسبية لـmodules/.
      expect(existsSync(join(__dirname, '..', spec))).toBe(true);
    });
  });
});
