import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

// اختبار حي ضد Postgres حقيقي — بَقّة حقيقية اتلقطت من بلاغ المالك (2026-08-19، سيناريو "يوسف"):
// فني اتسجّل من الأدمن ومحدّش فتحله تطبيق الفني الحقيقي (معندوش current_location) كان يظهر في
// قايمة اختيار الفني اليدوي (`listForServiceBooking()`)، العميل يختاره، وبعد كده التوزيع الفعلي
// (`matching.service.ts`'s findEligibleTechnicians()) يرفضه لأنه بيشترط current_location IS NOT
// NULL صراحة — الطلب يفضل من غير فني بصمت. الإصلاح: نفس الشرط بقى في القايمة كمان.
describe('TechniciansService.listForServiceBooking() — فني بلا current_location مايظهرش (2026-08-19)', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: TechniciansService;
  const runId = Date.now().toString(36);
  const ids = {
    countryId: '',
    cityId: '',
    zoneId: '',
    customerUserId: '',
    addressId: '',
    categoryId: '',
    serviceId: '',
    withLocationUserId: '',
    withLocationTechId: '',
    noLocationUserId: '',
    noLocationTechId: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, City, Area, ServiceZone],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    ids.countryId = country.id;
    const [category] = await q(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.countryId, `مدينة موقع ${runId}`, `LocCity${runId}`, `loc-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق موقع ${runId}`, `LocZone${runId}`],
    );
    ids.zoneId = zone.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2036${runId}`.slice(0, 15), `عميل موقع ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع اختبار الموقع'],
    );
    ids.addressId = address.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'formula',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة موقع ${runId}`, `loc-service-${runId}`],
    );
    ids.serviceId = svc.id;

    const [withLocationUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2037${runId}`.slice(0, 15), `فني معاه موقع ${runId}`],
    );
    ids.withLocationUserId = withLocationUser.id;
    const [withLocationTech] = await q(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
       VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.withLocationUserId, `LOCY${runId}`.slice(0, 20)],
    );
    ids.withLocationTechId = withLocationTech.id;

    // فني "يوسف" — اتسجّل من الأدمن، معتمد ومؤهّل للخدمة/المنطقة بالظبط زي التاني، بس محدّش فتحله
    // تطبيق الفني الحقيقي أبدًا (current_location لسه NULL).
    const [noLocationUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2038${runId}`.slice(0, 15), `فني بلا موقع ${runId}`],
    );
    ids.noLocationUserId = noLocationUser.id;
    const [noLocationTech] = await q(
      `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level)
       VALUES ($1,$2,'x','approved','new') RETURNING id`,
      [ids.noLocationUserId, `LOCN${runId}`.slice(0, 20)],
    );
    ids.noLocationTechId = noLocationTech.id;

    for (const technicianId of [ids.withLocationTechId, ids.noLocationTechId]) {
      await q(`INSERT INTO technician_services (technician_id,service_id,is_active) VALUES ($1,$2,true)`, [
        technicianId,
        ids.serviceId,
      ]);
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [
        technicianId,
        ids.zoneId,
      ]);
    }

    const geoService = new GeoService(
      dataSource.getRepository(City),
      dataSource.getRepository(Area),
      dataSource.getRepository(ServiceZone),
      dataSource,
    );
    const settingsServiceStub = { getNumber: async (_key: string, defaultValue: number) => defaultValue };
    service = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      {} as never,
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as never,
      geoService,
      settingsServiceStub as never,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.withLocationTechId, ids.noLocationTechId]);
    await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.withLocationTechId, ids.noLocationTechId]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.withLocationTechId, ids.noLocationTechId]);
    await q(`DELETE FROM addresses WHERE id=$1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUserId, ids.withLocationUserId, ids.noLocationUserId]);
    await q(`DELETE FROM services WHERE id=$1`, [ids.serviceId]);
    await q(`DELETE FROM service_zones WHERE id=$1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id=$1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('الفني اللي معاه موقع بيظهر، اللي معندوش موقع لأ — رغم إن الاتنين مؤهلين بنفس الظبط', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const technicianIds = items.map((item) => item.technicianId);
    expect(technicianIds).toContain(ids.withLocationTechId);
    expect(technicianIds).not.toContain(ids.noLocationTechId);
  });
});
