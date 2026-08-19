import { DataSource } from 'typeorm';
import { AddressesService } from './addresses.service';
import { Address } from './entities/address.entity';
import { CustomerProfile } from './entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';

/**
 * Script 7 Phase 6 — بَقّة حقيقية اتلقطت: `AddressesService.create()`/`update()` كانا بيتحققوا
 * من `area_id` لوحده (`isAreaLaunched`) من غير ما يتأكدوا إنه فعلاً تابع لـ`city_id` المبعوت
 * جنبه. بما إن `findZoneForPoint()` (orders.service.ts) بيحدد نطاق التسعير من `address.cityId`
 * بس (مش من `areaId`)، عميل كان يقدر يبعت `city_id` لمدينة مختلفة تمامًا عن `area_id` الحقيقي —
 * فيتسجّل عنوان بـ`cityId` غير متسق، ويقدر "يختار" نطاق التسعير اللي يناسبه بدل مكانه الفعلي.
 * الإصلاح: `GeoService.isAreaLaunchedInCity()` بتتحقق من الاتنين مع بعض في استعلام واحد.
 */
describe('AddressesService — area_id لازم يتبع فعليًا لـcity_id (Script 7 Phase 6)', () => {
  let dataSource: DataSource;
  let service: AddressesService;
  const runId = Date.now().toString(36);
  const ids = { country: '', cityA: '', cityB: '', areaA: '', areaB: '', user: '' };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  const baseDto = {
    street_name: 'شارع اختبار',
    latitude: 30.05,
    longitude: 31.25,
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Address, CustomerProfile, Order, City, Area, ServiceZone],
    });
    await dataSource.initialize();

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [cityA] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة أ اتساق ${runId}`,
      `City A Consistency ${runId}`,
      `test-city-a-aac-${runId}`,
    ]);
    ids.cityA = cityA.id;
    const [cityB] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة ب اتساق ${runId}`,
      `City B Consistency ${runId}`,
      `test-city-b-aac-${runId}`,
    ]);
    ids.cityB = cityB.id;
    const [areaA] = await q(
      `INSERT INTO areas (city_id, name_ar, name_en, slug, is_active, is_launched) VALUES ($1,$2,$3,$4,true,true) RETURNING id`,
      [ids.cityA, `حي أ اتساق ${runId}`, `Area A Consistency ${runId}`, `test-area-a-aac-${runId}`],
    );
    ids.areaA = areaA.id;
    const [areaB] = await q(
      `INSERT INTO areas (city_id, name_ar, name_en, slug, is_active, is_launched) VALUES ($1,$2,$3,$4,true,true) RETURNING id`,
      [ids.cityB, `حي ب اتساق ${runId}`, `Area B Consistency ${runId}`, `test-area-b-aac-${runId}`],
    );
    ids.areaB = areaB.id;
    const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2033${runId}`.slice(0, 15),
      `عميل اتساق ${runId}`,
    ]);
    ids.user = user.id;
    await q(`INSERT INTO customer_profiles (user_id) VALUES ($1)`, [ids.user]);

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    service = new AddressesService(
      dataSource.getRepository(Address),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(Order),
      geoService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.user]);
      await q(`DELETE FROM customer_profiles WHERE user_id = $1`, [ids.user]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
      await q(`DELETE FROM areas WHERE id = ANY($1)`, [[ids.areaA, ids.areaB]]);
      await q(`DELETE FROM cities WHERE id = ANY($1)`, [[ids.cityA, ids.cityB]]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('create(): city_id وarea_id متسقين — بينجح عادي', async () => {
    const address = await service.create(ids.user, { ...baseDto, city_id: ids.cityA, area_id: ids.areaA } as never);
    expect(address.cityId).toBe(ids.cityA);
    expect(address.areaId).toBe(ids.areaA);
    await q(`DELETE FROM addresses WHERE id = $1`, [address.id]);
  });

  it('create(): city_id لمدينة وarea_id لمنطقة تابعة لمدينة تانية — يترفض بوضوح', async () => {
    await expect(
      service.create(ids.user, { ...baseDto, city_id: ids.cityB, area_id: ids.areaA } as never),
    ).rejects.toMatchObject({ code: 'ORDR_001' });
  });

  it('update(): تغيير city_id لوحده بلا area_id — لو بقى غير متسق مع areaId الحالي يترفض (مش يتجاهل بصمت)', async () => {
    const address = await service.create(ids.user, { ...baseDto, city_id: ids.cityA, area_id: ids.areaA } as never);
    await expect(service.update(ids.user, address.id, { city_id: ids.cityB } as never)).rejects.toMatchObject({
      code: 'ORDR_001',
    });
    // العنوان لازم يفضل زي ما هو (مش نص محدّث) لو الطلب اترفض.
    const fresh = await dataSource.getRepository(Address).findOne({ where: { id: address.id } });
    expect(fresh?.cityId).toBe(ids.cityA);
    await q(`DELETE FROM addresses WHERE id = $1`, [address.id]);
  });

  it('update(): تغيير area_id لوحده بلا city_id — لو بقى غير متسق مع cityId الحالي يترفض', async () => {
    const address = await service.create(ids.user, { ...baseDto, city_id: ids.cityA, area_id: ids.areaA } as never);
    await expect(service.update(ids.user, address.id, { area_id: ids.areaB } as never)).rejects.toMatchObject({
      code: 'ORDR_001',
    });
    await q(`DELETE FROM addresses WHERE id = $1`, [address.id]);
  });

  it('update(): تغيير الاتنين مع بعض بشكل متسق — بينجح', async () => {
    const address = await service.create(ids.user, { ...baseDto, city_id: ids.cityA, area_id: ids.areaA } as never);
    const updated = await service.update(ids.user, address.id, { city_id: ids.cityB, area_id: ids.areaB } as never);
    expect(updated.cityId).toBe(ids.cityB);
    expect(updated.areaId).toBe(ids.areaB);
    await q(`DELETE FROM addresses WHERE id = $1`, [address.id]);
  });
});
