import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { MatchingService } from './matching.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { OrderAssignment } from './entities/order-assignment.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianAssignmentGuardService } from '../technicians/technician-assignment-guard.service';

// اختبار حي ضد Postgres حقيقي (ADR-0018 §7، طلب صريح من المالك 2026-08-19) — بيثبت إن موازنة
// الحِمل فعليًا بتأثّر على ترتيب findEligibleTechnicians() مش بس موجودة في الكود بلا تأثير: فنيين
// اتنين بنفس المستوى (order_priority_weight متساوي) وبنفس الموقع بالظبط (نفس إحداثيات، فمسافة
// متساوية كمان) — الفني الأقل حِملاً لازم يترتّب أول واحد، رغم إن أي معيار تاني (مستوى/مسافة) بينهم
// متساوي تمامًا. الطلب المرشّح هنا **مجدول** (له scheduledAt بعيد) عمدًا — طلب ASAP عادي كان
// هيستبعد الفني المشغول بالكامل من الأساس (ACTIVE_TECHNICIAN_ORDER_STATUSES)، فمكانش هيبان فرق
// الترتيب خالص؛ الطلب المجدول بيسمح للفني المشغول (بطلبات ASAP حالية بلا scheduledAt) يفضل مؤهّل.
describe('MatchingService.findEligibleTechnicians() — موازنة الحِمل بين فنيين متساويين (ADR-0018 §7)', () => {
  let dataSource: DataSource;
  let matchingService: MatchingService;

  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    technicianAProfile: '',
    technicianBProfile: '',
  };
  const busyOrderIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderAssignment, OrderStatusHistory, TechnicianProfile],
    });
    await dataSource.initialize();

    matchingService = new MatchingService(
      dataSource.getRepository(OrderAssignment),
      dataSource.getRepository(Order),
      dataSource,
      {} as never,
      new TechnicianAssignmentGuardService({ getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never),
      { getNumber: jest.fn(async (_key: string, fallback: number) => fallback) } as never,
      { emit: jest.fn() } as never,
      { add: jest.fn().mockResolvedValue(undefined) } as never,
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    if (!country) throw new Error('The workload-balance fixture requires the seeded EG country');
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-wl-${runId}`],
    );
    ids.city = city.id;

    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;

    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار ${runId}`,
      `Test Category ${runId}`,
      `test-category-wl-${runId}`,
    ]);
    ids.category = category.id;

    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-wl-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2012${runId}`.slice(0, 14),
      `عميل اختبار ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    // فنيين اتنين بنفس المستوى وبنفس موقع العنوان بالظبط — أي فرق في الترتيب لازم يبقى مصدره
    // موازنة الحِمل بس، مش المستوى ولا المسافة.
    const makeTechnician = async (label: string) => {
      const [user] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
        `+2013${label}${runId}`.slice(0, 14),
        `فني اختبار ${label} ${runId}`,
      ]);
      const [profile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1,$2,'new','approved',true,true, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography)
         RETURNING id`,
        [user.id, `WL${label}${runId}`.slice(0, 20)],
      );
      await q(`INSERT INTO technician_services (technician_id, service_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.service]);
      await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [profile.id, ids.zone]);
      return profile.id as string;
    };

    ids.technicianAProfile = await makeTechnician('A');
    ids.technicianBProfile = await makeTechnician('B');

    // فني A بس عنده طلبين ASAP نشطين (accepted، بلا scheduledAt) — فني B مفيش عنده حاجة خالص.
    for (let i = 0; i < 2; i += 1) {
      const [busyOrder] = await q(
        `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status)
         VALUES ($1,$2,$3,$4,$5,$6,'accepted') RETURNING id`,
        [`WLBUSY-${i}-${runId}`.slice(0, 24), ids.customerProfile, ids.technicianAProfile, ids.service, ids.address, ids.zone],
      );
      busyOrderIds.push(busyOrder.id as string);
    }
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [busyOrderIds]);
      await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.technicianAProfile, ids.technicianBProfile]);
      await q(`DELETE FROM users WHERE id IN (SELECT user_id FROM technician_profiles WHERE id IN ($1,$2))`, [
        ids.technicianAProfile,
        ids.technicianBProfile,
      ]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await dataSource.destroy();
    }
  });

  it('فني أقل حِملاً بيترتّب قبل فني مشغول رغم تساوي المستوى والمسافة تمامًا', async () => {
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const order = {
      id: randomUUID(),
      serviceId: ids.service,
      serviceZoneId: ids.zone,
      addressId: ids.address,
      scheduledAt: weekFromNow,
    } as Order;

    const candidates = await (
      matchingService as unknown as { findEligibleTechnicians: (...args: unknown[]) => Promise<{ technician_id: string }[]> }
    ).findEligibleTechnicians(order, 50, null, false, null);

    const technicianIds = candidates.map((c) => c.technician_id);
    expect(technicianIds).toContain(ids.technicianAProfile);
    expect(technicianIds).toContain(ids.technicianBProfile);

    const indexA = technicianIds.indexOf(ids.technicianAProfile);
    const indexB = technicianIds.indexOf(ids.technicianBProfile);
    expect(indexB).toBeLessThan(indexA);
  });
});
