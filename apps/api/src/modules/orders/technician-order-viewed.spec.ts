// docs/08 §56 بند 2 — "جديد ولا اتفتح؟". بلاغ المالك: التطبيق مالوش يعرض طلب بعيد بشكل بارز أول
// ما يفتح، وبدلها تمييز بين الجديد واللي اتفتح. الحالة دي server-side عمدًا (مش تخزين محلي)
// عشان تفضل صحيحة بعد إعادة تثبيت التطبيق أو الدخول من جهاز تاني.
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Address } from '../customers/entities/address.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { User } from '../auth/entities/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';

jest.setTimeout(60_000);

describe('OrdersService.markViewedByTechnician() (docs/08 §56 بند 2)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '', city: '', category: '', service: '', customerUser: '', customerProfile: '',
    address: '', techUser: '', techProfile: '', otherTechUser: '', otherTechProfile: '',
  };
  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  async function insertOrder(label: string, technicianId: string | null) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0) RETURNING id`,
      [`TESTVIEW-${label}`.slice(0, 24), ids.customerProfile, technicianId, ids.service, ids.address, ids.zone],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, CustomerProfile, Address, TechnicianProfile, TechnicianCompany, TechnicianScheduleSlot, User],
    });
    await dataSource.initialize();
    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [country.id, `مدينة VIEW ${runId}`, `View City ${runId}`, `city-view-${runId}`]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [city.id, `نطاق VIEW ${runId}`, `View Zone ${runId}`]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [`فئة VIEW ${runId}`, `View Cat ${runId}`, `cat-view-${runId}`]);
    ids.category = category.id;
    const [service_] = await q(`INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days) VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`, [category.id, `خدمة VIEW ${runId}`, `svc-view-${runId}`]);
    ids.service = service_.id;
    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [`+2060${runId}`.slice(0, 15), `عميل VIEW ${runId}`]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(`INSERT INTO addresses (user_id, city_id, street_name, location) VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`, [ids.customerUser, ids.city, `شارع VIEW ${runId}`]);
    ids.address = address.id;
    const [u1] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [`+2061${runId}`.slice(0, 15), `فني VIEW A ${runId}`]);
    ids.techUser = u1.id;
    const [p1] = await q(`INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status) VALUES ($1,$2,'x',3,'new','approved') RETURNING id`, [u1.id, `TCVA${runId}`.slice(0, 20)]);
    ids.techProfile = p1.id;
    const [u2] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [`+2062${runId}`.slice(0, 15), `فني VIEW B ${runId}`]);
    ids.otherTechUser = u2.id;
    const [p2] = await q(`INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status) VALUES ($1,$2,'x',3,'new','approved') RETURNING id`, [u2.id, `TCVB${runId}`.slice(0, 20)]);
    ids.otherTechProfile = p2.id;

    service = new OrdersService(
      dataSource.getRepository(Order), {} as never, {} as never, dataSource,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource),
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
      new EventEmitter2(), {} as never,
      commissionBaseServiceStub(),
    );
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTVIEW-%')`);
      await q(`DELETE FROM orders WHERE order_number LIKE 'TESTVIEW-%'`);
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [[ids.techProfile, ids.otherTechProfile]]);
      await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[ids.customerUser, ids.techUser, ids.otherTechUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('أول فتح بيعلّم الطلب، والفتحات اللي بعدها مابتغيّرش التوقيت الأصلي', async () => {
    const orderId = await insertOrder(`first-${runId}`, ids.techProfile);
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });
    expect(order.technicianViewedAt).toBeNull();

    await service.markViewedByTechnician(order, ids.techProfile);
    const [afterFirst] = await q(`SELECT technician_viewed_at FROM orders WHERE id = $1`, [orderId]);
    expect(afterFirst.technician_viewed_at).not.toBeNull();

    // نداء تاني بنسخة قديمة من الكيان (لسه فاكرة null) — الشرط IS NULL في الـSQL هو الحارس الحقيقي.
    await service.markViewedByTechnician(order, ids.techProfile);
    const [afterSecond] = await q(`SELECT technician_viewed_at FROM orders WHERE id = $1`, [orderId]);
    expect(new Date(afterSecond.technician_viewed_at).getTime()).toBe(new Date(afterFirst.technician_viewed_at).getTime());
  });

  it('فني تاني (مش المعيّن) مابيعلّمش الطلب نيابة عن صاحبه', async () => {
    const orderId = await insertOrder(`other-${runId}`, ids.techProfile);
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });

    await service.markViewedByTechnician(order, ids.otherTechProfile);

    const [row] = await q(`SELECT technician_viewed_at FROM orders WHERE id = $1`, [orderId]);
    expect(row.technician_viewed_at).toBeNull();
  });

  it('بيحوّل order_assignments المعلّق من sent لـviewed — القيمة دي مكانش حد بيكتبها أبدًا قبل كده', async () => {
    const orderId = await insertOrder(`assign-${runId}`, ids.techProfile);
    await q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status, sent_at, expires_at)
       VALUES ($1,$2,1,'sent', now(), now() + interval '5 minutes')`,
      [orderId, ids.techProfile],
    );
    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });

    await service.markViewedByTechnician(order, ids.techProfile);

    const [assignment] = await q(`SELECT assignment_status FROM order_assignments WHERE order_id = $1`, [orderId]);
    expect(assignment.assignment_status).toBe('viewed');
  });
});
