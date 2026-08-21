import { DataSource } from 'typeorm';
import { City } from '../geo/entities/city.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { Area } from '../geo/entities/area.entity';
import { GeoService } from '../geo/geo.service';
import { User } from '../auth/entities/user.entity';
import { TechnicianProfile } from './entities/technician-profile.entity';
import { TechniciansService } from './technicians.service';
import { Service } from '../catalog/entities/service.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';

/**
 * ADR-0030 — سياسة إظهار المرشّحين المتعارضين جدوليًا. الاختبار ده بيغطي:
 * 1. show_unavailable_providers=false (الافتراضي): فني متعارض (شغل يوم كامل نفس اليوم) بيختفي
 *    تمامًا زي ما كان دايمًا — رجريشن صفري.
 * 2. show_unavailable_providers=true + scheduledAt نفس يوم التعارض: الفني المتعارض بيظهر بحالة
 *    schedule_conflicted، مع سبب مقروء ومعاد توافر مقترح.
 * 3. الفني الفاضي يفضل يظهر 'available' في الحالتين، أول القايمة دايمًا.
 */
describe('TechniciansService.listForServiceBooking() — سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030)', () => {
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
    serviceVisibleId: '',
    serviceHiddenId: '',
    freeUserId: '',
    freeTechId: '',
    busyUserId: '',
    busyTechId: '',
    blockingOrderId: '',
  };

  const targetDate = new Date('2027-09-15T09:00:00Z');

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [User, TechnicianProfile, City, Area, ServiceZone, Service, Order],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries LIMIT 1`);
    ids.countryId = country.id;
    const [category] = await q(`SELECT id FROM service_categories LIMIT 1`);
    ids.categoryId = category.id;

    const [city] = await q(
      `INSERT INTO cities (country_id,name_ar,name_en,slug,is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.countryId, `مدينة تعارض ظهور ${runId}`, `ConflictVisCity${runId}`, `conflict-vis-city-${runId}`],
    );
    ids.cityId = city.id;
    const [zone] = await q(
      `INSERT INTO service_zones (city_id,name_ar,name_en,is_active) VALUES ($1,$2,$3,true) RETURNING id`,
      [ids.cityId, `نطاق تعارض ظهور ${runId}`, `ConflictVisZone${runId}`],
    );
    ids.zoneId = zone.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2041${runId}`.slice(0, 15), `عميل تعارض ظهور ${runId}`],
    );
    ids.customerUserId = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUserId]);
    const [address] = await q(
      `INSERT INTO addresses (user_id,city_id,street_name,location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.customerUserId, ids.cityId, 'شارع اختبار تعارض الظهور'],
    );
    ids.addressId = address.id;

    const [serviceVisible] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active,show_unavailable_providers)
       VALUES ($1,$2,$3,'fixed',10000,true,true) RETURNING id`,
      [ids.categoryId, `خدمة إظهار متعارض ${runId}`, `conflict-vis-service-shown-${runId}`],
    );
    ids.serviceVisibleId = serviceVisible.id;
    const [serviceHidden] = await q(
      `INSERT INTO services (category_id,name_ar,slug,pricing_model,base_price_cents,is_active)
       VALUES ($1,$2,$3,'fixed',10000,true) RETURNING id`,
      [ids.categoryId, `خدمة عادية تعارض ${runId}`, `conflict-vis-service-hidden-${runId}`],
    );
    ids.serviceHiddenId = serviceHidden.id;

    const [freeUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2042${runId}`.slice(0, 15),
      `فني فاضي ${runId}`,
    ]);
    ids.freeUserId = freeUser.id;
    const [freeTech] = await q(
      `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
       VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.freeUserId, `CVF${runId}`.slice(0, 20)],
    );
    ids.freeTechId = freeTech.id;

    const [busyUser] = await q(`INSERT INTO users (phone_number,full_name,user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2043${runId}`.slice(0, 15),
      `فني مشغول ${runId}`,
    ]);
    ids.busyUserId = busyUser.id;
    const [busyTech] = await q(
      `INSERT INTO technician_profiles (user_id,technician_code,national_id_encrypted,verification_status,current_level,current_location)
       VALUES ($1,$2,'x','approved','new', ST_SetSRID(ST_MakePoint(31.24,30.04),4326)::geography) RETURNING id`,
      [ids.busyUserId, `CVB${runId}`.slice(0, 20)],
    );
    ids.busyTechId = busyTech.id;

    for (const technicianId of [ids.freeTechId, ids.busyTechId]) {
      for (const serviceId of [ids.serviceVisibleId, ids.serviceHiddenId]) {
        await q(`INSERT INTO technician_services (technician_id,service_id,is_active) VALUES ($1,$2,true)`, [technicianId, serviceId]);
      }
      await q(`INSERT INTO technician_zones (technician_id,service_zone_id,is_active) VALUES ($1,$2,true)`, [technicianId, ids.zoneId]);
    }

    // شغل يوم كامل للفني المشغول في نفس اليوم المستهدف — نفس شرط "HEAVY" (estimated_duration_days=1).
    const [{ next_human_readable_number: orderNumber }] = await q("SELECT next_human_readable_number('ORD')");
    const [blockingOrder] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, order_type, booking_mode,
                            order_status, scheduled_at, estimated_duration_days, total_amount_cents, payment_status, placed_at, source_channel)
       VALUES ($1,$2,$3,$4,$5,'standard','individual','accepted',$6,1,10000,'unpaid', now(), 'customer_app') RETURNING id`,
      [orderNumber, customerProfile.id, ids.busyTechId, ids.serviceVisibleId, ids.addressId, targetDate],
    );
    ids.blockingOrderId = blockingOrder.id;

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
      dataSource.getRepository(Service),
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
    await q(`DELETE FROM orders WHERE id = $1`, [ids.blockingOrderId]);
    await q(`DELETE FROM technician_zones WHERE technician_id IN ($1,$2)`, [ids.freeTechId, ids.busyTechId]);
    await q(`DELETE FROM technician_services WHERE technician_id IN ($1,$2)`, [ids.freeTechId, ids.busyTechId]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1,$2)`, [ids.freeTechId, ids.busyTechId]);
    await q(`DELETE FROM customer_profiles WHERE user_id = $1`, [ids.customerUserId]);
    await q(`DELETE FROM addresses WHERE id=$1`, [ids.addressId]);
    await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUserId, ids.freeUserId, ids.busyUserId]);
    await q(`DELETE FROM services WHERE id IN ($1,$2)`, [ids.serviceVisibleId, ids.serviceHiddenId]);
    await q(`DELETE FROM service_zones WHERE id=$1`, [ids.zoneId]);
    await q(`DELETE FROM cities WHERE id=$1`, [ids.cityId]);
    await dataSource.destroy();
  });

  it('show_unavailable_providers=false (الافتراضي): الفني المتعارض بيختفي تمامًا — رجريشن صفري', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceHiddenId, ids.addressId, undefined, targetDate);
    const technicianIds = items.map((i) => i.technicianId);
    expect(technicianIds).toContain(ids.freeTechId);
    expect(technicianIds).not.toContain(ids.busyTechId);
  });

  it('show_unavailable_providers=true + نفس يوم التعارض: الفني المشغول بيظهر schedule_conflicted بسبب ومعاد توافر', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceVisibleId, ids.addressId, undefined, targetDate);
    const free = items.find((i) => i.technicianId === ids.freeTechId);
    const busy = items.find((i) => i.technicianId === ids.busyTechId);
    expect(free).toBeDefined();
    expect(free?.availabilityStatus).toBe('available');
    expect(busy).toBeDefined();
    expect(busy?.availabilityStatus).toBe('schedule_conflicted');
    expect(busy?.unavailableReasonAr).toBeTruthy();
    expect(busy?.availableAgainAt).not.toBeNull();
    // المتاح لازم يفضل قبل المتعارض في القايمة.
    expect(items.indexOf(free!)).toBeLessThan(items.indexOf(busy!));
  });

  it('show_unavailable_providers=true بس بلا scheduledAt: صفر استعلام إضافي، صفر متعارضين في الرد', async () => {
    const { items } = await service.listForServiceBooking(ids.serviceVisibleId, ids.addressId);
    const technicianIds = items.map((i) => i.technicianId);
    expect(technicianIds).toContain(ids.freeTechId);
    expect(items.every((i) => i.availabilityStatus === 'available')).toBe(true);
  });
});
