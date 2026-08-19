import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceZonePricing } from './entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from './entities/service-level-pricing.entity';
import { ServiceAddon } from './entities/service-addon.entity';
import { ServiceStandardData } from './entities/service-standard-data.entity';
import { Service } from './entities/service.entity';
import { CatalogService } from './catalog.service';

/**
 * Script 7 Phase 2 — لازم يبقى مستحيل تمامًا (مش "غالبًا") إن العميل يشوف أو يحجز خدمة/فئة/
 * إضافة معطّلة (is_active=false) أو محذوفة (soft-deleted)، حتى لو عرف الـid بالظبط (رابط قديم
 * محفوظ، تاريخ متصفح، الخ). اتأكدت الـinvariants دي حيًا يدويًا (curl ضد السيرفر الحقيقي) قبل
 * كتابة الاختبار ده — النتيجة كانت صحيحة بالفعل (isActive:true في كل WHERE clause)، فالاختبار
 * ده بيقفل الفجوة إن الـinvariant ده كان بلا أي حماية regression خالص قبل كده.
 */
describe('CatalogService — خدمة/فئة/إضافة معطّلة أو محذوفة مستحيل تظهر أو تُحجز (Script 7 Phase 2)', () => {
  let dataSource: DataSource;
  let service: CatalogService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    activeCategory: '',
    inactiveCategory: '',
    activeService: '',
    inactiveService: '',
    softDeletedService: '',
    activeAddon: '',
    inactiveAddon: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Service, ServiceCategory, ServiceZonePricing, ServiceLevelPricing, ServiceAddon, ServiceStandardData],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [activeCategory] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [`فئة نشطة ${runId}`, `Active Cat ${runId}`, `active-cat-vis-${runId}`],
    );
    ids.activeCategory = activeCategory.id;
    const [inactiveCategory] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,false) RETURNING id`,
      [`فئة معطّلة ${runId}`, `Inactive Cat ${runId}`, `inactive-cat-vis-${runId}`],
    );
    ids.inactiveCategory = inactiveCategory.id;

    const [activeService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
      [ids.activeCategory, `خدمة نشطة ${runId}`, `active-svc-vis-${runId}`],
    );
    ids.activeService = activeService.id;
    const [inactiveService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,'fixed',10000,false) RETURNING id`,
      [ids.activeCategory, `خدمة معطّلة ${runId}`, `inactive-svc-vis-${runId}`],
    );
    ids.inactiveService = inactiveService.id;
    // خدمة نشطة (is_active=true) بس soft-deleted — حالة مختلفة عن is_active=false (TypeORM
    // بيستثنيها تلقائيًا عبر deleted_at IS NULL الضمنية، مش شرط WHERE صريح في الكود).
    const [softDeletedService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, is_active, deleted_at)
       VALUES ($1,$2,$3,'fixed',10000,true, now()) RETURNING id`,
      [ids.activeCategory, `خدمة محذوفة ${runId}`, `deleted-svc-vis-${runId}`],
    );
    ids.softDeletedService = softDeletedService.id;

    const [activeAddon] = await q(
      `INSERT INTO service_addons (service_id, name_ar, price_cents, is_active) VALUES ($1,$2,500,true) RETURNING id`,
      [ids.activeService, `إضافة نشطة ${runId}`],
    );
    ids.activeAddon = activeAddon.id;
    const [inactiveAddon] = await q(
      `INSERT INTO service_addons (service_id, name_ar, price_cents, is_active) VALUES ($1,$2,500,false) RETURNING id`,
      [ids.activeService, `إضافة معطّلة ${runId}`],
    );
    ids.inactiveAddon = inactiveAddon.id;

    service = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await dataSource.query(`DELETE FROM service_addons WHERE service_id = $1`, [ids.activeService]);
      await dataSource.query(`DELETE FROM services WHERE id IN ($1,$2,$3)`, [
        ids.activeService,
        ids.inactiveService,
        ids.softDeletedService,
      ]);
      await dataSource.query(`DELETE FROM service_categories WHERE id IN ($1,$2)`, [
        ids.activeCategory,
        ids.inactiveCategory,
      ]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('findActiveCategories(): فئة نشطة تظهر، فئة معطّلة مستحيل تظهر', async () => {
    const categories = await service.findActiveCategories();
    const ourCategories = categories.filter((c) => [ids.activeCategory, ids.inactiveCategory].includes(c.id));
    expect(ourCategories.map((c) => c.id)).toEqual([ids.activeCategory]);
  });

  it('findServices(): خدمة نشطة تظهر، خدمة معطّلة/محذوفة مستحيل تظهر', async () => {
    const services = await service.findServices(ids.activeCategory);
    const ids_ = services.map((s) => s.id);
    expect(ids_).toContain(ids.activeService);
    expect(ids_).not.toContain(ids.inactiveService);
    expect(ids_).not.toContain(ids.softDeletedService);
  });

  it('findServiceOrThrow(): خدمة نشطة بترجع عادي، معطّلة/محذوفة/مش موجودة كلهم بيرفضوا 404 بنفس الرسالة (مفيش تمييز يسرّب وجودها)', async () => {
    const active = await service.findServiceOrThrow(ids.activeService);
    expect(active.id).toBe(ids.activeService);

    await expect(service.findServiceOrThrow(ids.inactiveService)).rejects.toMatchObject({ code: 'VAL_001' });
    await expect(service.findServiceOrThrow(ids.softDeletedService)).rejects.toMatchObject({ code: 'VAL_001' });
    await expect(service.findServiceOrThrow('00000000-0000-7000-8000-000000000999')).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('findAddons(): إضافة نشطة تظهر، إضافة معطّلة مستحيل تظهر', async () => {
    const addons = await service.findAddons(ids.activeService);
    const addonIds = addons.map((a) => a.id);
    expect(addonIds).toContain(ids.activeAddon);
    expect(addonIds).not.toContain(ids.inactiveAddon);
  });

  it('findAddonsByIds(): محاولة حجز إضافة معطّلة بالـid بترفض بوضوح — مش تتجاهل بصمت وتاخد فلوس عن حاجة متسلمّش', async () => {
    await expect(service.findAddonsByIds(ids.activeService, [ids.activeAddon, ids.inactiveAddon])).rejects.toMatchObject({
      code: 'VAL_001',
    });
    // بس الإضافة النشطة لوحدها تنجح عادي.
    const found = await service.findAddonsByIds(ids.activeService, [ids.activeAddon]);
    expect(found.map((a) => a.id)).toEqual([ids.activeAddon]);
  });
});
