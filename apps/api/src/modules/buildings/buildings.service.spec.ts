import { DataSource } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception';
import { BuildingsService } from './buildings.service';
import { Building } from './entities/building.entity';

/**
 * تدقيق T-1 (تكملة) — موديول `buildings` كان **صفر اختبارات**، وفيه تلات تصرّفات كل واحد فيهم
 * اتكتب أصلاً كإصلاح لمشكلة حقيقية، وكلهم كانوا بلا أي حارس:
 *
 * 1. `getCurrentMonthOrdersCount` بيستبعد `deleted_at IS NOT NULL` — من غير الشرط ده طلب
 *    ملغي/محذوف كان لسه بيتحسب في عدّاد الاشتراك الشهري للعمارة.
 * 2. `getCurrentMonthOrdersCountBulk` اتكتبت لإصلاح N+1 حقيقي في `AdminBuildingsController.list()`.
 *    خطر النسخة المجمّعة إنها تتفرّق عن الفردية بالصمت — الاختبار بيقارنهم على نفس البيانات.
 * 3. `findActiveByIdOrNull` **بلا throw عمدًا** (docs/08 §125): توليد الطلبات المتكررة لازم يكمّل
 *    من غير خصم لو العمارة اتقفلت، مش يوقف. لو حد «وحّدها» مع `findActiveByCodeOrThrow`، التوليد
 *    الليلي بيقع كله على عمارة واحدة اتعطّلت.
 */
