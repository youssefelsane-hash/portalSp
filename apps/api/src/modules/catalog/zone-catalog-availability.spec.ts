import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CatalogService } from './catalog.service';
import { SetZoneCatalogAvailabilityDto, ZoneCatalogTargetType } from './dto/set-zone-catalog-availability.dto';
import { ServiceCategory } from './entities/service-category.entity';
import { Service } from './entities/service.entity';
import { ZoneCatalogAvailabilityService } from './zone-catalog-availability.service';

describe('إتاحة الكتالوج حسب نطاق الخدمة', () => {
  let dataSource: DataSource;
  let catalog: CatalogService;
  let availability: ZoneCatalogAvailabilityService;
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    admin: '',
    rootCategory: '',
    childCategory: '',
    service: '',
  };

  const q = <T = { id: string }>(sql: string, params?: unknown[]): Promise<T[]> =>
    dataSource.query(sql, params) as Promise<T[]>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [ServiceCategory, Service],
    });
    await dataSource.initialize();

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code)
       VALUES ($1,$2,$3,$4,'EGP') RETURNING id`,
      [`دولة ${runId}`, `Country ${runId}`, `Z${runId.slice(0, 1).toUpperCase()}`, `+8${runId.slice(0, 4)}`],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [ids.country, `مدينة ${runId}`, `City ${runId}`, `zone-catalog-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id, name_ar, name_en)
       VALUES ($1,$2,$3) RETURNING id`,
      [ids.city, `نطاق ${runId}`, `Zone ${runId}`],
    );
    ids.zone = zone.id;
    const [admin] = await q(
      `INSERT INTO users (phone_number, full_name, user_type)
       VALUES ($1,$2,'admin') RETURNING id`,
      [`+7${runId}`.slice(0, 15), `أدمن ${runId}`],
    );
    ids.admin = admin.id;
    const [root] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug, display_order)
       VALUES ($1,$2,$3,900) RETURNING id`,
      [`فئة رئيسية ${runId}`, `Root ${runId}`, `zone-root-${runId}`],
    );
    ids.rootCategory = root.id;
    const [child] = await q(
      `INSERT INTO service_categories (parent_category_id, name_ar, name_en, slug, display_order)
       VALUES ($1,$2,$3,$4,901) RETURNING id`,
      [ids.rootCategory, `فئة فرعية ${runId}`, `Child ${runId}`, `zone-child-${runId}`],
    );
    ids.childCategory = child.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, name_en, slug, pricing_model, base_price_cents, is_active)
       VALUES ($1,$2,$3,$4,'formula',10000,true) RETURNING id`,
      [ids.childCategory, `خدمة ${runId}`, `Service ${runId}`, `zone-service-${runId}`],
    );
    ids.service = service.id;

    catalog = Object.assign(Object.create(CatalogService.prototype) as CatalogService, {
      categories: dataSource.getRepository(ServiceCategory),
      services: dataSource.getRepository(Service),
      settingsService: { getNumber: async (_key: string, fallback: number) => fallback },
    });
    availability = new ZoneCatalogAvailabilityService(dataSource, {
      record: jest.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterEach(async () => {
    await q(`DELETE FROM service_zone_catalog_overrides WHERE service_zone_id = $1`, [ids.zone]);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM service_zone_catalog_overrides WHERE service_zone_id = $1`, [ids.zone]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id IN ($1,$2)`, [ids.childCategory, ids.rootCategory]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.admin]);
    } finally {
      await dataSource.destroy();
    }
  });

  async function setRule(targetType: ZoneCatalogTargetType, targetId: string, isEnabled: boolean | null) {
    await availability.setOverride(
      ids.admin,
      ids.zone,
      Object.assign(new SetZoneCatalogAvailabilityDto(), {
        target_type: targetType,
        target_id: targetId,
        is_enabled: isEnabled,
      }),
    );
  }

  it('غياب أي override يعني أن كل شيء متاح افتراضيًا', async () => {
    expect((await catalog.findServices(ids.childCategory, undefined, ids.zone)).map((item) => item.id)).toContain(
      ids.service,
    );
    expect((await catalog.findActiveCategories(ids.zone)).map((item) => item.id)).toEqual(
      expect.arrayContaining([ids.rootCategory, ids.childCategory]),
    );
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).resolves.toBeUndefined();
  });

  it('حجب الفئة الرئيسية يخفي خدمات كل الفئات التابعة ويمنع الحجز المباشر', async () => {
    await setRule(ZoneCatalogTargetType.CATEGORY, ids.rootCategory, false);

    expect(await catalog.findServices(ids.childCategory, undefined, ids.zone)).toEqual([]);
    const categories = await catalog.findActiveCategories(ids.zone);
    expect(categories.map((item) => item.id)).not.toEqual(
      expect.arrayContaining([ids.rootCategory, ids.childCategory]),
    );
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).rejects.toMatchObject({
      code: 'ORDR_001',
    });
  });

  it('قرار الخدمة المباشر يفتح استثناء داخل فئة محجوبة، وإلغاء القرار يرجّع الوراثة', async () => {
    await setRule(ZoneCatalogTargetType.CATEGORY, ids.rootCategory, false);
    await setRule(ZoneCatalogTargetType.SERVICE, ids.service, true);

    expect((await catalog.findServices(ids.childCategory, undefined, ids.zone)).map((item) => item.id)).toContain(
      ids.service,
    );
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).resolves.toBeUndefined();

    await setRule(ZoneCatalogTargetType.SERVICE, ids.service, null);
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).rejects.toMatchObject({
      code: 'ORDR_001',
    });
  });

  it('أقرب قرار فئة هو الذي يفوز في شجرة الفئات', async () => {
    await setRule(ZoneCatalogTargetType.CATEGORY, ids.rootCategory, false);
    await setRule(ZoneCatalogTargetType.CATEGORY, ids.childCategory, true);

    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).resolves.toBeUndefined();
    const rows = await availability.listForZone(ids.zone);
    const child = rows.find((item) => item.id === ids.childCategory);
    expect(child?.effective_enabled).toBe(true);
    expect(child?.services.find((item) => item.id === ids.service)?.effective_enabled).toBe(true);
  });

  it('حجب خدمة واحدة لا يحجب بقية الفئة، وإلغاء الـoverride يعيد الافتراضي', async () => {
    await setRule(ZoneCatalogTargetType.SERVICE, ids.service, false);
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).rejects.toMatchObject({
      code: 'ORDR_001',
    });

    await setRule(ZoneCatalogTargetType.SERVICE, ids.service, null);
    const rows = await q<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM service_zone_catalog_overrides
        WHERE service_zone_id = $1 AND service_id = $2`,
      [ids.zone, ids.service],
    );
    expect(rows[0].count).toBe('0');
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).resolves.toBeUndefined();
  });

  it('تغيير الأدمن ينتظر إنشاء الطلب الجاري بدل ما يغيّر الإتاحة في منتصف العملية', async () => {
    let releaseSharedLock!: () => void;
    let sharedLockAcquired!: () => void;
    const sharedLockReady = new Promise<void>((resolve) => {
      sharedLockAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseSharedLock = resolve;
    });

    const bookingTransaction = dataSource.transaction(async (manager) => {
      await catalog.assertServiceAvailableInZone(ids.service, ids.zone, manager, true);
      sharedLockAcquired();
      await release;
    });
    await sharedLockReady;

    let adminUpdateFinished = false;
    const adminUpdate = setRule(ZoneCatalogTargetType.SERVICE, ids.service, false).then(() => {
      adminUpdateFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(adminUpdateFinished).toBe(false);

    releaseSharedLock();
    await Promise.all([bookingTransaction, adminUpdate]);
    await expect(catalog.assertServiceAvailableInZone(ids.service, ids.zone)).rejects.toMatchObject({
      code: 'ORDR_001',
    });
  });
});
