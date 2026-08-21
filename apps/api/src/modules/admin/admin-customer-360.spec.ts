import { DataSource } from 'typeorm';
import { GeoService } from '../geo/geo.service';
import { AddressesService } from '../customers/addresses.service';
import { Address } from '../customers/entities/address.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { AdminCustomer360Service } from './admin-customer-360.service';

// اختبار حي ضد Postgres حقيقي — بروفايل عميل 360° (docs/08 §35.15). عميل واحد مصمّم يمثّل كل
// الأبعاد الجديدة اللي الكارت ده بيضيفها فوق صفحة العميل الأساسية: عنوان، طلب حالي/قادم، شكوى
// رفعها هو (filed_by_user_id)، شكوى اتقالت عليه (against_user_id)، وتقييم استلمه من فني.
describe('AdminCustomer360Service — بروفايل عميل 360° (docs/08 §35.15)', () => {
  let dataSource: DataSource;
  let service: AdminCustomer360Service;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerProfile: '',
    address: '',
    customerUser: '',
    techUser: '',
    techProfile: '',
    order: '',
    complaintFiled: '',
    complaintAgainst: '',
    rating: '',
  };
  const users: string[] = [];

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Address, CustomerProfile, Order],
    });
    await dataSource.initialize();
    const addressesService = new AddressesService(
      dataSource.getRepository(Address),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(Order),
      {} as unknown as GeoService,
    );
    service = new AdminCustomer360Service(dataSource, addressesService);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة ك360 ${runId}`, `C360 Country ${runId}`, 'K' + runId.slice(-1).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`, [
      ids.country,
      `مدينة ك360 ${runId}`,
      `C360 City ${runId}`,
      `test-c360-city-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق ك360 ${runId}`,
      `C360 Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ك360 ${runId}`,
      `C360 Category ${runId}`,
      `test-c360-category-${runId}`,
    ]);
    ids.category = category.id;
    const [service_] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة ك360 ${runId}`, `test-c360-service-${runId}`],
    );
    ids.service = service_.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2037${runId}`.slice(0, 15),
      `عميل ك360 ${runId}`,
    ]);
    users.push(customerUser.id);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [customerUser.id]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.26, 30.06), 4326)::geography) RETURNING id`,
      [customerUser.id, `شارع ك360 ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2036${runId}`.slice(0, 15),
      `فني ك360 ${runId}`,
    ]);
    users.push(techUser.id);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, is_available)
       VALUES ($1,$2,'x',5,'professional','approved',true) RETURNING id`,
      [techUser.id, `TC360K${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    // طلب "حالي/قادم" للعميل — accepted، الفني ده معيّن عليه.
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, booking_mode)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0,'individual') RETURNING id`,
      [`TESTC360-${runId}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    // شكوى العميل رفعها على الفني.
    const [complaintFiled] = await q(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category, severity, title, description, complaint_status, sla_due_at)
       VALUES ($1,$2,$3,$4,'poor_quality','medium',$5,$6,'open', now() + interval '2 days') RETURNING id`,
      [`TESTCF-${runId}`.slice(0, 24), ids.order, customerUser.id, techUser.id, `شكوى رفعها العميل ${runId}`, `تفاصيل ${runId}`],
    );
    ids.complaintFiled = complaintFiled.id;

    // شكوى اتقالت على العميل (من الفني)، متحلّة.
    const [complaintAgainst] = await q(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category, severity, title, description, complaint_status, resolved_at, sla_due_at)
       VALUES ($1,$2,$3,$4,'rude_behavior','low',$5,$6,'resolved', now(), now() + interval '2 days') RETURNING id`,
      [`TESTCA-${runId}`.slice(0, 24), ids.order, techUser.id, customerUser.id, `شكوى ضد العميل ${runId}`, `تفاصيل ${runId}`],
    );
    ids.complaintAgainst = complaintAgainst.id;

    // تقييم استلمه العميل من الفني.
    const [rating] = await q(
      `INSERT INTO ratings (order_id, rated_by_user_id, rated_user_id, rating_type, overall_rating)
       VALUES ($1,$2,$3,'technician_to_customer',4) RETURNING id`,
      [ids.order, techUser.id, customerUser.id],
    );
    ids.rating = rating.id;
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM ratings WHERE id = $1`, [ids.rating]);
      await q(`DELETE FROM complaints WHERE id IN ($1,$2)`, [ids.complaintFiled, ids.complaintAgainst]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      if (users.length) await q(`DELETE FROM users WHERE id = ANY($1)`, [users]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('getProfile() — الأبعاد الجديدة كلها بتتحسب صح من نفس المصادر الحقيقية', async () => {
    const p = await service.getProfile(ids.customerUser);

    expect(p.addresses).toHaveLength(1);
    expect(p.addresses[0].id).toBe(ids.address);

    expect(p.currentAndUpcomingOrders).toHaveLength(1);
    expect(p.currentAndUpcomingOrders[0].orderId).toBe(ids.order);

    expect(p.complaintsFiled.totalCount).toBe(1);
    expect(p.complaintsFiled.openCount).toBe(1);
    expect(p.complaintsFiled.recent).toHaveLength(1);
    expect(p.complaintsFiled.recent[0].id).toBe(ids.complaintFiled);

    expect(p.complaintsAgainst.totalCount).toBe(1);
    expect(p.complaintsAgainst.openCount).toBe(0);
    expect(p.complaintsAgainst.recent).toHaveLength(1);
    expect(p.complaintsAgainst.recent[0].id).toBe(ids.complaintAgainst);

    expect(p.ratingsReceived.totalCount).toBe(1);
    expect(p.ratingsReceived.averageRating).toBe(4);
  });

  it('getProfile() — عميل بلا أي بيانات (مستخدم مش موجود) بيرجّع مجموعات فاضية بدل ما يفشل', async () => {
    const p = await service.getProfile('00000000-0000-0000-0000-000000000000');
    expect(p.addresses).toHaveLength(0);
    expect(p.currentAndUpcomingOrders).toHaveLength(0);
    expect(p.complaintsFiled.totalCount).toBe(0);
    expect(p.complaintsAgainst.totalCount).toBe(0);
    expect(p.ratingsReceived.totalCount).toBe(0);
    expect(p.ratingsReceived.averageRating).toBeNull();
  });
});