describe('BuildingsService (تدقيق T-1) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: BuildingsService;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
  };
  const buildings: string[] = [];
  const orders: string[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  async function makeBuilding(label: string, active = true): Promise<Building> {
    const building = await service.create({
      name_ar: `عمارة ${label} ${runId}`,
      city_id: ids.city,
      discount_percentage: 15,
      minimum_monthly_orders: 5,
    });
    buildings.push(building.id);
    if (!active) await service.update(building.id, { is_active: false });
    return building;
  }

  /** طلب في العمارة دي بتاريخ محدّد — `created_at` بيتحط بعد الإدخال عشان الافتراضي `now()`. */
  async function makeOrder(buildingId: string, createdAt?: string, softDeleted = false): Promise<string> {
    const [order] = await q<{ id: string }[]>(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, building_id,
                           order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'searching_technician','pending',30000,0,'individual') RETURNING id`,
      [
        `BLDT-${runId}-${orders.length}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        buildingId,
      ],
    );
    orders.push(order.id);
    if (createdAt || softDeleted) {
      await q(`UPDATE orders SET created_at = COALESCE($2::timestamptz, created_at), deleted_at = $3 WHERE id = $1`, [
        order.id,
        createdAt ?? null,
        softDeleted ? new Date() : null,
      ]);
    }
    return order.id;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Building],
    }).initialize();
    service = new BuildingsService(dataSource.getRepository(Building));

    const [country] = await q<{ id: string }[]>(
      `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
       VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
      [`دولة عمائر ${runId}`, `Bld Country ${runId}`, runId.slice(-2).toUpperCase()],
    );
    ids.country = country.id;
    const [city] = await q<{ id: string }[]>(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [country.id, `مدينة عمائر ${runId}`, `Bld City ${runId}`, `bld-city-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q<{ id: string }[]>(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [city.id, `نطاق عمائر ${runId}`, `Bld Zone ${runId}`],
    );
    ids.zone = zone.id;

    const [category] = await q<{ id: string }[]>(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة عمائر ${runId}`, `Bld Category ${runId}`, `bld-cat-${runId}`],
    );
    ids.category = category.id;
    const [svc] = await q<{ id: string }[]>(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
      [category.id, `خدمة عمائر ${runId}`, `bld-svc-${runId}`],
    );
    ids.service = svc.id;

    const [customerUser] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+20b${runId}`.slice(0, 15), `عميل عمائر ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [profile] = await q<{ id: string }[]>(
      `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
      [customerUser.id],
    );
    ids.customerProfile = profile.id;
    const [address] = await q<{ id: string }[]>(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع عمائر ${runId}`],
    );
    ids.address = address.id;
  });

  afterAll(async () => {
    await q(`DELETE FROM orders WHERE id = ANY($1)`, [orders]);
    await q(`DELETE FROM buildings WHERE id = ANY($1)`, [buildings]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  describe('create / البحث بالكود', () => {
    it('بيولّد كود BLD تسلسلي من القاعدة (مش من الكود) وبيحفظ القيم زي ما اتبعتت', async () => {
      const building = await makeBuilding('كود');
      expect(building.code).toMatch(/^BLD/);
      expect(building.nameAr).toBe(`عمارة كود ${runId}`);
      expect(Number(building.discountPercentage)).toBe(15);
      expect(building.minimumMonthlyOrders).toBe(5);
    });

    it('كودين متتاليين مختلفين — الكود مفتاح فريد فأي تكرار بيكسر الإنشاء', async () => {
      const first = await makeBuilding('أول');
      const second = await makeBuilding('تاني');
      expect(first.code).not.toBe(second.code);
    });

    it('`findActiveByCodeOrThrow` بترجع العمارة بالكود الصح', async () => {
      const building = await makeBuilding('بحث');
      expect((await service.findActiveByCodeOrThrow(building.code)).id).toBe(building.id);
    });

    it('كود غلط أو عمارة معطّلة: 404 صريح مش null صامت (بيوصل للعميل وقت الحجز)', async () => {
      const disabled = await makeBuilding('معطّلة', false);
      await expect(service.findActiveByCodeOrThrow('BLD-مش-موجود')).rejects.toBeInstanceOf(ApiException);
      await expect(service.findActiveByCodeOrThrow(disabled.code)).rejects.toBeInstanceOf(ApiException);
    });
  });

  describe('findActiveByIdOrNull — بلا throw عمدًا (توليد الطلبات المتكررة)', () => {
    it('عمارة نشطة بترجع، ومعطّلة بترجع null مش استثناء', async () => {
      const active = await makeBuilding('نشطة-null');
      const disabled = await makeBuilding('معطّلة-null', false);
      expect((await service.findActiveByIdOrNull(active.id))?.id).toBe(active.id);
      expect(await service.findActiveByIdOrNull(disabled.id)).toBeNull();
    });

    it('عمارة اتحذفت soft-delete بترجع null (التوليد بيكمّل من غير خصم)', async () => {
      const building = await makeBuilding('محذوفة');
      await q(`UPDATE buildings SET deleted_at = now() WHERE id = $1`, [building.id]);
      expect(await service.findActiveByIdOrNull(building.id)).toBeNull();
    });

    it('معرّف مش موجود بيرجع null برضه', async () => {
      expect(await service.findActiveByIdOrNull('01a00000-0000-7000-8000-0000000000b1')).toBeNull();
    });
  });

  describe('عدّاد الاشتراك الشهري', () => {
    it('بيحسب طلبات الشهر الحالي بس', async () => {
      const building = await makeBuilding('عدّاد');
      await makeOrder(building.id);
      await makeOrder(building.id);
      // طلب الشهر اللي فات — برّه النافذة.
      await makeOrder(building.id, new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString());

      expect(await service.getCurrentMonthOrdersCount(building.id)).toBe(2);
    });

    it('**طلب soft-deleted مابيتحسبش** — الشرط اللي الدالة اتصلّحت عشانه', async () => {
      const building = await makeBuilding('محذوف-عدّاد');
      await makeOrder(building.id);
      await makeOrder(building.id, undefined, true);

      expect(await service.getCurrentMonthOrdersCount(building.id)).toBe(1);
    });

    it('طلبات عمارة تانية مابتتسربش للعدّاد', async () => {
      const mine = await makeBuilding('بتاعتي');
      const other = await makeBuilding('التانية');
      await makeOrder(mine.id);
      await makeOrder(other.id);
      await makeOrder(other.id);

      expect(await service.getCurrentMonthOrdersCount(mine.id)).toBe(1);
      expect(await service.getCurrentMonthOrdersCount(other.id)).toBe(2);
    });
  });

  describe('النسخة المجمّعة (إصلاح N+1) لازم تطابق الفردية بالظبط', () => {
    it('نفس الأرقام للعمائر كلها، وصفر للّي معندهاش طلبات', async () => {
      const withOrders = await makeBuilding('مجمّع-أ');
      const empty = await makeBuilding('مجمّع-ب');
      await makeOrder(withOrders.id);
      await makeOrder(withOrders.id);
      await makeOrder(withOrders.id, undefined, true); // محذوف — مايتحسبش في الاتنين

      const bulk = await service.getCurrentMonthOrdersCountBulk([withOrders.id, empty.id]);
      expect(bulk.get(withOrders.id)).toBe(await service.getCurrentMonthOrdersCount(withOrders.id));
      // العمارة الفاضية مش بترجع أصلاً من GROUP BY — لازم تتعوّض بصفر مش تغيب.
      expect(bulk.get(empty.id)).toBe(0);
      expect(bulk.size).toBe(2);
    });

    it('قايمة فاضية بترجع Map فاضية من غير ما تضرب استعلام', async () => {
      expect((await service.getCurrentMonthOrdersCountBulk([])).size).toBe(0);
    });
  });

  describe('QR', () => {
    it('بيرجع data URI لصورة PNG جوّاها كود العمارة (محلي بالكامل بلا أي خدمة خارجية)', async () => {
      const building = await makeBuilding('كيو-آر');
      const uri = await service.generateQrPngDataUri(building);
      expect(uri.startsWith('data:image/png;base64,')).toBe(true);
      expect(uri.length).toBeGreaterThan(200);
    });
  });
});
