import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

// اختبار حي ضد Postgres حقيقي — ADR-0050 / docs/08 §94 (طلب مالك مباشر).
//
// المساعد شخص لسه معندهوش الخبرة الكافية ياخد شغلانة لوحده. قبل الإصلاح ده، نفس الناس كانوا
// بيظهروا في قايمة الفنيين وقايمة المساعدين (نفس الـSQL بالحرف)، يعني العميل كان يقدر يختار
// مساعد كفني للشغلانة. الاختبار ده بيثبت الفصل فعليًا على قايمة اختيار الفني اللي العميل بيشوفها.
describe('TechniciansService.listForServiceBooking() — المساعد مايظهرش للعميل (ADR-0050)', () => {
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
    technicianUserId: '',
    technicianId: '',
    assistantUserId: '',
    assistantId: '',
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
      [ids.countryId, `مدينة دور ${runId}`, `KindCity${runId}`, `kind-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق دور ${runId}`, `KindZone${runId}`],
    );
    ids.zoneId = zone.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2046${runId}`.slice(0, 15), `عميل دور ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع اختبار الدور'],
    );
    ids.addressId = address.id;
    const [svc] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة دور ${runId}`, `kind-service-${runId}`],
    );
    ids.serviceId = svc.id;

    // الاتنين **متطابقين تمامًا** في كل حاجة (معتمد، معاه موقع، مؤهّل لنفس الخدمة والمنطقة) —
    // الفرق الوحيد بينهم هو `technician_kind`. ده المقصود: يثبت إن الفلترة على الدور نفسه.
    const [technicianUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2047${runId}`.slice(0, 15), `فني كامل ${runId}`],
    );
    ids.technicianUserId = technicianUser.id;
    const [technician] = await q(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,technician_kind,current_location)
       VALUES ($1,$2,'x','approved','new','technician', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.technicianUserId, `KINDT${runId}`.slice(0, 20)],
    );
    ids.technicianId = technician.id;

    const [assistantUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2048${runId}`.slice(0, 15), `مساعد ${runId}`],
    );
    ids.assistantUserId = assistantUser.id;
    const [assistant] = await q(
      `INSERT INTO technician_profiles
         (user_id,technician_code,national_id_encrypted,verification_status,current_level,technician_kind,current_location)
       VALUES ($1,$2,'x','approved','new','assistant', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.assistantUserId, `KINDA${runId}`.slice(0, 20)],
    );
    ids.assistantId = assistant.id;

    for (const technicianId of [ids.technicianId, ids.assistantId]) {
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
    await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.technicianId, ids.assistantId]);
    await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.technicianId, ids.assistantId]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.technicianId, ids.assistantId]);
    await q(`DELETE FROM addresses WHERE id=$1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUserId, ids.technicianUserId, ids.assistantUserId]);
    await q(`DELETE FROM services WHERE id=$1`, [ids.serviceId]);
    await q(`DELETE FROM service_zones WHERE id=$1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id=$1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('الفني الكامل بيظهر في قايمة اختيار العميل، والمساعد لأ — رغم إن الاتنين مؤهلين بنفس الظبط', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const technicianIds = items.map((item) => item.technicianId);
    expect(technicianIds).toContain(ids.technicianId);
    expect(technicianIds).not.toContain(ids.assistantId);
  });

  it('ترقية المساعد لفني بتخليه يظهر فورًا — الدور قابل للتغيير في الاتجاهين (طلب مالك صريح)', async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`UPDATE technician_profiles SET technician_kind = 'technician' WHERE id = $1`, [ids.assistantId]);
    try {
      const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
      expect(items.map((item) => item.technicianId)).toContain(ids.assistantId);
    } finally {
      await q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [ids.assistantId]);
    }
  });
});
