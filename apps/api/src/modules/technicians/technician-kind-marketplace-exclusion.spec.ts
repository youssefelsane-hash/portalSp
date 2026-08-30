import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';

// اختبار حي ضد Postgres حقيقي — ADR-0055 / docs/08 §104 (تصحيح مالك مباشر).
//
// **القاعدة اتقلبت**: ADR-0050 كان بيستبعد المساعد من قايمة اختيار العميل على أساس إنه «معندهوش
// الخبرة الكافية ياخد شغلانة لوحده». المالك صحّح الفهم — «المساعد» نوع شغل مختلف (نقل، شيل،
// تنزيل) بيعمله لوحده عادي، مش مستوى مهارة أقل. فالاستبعاد على أساس الدور اتشال بالكامل،
// و**حجب الأدمن للخدمة بقى أداة التحكم الوحيدة** (ADR-0054).
//
// الفني والمساعد في الاختبار ده متطابقين تمامًا ماعدا `technician_kind` — عشان أي فرق في النتيجة
// يبقى سببه الدور بالظبط، مش أي حاجة تانية.
describe('TechniciansService.listForServiceBooking() — المساعد بيظهر زي الفني (ADR-0055)', () => {
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

  // ADR-0055 (تصحيح مالك) — الاختبار ده كان بيقفل على العكس بالظبط («المساعد مايظهرش»). المالك
  // صحّح الفهم: «المساعد» نوع شغل مختلف مش مستوى مهارة أقل، وطالما الأدمن ما حجبش عنه الخدمة
  // فهو زي الفني بالظبط في كل حتة. الاختبار اتعاد كتابته ليقفل على القاعدة الجديدة.
  it('المساعد والفني الاتنين بيظهروا في قايمة اختيار العميل — مفيش استبعاد على أساس الدور', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceId, ids.addressId);
    const technicianIds = items.map((item) => item.technicianId);
    expect(technicianIds).toContain(ids.technicianId);
    expect(technicianIds).toContain(ids.assistantId);
  });

  it('حجب الأدمن للخدمة هو أداة التحكم الوحيدة — بيشيل المساعد من القايمة، ورفعه بيرجّعه', async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [admin] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
      [`+2097${Date.now().toString(36)}`.slice(0, 15), 'أدمن حجب اختبار'],
    );
    try {
      await q(
        `INSERT INTO technician_excluded_services (technician_id, service_id, excluded_by_user_id, reason)
         VALUES ($1,$2,$3,'اختبار')`,
        [ids.assistantId, ids.serviceId, admin.id],
      );
      const blocked = await service.listForServiceBooking(ids.serviceId, ids.addressId);
      expect(blocked.items.map((i) => i.technicianId)).not.toContain(ids.assistantId);
      // الفني ما اتأثرش بحجب المساعد.
      expect(blocked.items.map((i) => i.technicianId)).toContain(ids.technicianId);

      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1 AND service_id = $2`, [
        ids.assistantId,
        ids.serviceId,
      ]);
      const allowed = await service.listForServiceBooking(ids.serviceId, ids.addressId);
      expect(allowed.items.map((i) => i.technicianId)).toContain(ids.assistantId);
    } finally {
      await q(`DELETE FROM technician_excluded_services WHERE technician_id = $1`, [ids.assistantId]);
      await q(`DELETE FROM users WHERE id = $1`, [admin.id]);
    }
  });

  it('ترقية المساعد لفني ما بتغيّرش ظهوره — الدور قابل للتغيير في الاتجاهين وبقى مالوش أثر على الظهور', async () => {
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
