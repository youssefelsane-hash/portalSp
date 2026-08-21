import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { CatalogService } from './catalog.service';

// اختبار حي ضد PostgreSQL حقيقي — Script 3 §7/§12 (finding: مفيش بحث بلغة طبيعية، ولا حقل
// aliases/keywords للخدمة أصلاً). العميل بيكتب "المياه بتنزل من تحت الحوض" فلازم يوصل لخدمة
// "إصلاح تسريب" حتى لو الاسم/الوصف مافيهوش نفس الكلمات بالحرف — عبر search_keywords
// (migration 0129) بدل أي اعتماد AI.
describe('CatalogService.searchServices() — بحث بلغة طبيعية بسيطة (Script 3 §7/§12)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { category: '', leakService: '', wiringService: '' };

  async function safeStep(label: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[catalog-search.spec] فشلت خطوة "${label}":`, err);
    }
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار بحث ${runId}`, `Search Test Category ${runId}`, `test-cat-search-${runId}`],
    );
    ids.category = category.id;

    const [leakService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, search_keywords)
       VALUES ($1,$2,$3,'fixed',20000,$4) RETURNING id`,
      [ids.category, `إصلاح تسريب مواسير ${runId}`, `leak-repair-${runId}`, ['حوض', 'مياه بتنزل', 'تسريب من تحت']],
    );
    ids.leakService = leakService.id;

    const [wiringService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, search_keywords)
       VALUES ($1,$2,$3,'fixed',30000,$4) RETURNING id`,
      [ids.category, `تمديد كهرباء ${runId}`, `wiring-${runId}`, ['كهرباء بايظة', 'قصر']],
    );
    ids.wiringService = wiringService.id;

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
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    if (ids.leakService) await safeStep('حذف خدمة التسريب', () => q(`DELETE FROM services WHERE id = $1`, [ids.leakService]));
    if (ids.wiringService) await safeStep('حذف خدمة الكهرباء', () => q(`DELETE FROM services WHERE id = $1`, [ids.wiringService]));
    if (ids.category) await safeStep('حذف الفئة', () => q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]));
    await dataSource.destroy();
  });

  it('وصف طبيعي ("المياه بتنزل من تحت الحوض") بيلاقي خدمة التسريب عبر search_keywords، مش الاسم المباشر', async () => {
    const results = await service.searchServices('حوض');
    expect(results.map((s) => s.id)).toContain(ids.leakService);
    expect(results.map((s) => s.id)).not.toContain(ids.wiringService);
  });

  // بَقّة حقيقية اتلقطت باختبار حي بمتصفح (Playwright) بعد أول تنفيذ: الاختبار فوق بيبعت كلمة
  // واحدة بس ("حوض")، مش الجملة الكاملة اللي في وصفه — الجملة الكاملة كانت بترجع صفر نتائج فعليًا
  // لأن المطابقة القديمة كانت substring واحد للجملة كلها ضد كلمة مفتاحية قصيرة. اتصلحت بتقسيم
  // الجملة لكلمات + إزالة "ال" التعريف قبل المطابقة. الاختبار ده بيتأكد من السيناريو الحقيقي فعليًا.
  it('الجملة الكاملة بالحرف ("المياه بتنزل من تحت الحوض") بتلاقي الخدمة — مش كلمة واحدة مقتطعة', async () => {
    const results = await service.searchServices('المياه بتنزل من تحت الحوض');
    expect(results.map((s) => s.id)).toContain(ids.leakService);
    expect(results.map((s) => s.id)).not.toContain(ids.wiringService);
  });

  it('"ال" التعريف قبل كلمة مفتاحية ("الحوض") بتتشال قبل المطابقة', async () => {
    const results = await service.searchServices('الحوض');
    expect(results.map((s) => s.id)).toContain(ids.leakService);
  });

  it('بحث بجزء من عبارة كاملة ("مية بتنزل") بيلاقي نفس الخدمة عبر substring على الكلمة المفتاحية', async () => {
    const results = await service.searchServices('بتنزل');
    expect(results.map((s) => s.id)).toContain(ids.leakService);
  });

  it('بحث باسم الخدمة المباشر برضه شغال (مش بس keywords)', async () => {
    const results = await service.searchServices('تسريب مواسير');
    expect(results.map((s) => s.id)).toContain(ids.leakService);
  });

  it('خدمة تانية بكلمات مفتاحية مختلفة (كهرباء) مبتظهرش لبحث "حوض"', async () => {
    const results = await service.searchServices('حوض');
    expect(results.map((s) => s.id)).not.toContain(ids.wiringService);
  });

  it('نص أقل من حرفين يرجّع نتيجة فاضية بدل full-table scan بلا معنى', async () => {
    const results = await service.searchServices('ح');
    expect(results).toEqual([]);
  });

  it('بحث بلا نتائج يرجّع مصفوفة فاضية، مش استثناء', async () => {
    const results = await service.searchServices(`nonexistent-${runId}`);
    expect(results).toEqual([]);
  });
});
