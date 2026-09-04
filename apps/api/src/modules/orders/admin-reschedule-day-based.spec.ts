// ADR-0034 (docs/08 §56 بند 1) — إعادة الجدولة باليوم. البَقّة اللي الاختبار ده بيغطيها كانت
// حقيقية ومبلّغة من المالك بسكرين شوت: لوحة إعادة الجدولة في الأدمن بتقول "مفيش مواعيد متاحة
// للفني ده حاليًا" لأنها كانت بتعتمد على صفوف سلوت صريحة، وADR-0017 خلّى غياب الصف = متاح.
// كل اللي تحت بيتنفّذ على Postgres حقيقي — استعلام التوافر الموحّد نفسه هو الشيء المُختبَر.
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Address } from '../customers/entities/address.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechniciansService } from '../technicians/technicians.service';
import { User } from '../auth/entities/user.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';

jest.setTimeout(60_000);

describe('OrdersService — إعادة الجدولة باليوم (ADR-0034)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    city: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
    adminUser: '',
  };

  const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

  const dayFromNow = (offset: number) => {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    return new Date(day.getTime() + offset * 24 * 60 * 60 * 1000);
  };

  async function insertOrder(label: string, scheduledAt: Date | null, status = OrderStatus.ACCEPTED) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, scheduled_at, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,30000,0) RETURNING id`,
      [`TESTRSDB-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, status, scheduledAt],
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
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      country.id,
      `مدينة ADR34 ${runId}`,
      `ADR34 City ${runId}`,
      `city-rsdb-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق ADR34 ${runId}`,
      `ADR34 Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة ADR34 ${runId}`,
      `ADR34 Category ${runId}`,
      `cat-rsdb-${runId}`,
    ]);
    ids.category = category.id;
    // مدة > full_day_job_minutes (360) عمدًا — عشان تعارض "يوم كامل" يتفعّل فعلاً في الاختبار التالت.
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days, estimated_duration_minutes)
       VALUES ($1,$2,$3,'formula',30000,20,0,480) RETURNING id`,
      [category.id, `خدمة ADR34 ${runId}`, `svc-rsdb-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2050${runId}`.slice(0, 15),
      `عميل ADR34 ${runId}`,
      `cust-rsdb-${runId}@test.local`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location) VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع ADR34 ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2051${runId}`.slice(0, 15),
      `فني ADR34 ${runId}`,
    ]);
    ids.techUser = techUser.id;
    // فني مؤهّل بالكامل: معتمد + عنده موقع حالي + مربوط بالخدمة والمنطقة — كل شروط الأهلية
    // الأساسية اللي technicianAvailabilityCondition() بتفترضها موجودة.
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level, verification_status, current_location)
       VALUES ($1,$2,'x',3,'new','approved', ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.techUser, `TCRSDB${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status) VALUES ($1,$2,true,'approved')`,
      [ids.techProfile, ids.service],
    );
    await q(`INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true)`, [ids.techProfile, ids.zone]);

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2052${runId}`.slice(0, 15),
      `أدمن ADR34 ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    // settingsService حقيقي الاستدعاء (hasEligibleTechnicianForDate بتنادي getNumber فعليًا —
    // stub فاضي بيرمي TypeError، بَقّة اتلقطت قبل كده في نفس فئة الاختبارات دي).
    const settingsService = { getNumber: async (_key: string, fallback: number) => fallback } as never;
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never,
      {} as never,
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      settingsService,
    );
    const addressesService = {
      findByIdOrThrow: (addressId: string) => dataSource.getRepository(Address).findOneByOrFail({ id: addressId }),
    } as never;
    const geoService = { findZoneForPoint: async () => ({ id: ids.zone }) } as never;

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      {} as never,
      dataSource,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource),
      addressesService,
      {} as never,
      geoService,
      techniciansService,
      {} as never,
      new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot)),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsService,
      {} as never,
      {} as never,
      new EventEmitter2(),
      {} as never,
      commissionBaseServiceStub(),
    );
  });

  afterEach(async () => {
    await q(`DELETE FROM notifications WHERE reference_type = 'order' AND reference_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
    // محادثة الطلب بتتعمل من مستمع وقت إعادة الجدولة — من غير مسحها الـFK بيفشّل حذف
    // الطلبات، فطلبات الاختبار الأول بتفضل مربوطة بالفني وتخلّي كل اختبار بعده يترفض
    // بـ«الفني مش متاح».
    
    await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%'))`);
    await q(`DELETE FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
    await q(`DELETE FROM orders WHERE order_number LIKE 'TESTRSDB-%'`);
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM notifications WHERE reference_type = 'order' AND reference_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
      await q(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%'))`);
      await q(`DELETE FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE 'TESTRSDB-%')`);
      await q(`DELETE FROM orders WHERE order_number LIKE 'TESTRSDB-%'`);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_services WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM technician_zones WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [ids.customerUser, ids.techUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('طلب بلا أي صف سلوت (الحالة الافتراضية بعد ADR-0017) بيتعاد جدولته بنجاح — ده اللي كان مستحيل قبل الإصلاح', async () => {
    const orderId = await insertOrder(`nosl-${runId}`, dayFromNow(3));
    const target = dayFromNow(5);

    const updated = await ordersService.rescheduleByAdmin(
      ids.adminUser,
      orderId,
      { newScheduledAt: target.toISOString() },
      'العميل اتصل يطلب تأجيل الميعاد',
    );

    expect(updated.scheduledAt?.toISOString().slice(0, 10)).toBe(target.toISOString().slice(0, 10));
    const [row] = await q(`SELECT scheduled_at FROM orders WHERE id = $1`, [orderId]);
    expect(new Date(row.scheduled_at).toISOString().slice(0, 10)).toBe(target.toISOString().slice(0, 10));
    const [history] = await q(`SELECT change_source, reason FROM order_status_history WHERE order_id = $1`, [orderId]);
    expect(history.change_source).toBe('admin');
    expect(history.reason).toContain('إعادة جدولة');
    const notifications = await q(
      `SELECT user_id, notification_type, channel, deep_link
       FROM notifications
       WHERE reference_type = 'order' AND reference_id = $1 AND notification_type = 'order_rescheduled'`,
      [orderId],
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        user_id: ids.customerUser,
        notification_type: 'order_rescheduled',
        channel: 'in_app',
        deep_link: `/orders/${orderId}`,
      }),
    ]);
  });

  it('إعادة الجدولة تحرك الفترة كاملة وتحافظ على السعر، أو تعتمد نهاية جديدة صريحة', async () => {
    const originalStart = new Date(dayFromNow(3).getTime() + 10 * 60 * 60_000);
    const originalEnd = new Date(originalStart.getTime() + 8 * 60 * 60_000);
    const orderId = await insertOrder(`interval-${runId}`, originalStart);
    await q(
      `UPDATE orders
       SET scheduled_end_at=$2, duration_minutes=480, duration_hours=8
       WHERE id=$1`,
      [orderId, originalEnd],
    );

    const movedStart = new Date(dayFromNow(5).getTime() + 12 * 60 * 60_000);
    const moved = await ordersService.rescheduleByAdmin(
      ids.adminUser,
      orderId,
      { newScheduledAt: movedStart.toISOString() },
      'تحريك الفترة كاملة',
    );
    expect(moved.scheduledAt).toEqual(movedStart);
    expect(moved.scheduledEndAt).toEqual(new Date(movedStart.getTime() + 8 * 60 * 60_000));
    expect(moved.durationMinutes).toBe(480);
    expect(moved.totalAmountCents).toBe(30000);

    const explicitStart = new Date(dayFromNow(6).getTime() + 12 * 60 * 60_000);
    const explicitEnd = new Date(explicitStart.getTime() + 6 * 60 * 60_000);
    const resized = await ordersService.rescheduleByAdmin(
      ids.adminUser,
      orderId,
      { newScheduledAt: explicitStart.toISOString(), newScheduledEndAt: explicitEnd.toISOString() },
      'اعتماد فترة جديدة',
    );
    expect(resized.scheduledEndAt).toEqual(explicitEnd);
    expect(resized.durationMinutes).toBe(360);
    expect(resized.durationHours).toBe(6);
    expect(resized.totalAmountCents).toBe(30000);
  });

  it('يوم فيه استثناء blocked صريح من الفني بيترفض — نفس محرك التوافر الموحّد، بلا فحص منفصل', async () => {
    const orderId = await insertOrder(`blk-${runId}`, dayFromNow(3));
    const target = dayFromNow(6);
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, $2, '00:00', '23:59:59', 'blocked')`,
      [ids.techProfile, target.toISOString().slice(0, 10)],
    );

    await expect(
      ordersService.rescheduleByAdmin(ids.adminUser, orderId, { newScheduledAt: target.toISOString() }, 'تأجيل ليوم إجازة الفني'),
    ).rejects.toThrow(/مش متاح في اليوم ده/);
  });

  it('يوم فيه طلب تاني "يوم كامل" لنفس الفني بيترفض، والطلب مابيتعارضش مع نفسه', async () => {
    const orderId = await insertOrder(`self-${runId}`, dayFromNow(3));
    const busyDay = dayFromNow(7);
    await insertOrder(`other-${runId}`, busyDay);

    await expect(
      ordersService.rescheduleByAdmin(ids.adminUser, orderId, { newScheduledAt: busyDay.toISOString() }, 'تأجيل ليوم مشغول'),
    ).rejects.toThrow(/مش متاح في اليوم ده/);

    // نفس اليوم الأصلي للطلب: لو الطلب كان بيتعارض مع نفسه، ده كان هيفشل — وده كان هيكسر أي
    // إعادة جدولة "لنفس اليوم بوقت تاني" تمامًا.
    const sameDay = dayFromNow(3);
    const updated = await ordersService.rescheduleByAdmin(
      ids.adminUser,
      orderId,
      { newScheduledAt: sameDay.toISOString() },
      'تثبيت نفس اليوم',
    );
    expect(updated.scheduledAt?.toISOString().slice(0, 10)).toBe(sameDay.toISOString().slice(0, 10));
  });

  it('listRescheduleOptions بترجع أيام حقيقية، والمشغول منها معلّم available=false', async () => {
    const orderId = await insertOrder(`opts-${runId}`, dayFromNow(1));
    const blockedDay = dayFromNow(4).toISOString().slice(0, 10);
    await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, $2, '00:00', '23:59:59', 'blocked')`,
      [ids.techProfile, blockedDay],
    );

    const options = await ordersService.listRescheduleOptions(orderId, 7);

    expect(options).toHaveLength(7);
    expect(options.find((o) => o.date === blockedDay)?.available).toBe(false);
    expect(options.filter((o) => o.available).length).toBeGreaterThan(0);
  });

  it('العميل صاحب الطلب يشوف نفس أيام الإتاحة الافتراضية، وأي مستخدم تاني يترفض', async () => {
    const orderId = await insertOrder(`custopts-${runId}`, dayFromNow(2));

    const options = await ordersService.listRescheduleOptionsForCustomer(ids.customerUser, orderId);

    expect(options).toHaveLength(14);
    expect(options.some((option) => option.available)).toBe(true);
    await expect(ordersService.listRescheduleOptionsForCustomer(ids.adminUser, orderId)).rejects.toThrow();
  });

  it('بعت الاتنين مع بعض أو ولا واحد فيهم = رفض واضح', async () => {
    const orderId = await insertOrder(`both-${runId}`, dayFromNow(2));
    await expect(ordersService.rescheduleByAdmin(ids.adminUser, orderId, {}, 'بلا موعد')).rejects.toThrow(/واحد بس/);
    await expect(
      ordersService.rescheduleByAdmin(
        ids.adminUser,
        orderId,
        { newSlotId: '00000000-0000-0000-0000-000000000001', newScheduledAt: dayFromNow(3).toISOString() },
        'الاتنين',
      ),
    ).rejects.toThrow(/واحد بس/);
  });
});
