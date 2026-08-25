import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { AddressesService } from '../customers/addresses.service';
import { Address } from '../customers/entities/address.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from '../technicians/entities/technician-schedule-slot.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';

// اختبار حي ضد Postgres حقيقي — إعادة جدولة + تحذير تغيير العنوان (docs/08 §22 بند 9-12).
describe('OrdersService.reschedule() + AddressesService.hasActiveOrder() (docs/08 §22 بند 9-12)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let addressesService: AddressesService;
  let scheduleService: TechnicianScheduleService;
  let cache: RedisCacheService;
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
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
    techUser: '',
    techProfile: '',
    adminUser: '',
  };

  async function insertOrder(label: string, orderStatus: OrderStatus) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0) RETURNING id`,
      [`TESTRSC-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, orderStatus],
    );
    return order.id as string;
  }

  async function insertSlot(label: string, status: TechnicianScheduleSlotStatus, orderId: string | null, startTime: string) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [slot] = await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status, order_id)
       VALUES ($1, CURRENT_DATE + 1, $2, $3, $4, $5) RETURNING id`,
      [ids.techProfile, startTime, `${(Number(startTime.slice(0, 2)) + 1).toString().padStart(2, '0')}:00`, status, orderId],
    );
    return slot.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order,
        OrderStatusHistory,
        Payment,
        Refund,
        User,
        WebhookEvent,
        Wallet,
        WalletTransaction,
        CustomerProfile,
        Address,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianScheduleSlot,
        Setting,
        Complaint,
        ComplaintMessage,
        ComplaintAttachment,
      ],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة اختبار ${runId}`,
      `Test City ${runId}`,
      `test-city-rsc-${runId}`,
    ]);
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
      `test-category-rsc-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-rsc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2030${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-rsc-${runId}@test.local`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2031${runId}`.slice(0, 15),
      `فني اختبار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.techUser, `TCRSC${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2039${runId}`.slice(0, 15),
      `أدمن اختبار إعادة جدولة ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
      {} as never, // settingsService
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    addressesService = new AddressesService(
      dataSource.getRepository(Address),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(Order),
      {} as never, // geoService — مش متنادى (صفر create/area change في الاختبار ده)
    );
    const events = new EventEmitter2();
    const supportService = new SupportService(
      dataSource.getRepository(Complaint),
      dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment),
      dataSource.getRepository(Order),
      dataSource,
      customerProfilesService,
      techniciansService,
      {} as never,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
    );

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      {} as never,
      dataSource,
      { record: auditLogRecord } as unknown as AuditLogService,
      customerProfilesService,
      {} as never,
      {} as never,
      {} as never,
      techniciansService,
      {} as never,
      scheduleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsService,
      {} as never, // paymentsService — مش متنادى (صفر cancel_with_fee في الاختبار ده)
      supportService,
      events,
      {} as never, // orderTeamService (docs/08 §35)
    );
  });

  afterEach(async () => {
    // Every test owns its fixture. Release the Phase 7 one-active-order resource before the next
    // case while preserving each assertion's state for the duration of that case.
    auditLogRecord.mockClear();
    if (dataSource?.isInitialized) {
      await dataSource.query(
        `DELETE FROM order_reschedule_requests WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`,
        [`TESTRSC-%`],
      );
      await dataSource.query(
        `DELETE FROM notifications WHERE reference_type = 'order' AND reference_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`,
        [`TESTRSC-%`],
      );
      await dataSource.query(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await dataSource.query(`UPDATE orders SET technician_id = NULL WHERE order_number LIKE $1`, [`TESTRSC-%`]);
    }
  });

  afterAll(async () => {
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(`DELETE FROM order_reschedule_requests WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRSC-%`]);
      await q(
        `DELETE FROM notifications WHERE reference_type = 'order' AND reference_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`,
        [`TESTRSC-%`],
      );
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRSC-%`]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTRSC-%`]);
      // Includes the isolated address-warning fixture even if that test failed before local cleanup.
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ids.customerUser, ids.techUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      cache?.onModuleDestroy();
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('إعادة جدولة ناجحة — السلوت القديم يرجع متاح، الجديد يتحجز، scheduledAt يتحدّث', async () => {
    const orderId = await insertOrder(`ok-${runId}`, OrderStatus.ACCEPTED);
    const oldSlotId = await insertSlot('old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('new', TechnicianScheduleSlotStatus.AVAILABLE, null, '14:00');

    const updated = await ordersService.reschedule(ids.customerUser, orderId, { new_slot_id: newSlotId });
    expect(updated.scheduledAt).not.toBeNull();

    const oldSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: oldSlotId } });
    expect(oldSlot.status).toBe(TechnicianScheduleSlotStatus.AVAILABLE);
    expect(oldSlot.orderId).toBeNull();

    const newSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: newSlotId } });
    expect(newSlot.status).toBe(TechnicianScheduleSlotStatus.BOOKED);
    expect(newSlot.orderId).toBe(orderId);
  });

  it('مينفعش تعيد جدولة بعد ما الفني يبقى في الطريق فعلاً (technician_on_way)', async () => {
    const orderId = await insertOrder(`toolate-${runId}`, OrderStatus.TECHNICIAN_ON_WAY);
    await insertSlot('toolate-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('toolate-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '15:00');

    await expect(ordersService.reschedule(ids.customerUser, orderId, { new_slot_id: newSlotId })).rejects.toThrow();
  });

  it('تصادم حجز — محاولتين متزامنتين على نفس السلوت الجديد، واحدة بس تنجح، صفر حجز مزدوج صامت', async () => {
    const orderAId = await insertOrder(`race-a-${runId}`, OrderStatus.ACCEPTED);
    // `technician_assigned` is reschedulable but does not consume the one-active-work slot yet,
    // so this fixture can still exercise the schedule-row race without violating migration 0118.
    const orderBId = await insertOrder(`race-b-${runId}`, OrderStatus.TECHNICIAN_ASSIGNED);
    const slotAOld = await insertSlot('race-a-old', TechnicianScheduleSlotStatus.BOOKED, orderAId, '09:00');
    const slotBOld = await insertSlot('race-b-old', TechnicianScheduleSlotStatus.BOOKED, orderBId, '10:00');
    const contestedSlotId = await insertSlot('race-contested', TechnicianScheduleSlotStatus.AVAILABLE, null, '16:00');

    const results = await Promise.allSettled([
      ordersService.reschedule(ids.customerUser, orderAId, { new_slot_id: contestedSlotId }),
      ordersService.reschedule(ids.customerUser, orderBId, { new_slot_id: contestedSlotId }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // اللي فشل لازم يفضل محتفظ بموعده الأصلي — صفر خسارة صامتة لسلوته القديم بسبب محاولة فشلت.
    const loserOrderId = results[0].status === 'rejected' ? orderAId : orderBId;
    const loserOldSlotId = loserOrderId === orderAId ? slotAOld : slotBOld;
    const loserOldSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: loserOldSlotId } });
    expect(loserOldSlot.status).toBe(TechnicianScheduleSlotStatus.BOOKED);
    expect(loserOldSlot.orderId).toBe(loserOrderId);
  });

  it('مينفعش تعيد جدولة لسلوت فني تاني', async () => {
    const orderId = await insertOrder(`wrongtech-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('wrongtech-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [otherTechUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2032${runId}`.slice(0, 15),
      `فني تاني ${runId}`,
    ]);
    const [otherTechProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [otherTechUser.id, `TCRSC2${runId}`.slice(0, 20)],
    );
    const [otherSlot] = await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status)
       VALUES ($1, CURRENT_DATE + 1, '11:00', '12:00', 'available') RETURNING id`,
      [otherTechProfile.id],
    );

    await expect(ordersService.reschedule(ids.customerUser, orderId, { new_slot_id: otherSlot.id })).rejects.toThrow();

    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [otherTechProfile.id]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [otherTechProfile.id]);
    await q(`DELETE FROM users WHERE id = $1`, [otherTechUser.id]);
  });

  it('الفني يقترح موعدًا ويصل للعميل كإشعار داخلي دائم من نفس المعاملة', async () => {
    const orderId = await insertOrder(`request-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('request-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const proposedSlotId = await insertSlot('request-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '14:00');

    const request = await ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
      new_slot_id: proposedSlotId,
      reason: 'عندي تعارض طارئ في الموعد الحالي',
    });

    expect(request.status).toBe('pending');
    expect(request.proposed_slot_id).toBe(proposedSlotId);
    const listed = await ordersService.listRescheduleRequestsForCustomer(ids.customerUser, orderId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: request.id, status: 'pending' });

    const notifications = await dataSource.query(
      `SELECT user_id, notification_type, channel, delivery_status
       FROM notifications WHERE reference_id = $1 AND notification_type = 'order_reschedule_requested'`,
      [orderId],
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        user_id: ids.customerUser,
        notification_type: 'order_reschedule_requested',
        channel: 'in_app',
        delivery_status: 'sent',
      }),
    ]);
  });

  it('رفض العميل يحفظ القرار ولا يغيّر الحجز أو الموعد', async () => {
    const orderId = await insertOrder(`reject-${runId}`, OrderStatus.ACCEPTED);
    const oldSlotId = await insertSlot('reject-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const proposedSlotId = await insertSlot('reject-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '14:00');
    const before = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    const request = await ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
      new_slot_id: proposedSlotId,
      reason: 'أفضل تأجيل الزيارة بسبب ازدحام الجدول',
    });

    const result = await ordersService.resolveTechnicianRescheduleRequest(
      ids.customerUser,
      orderId,
      request.id,
      'rejected',
    );

    expect(result.request.status).toBe('rejected');
    expect(result.order.scheduledAt?.getTime() ?? null).toBe(before.scheduledAt?.getTime() ?? null);
    expect((await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: oldSlotId } })).status).toBe(
      TechnicianScheduleSlotStatus.BOOKED,
    );
    expect((await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: proposedSlotId } })).status).toBe(
      TechnicianScheduleSlotStatus.AVAILABLE,
    );
  });

  it('موافقتان متزامنتان على نفس الطلب تغيّران الموعد مرة واحدة فقط', async () => {
    const orderId = await insertOrder(`approve-race-${runId}`, OrderStatus.ACCEPTED);
    const oldSlotId = await insertSlot('approve-race-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const proposedSlotId = await insertSlot('approve-race-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '15:00');
    const request = await ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
      new_slot_id: proposedSlotId,
      reason: 'أحتاج نقل الزيارة للموعد المقترح',
    });

    const attempts = await Promise.allSettled([
      ordersService.resolveTechnicianRescheduleRequest(ids.customerUser, orderId, request.id, 'approved'),
      ordersService.resolveTechnicianRescheduleRequest(ids.customerUser, orderId, request.id, 'approved'),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect((await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: oldSlotId } })).status).toBe(
      TechnicianScheduleSlotStatus.AVAILABLE,
    );
    const booked = await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: proposedSlotId } });
    expect(booked).toMatchObject({ status: TechnicianScheduleSlotStatus.BOOKED, orderId });
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM order_status_history
       WHERE order_id = $1 AND reason LIKE '%موافقة على طلب تأجيل الفني%'`,
      [orderId],
    );
    expect(count).toBe(1);
  });

  it('الحد الإداري يحسب الطلبات المحسومة ويمنع تكرار التأجيل بلا نهاية', async () => {
    const orderId = await insertOrder(`max-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('max-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const firstSlotId = await insertSlot('max-first', TechnicianScheduleSlotStatus.AVAILABLE, null, '13:00');
    const secondSlotId = await insertSlot('max-second', TechnicianScheduleSlotStatus.AVAILABLE, null, '14:00');
    const thirdSlotId = await insertSlot('max-third', TechnicianScheduleSlotStatus.AVAILABLE, null, '15:00');

    const first = await ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
      new_slot_id: firstSlotId,
      reason: 'طلب التأجيل الأول للعميل',
    });
    await ordersService.resolveTechnicianRescheduleRequest(ids.customerUser, orderId, first.id, 'rejected');
    const second = await ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
      new_slot_id: secondSlotId,
      reason: 'طلب التأجيل الثاني والأخير',
    });
    await ordersService.resolveTechnicianRescheduleRequest(ids.customerUser, orderId, second.id, 'rejected');

    await expect(
      ordersService.requestRescheduleByTechnician(ids.techUser, orderId, {
        new_slot_id: thirdSlotId,
        reason: 'طلب تأجيل ثالث يجب رفضه',
      }),
    ).rejects.toThrow('وصلت للحد الأقصى');
  });

  it('AddressesService.hasActiveOrder() — true وقت طلب نشط، false بعد ما يتقفل', async () => {
    // عنوان مخصوص منفصل عن ids.address (اللي عليه طلبات نشطة بالفعل من اختبارات إعادة الجدولة
    // فوق) — عشان الفحص يبقى معزول وواضح، مش متأثر بترتيب تنفيذ الاختبارات.
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [freshAddress] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار عنوان منعزل ${runId}`],
    );
    const freshAddressId = freshAddress.id as string;

    expect(await addressesService.hasActiveOrder(freshAddressId)).toBe(false);

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'accepted','pending',30000,0) RETURNING id`,
      [`TESTRSC-addrwarn-${runId}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, freshAddressId, ids.zone],
    );
    const orderId = order.id as string;
    expect(await addressesService.hasActiveOrder(freshAddressId)).toBe(true);

    await q(`UPDATE orders SET order_status = 'completed' WHERE id = $1`, [orderId]);
    expect(await addressesService.hasActiveOrder(freshAddressId)).toBe(false);

    await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
    await q(`DELETE FROM addresses WHERE id = $1`, [freshAddressId]);
  });
});

// إعادة جدولة عامة من الأدمن (Script 4 Part K §42) — بديل عن reschedule() فوق (مقصور على العميل
// صاحب الطلب)، ده لأي طلب بغض النظر عن هوية العميل، مع سبب إلزامي + سجل تدقيق.
describe('OrdersService.rescheduleByAdmin() (Script 4 Part K §42)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let scheduleService: TechnicianScheduleService;
  const auditLogRecord = jest.fn().mockResolvedValue(undefined);
  const runId = Date.now().toString(36);
  const ids = {
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
    adminUser: '',
  };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
  }

  async function insertOrder(label: string, orderStatus: OrderStatus) {
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',30000,0) RETURNING id`,
      [`TESTARSC-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, orderStatus],
    );
    return order.id as string;
  }

  async function insertSlot(label: string, status: TechnicianScheduleSlotStatus, orderId: string | null, startTime: string) {
    const [slot] = await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status, order_id)
       VALUES ($1, CURRENT_DATE + 1, $2, $3, $4, $5) RETURNING id`,
      [ids.techProfile, startTime, `${(Number(startTime.slice(0, 2)) + 1).toString().padStart(2, '0')}:00`, status, orderId],
    );
    return slot.id as string;
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
      `مدينة اختبار أدمن ${runId}`,
      `Admin Test City ${runId}`,
      `test-city-arsc-${runId}`,
    ]);
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      city.id,
      `نطاق اختبار أدمن ${runId}`,
      `Admin Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة اختبار أدمن ${runId}`,
      `Admin Test Category ${runId}`,
      `test-category-arsc-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [category.id, `خدمة اختبار أدمن ${runId}`, `test-service-arsc-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2040${runId}`.slice(0, 15),
      `عميل اختبار أدمن ${runId}`,
      `customer-arsc-${runId}@test.local`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location) VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار أدمن ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2041${runId}`.slice(0, 15),
      `فني اختبار أدمن ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.techUser, `TCARSC${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [adminUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2042${runId}`.slice(0, 15),
      `أدمن اختبار ${runId}`,
    ]);
    ids.adminUser = adminUser.id;

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
      {} as never, // settingsService
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never,
      {} as never,
      dataSource,
      { record: auditLogRecord } as unknown as AuditLogService,
      customerProfilesService,
      {} as never,
      {} as never,
      {} as never,
      techniciansService,
      {} as never,
      scheduleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // settingsService — مش متنادى (صفر مسار بيلمسها في rescheduleByAdmin)
      {} as never,
      {} as never,
      events,
      {} as never, // orderTeamService (docs/08 §35)
    );
  });

  afterEach(async () => {
    // بيحرر قيد "طلب نشط واحد بس لكل فني" قبل الاختبار الجاي (نفس آلية الملف اللي فوق بالحرف).
    auditLogRecord.mockClear();
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await dataSource.query(`UPDATE orders SET technician_id = NULL WHERE order_number LIKE $1`, [`TESTARSC-%`]);
    }
  });

  afterAll(async () => {
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTARSC-%`]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTARSC-%`]);
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [ids.customerUser, ids.techUser, ids.adminUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('إعادة جدولة ناجحة من الأدمن — بغض النظر عن هوية العميل، وسجل تدقيق كامل', async () => {
    const orderId = await insertOrder(`ok-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('new', TechnicianScheduleSlotStatus.AVAILABLE, null, '14:00');

    const updated = await ordersService.rescheduleByAdmin(ids.adminUser, orderId, { newSlotId }, 'العميل اتصل يطلب تأجيل الميعاد');
    expect(updated.scheduledAt).not.toBeNull();

    const newSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOneOrFail({ where: { id: newSlotId } });
    expect(newSlot.status).toBe(TechnicianScheduleSlotStatus.BOOKED);
    expect(newSlot.orderId).toBe(orderId);

    expect(auditLogRecord).toHaveBeenCalledTimes(1);
    expect(auditLogRecord.mock.calls[0][0]).toMatchObject({
      actorUserId: ids.adminUser,
      actorRole: 'admin',
      action: 'order.rescheduled_by_admin',
      entityType: 'order',
      entityId: orderId,
    });

    const history = await q(`SELECT changed_by_user_id, changed_by_role, change_source, reason FROM order_status_history WHERE order_id = $1`, [
      orderId,
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].changed_by_user_id).toBe(ids.adminUser);
    expect(history[0].changed_by_role).toBe('admin');
    expect(history[0].change_source).toBe('admin');
    expect(history[0].reason).toContain('العميل اتصل يطلب تأجيل الميعاد');
  });

  it('يرفض طلب مش موجود', async () => {
    const newSlotId = await insertSlot('notfound-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '15:00');
    await expect(
      ordersService.rescheduleByAdmin(ids.adminUser, '00000000-0000-0000-0000-000000000000', { newSlotId }, 'سبب تجريبي'),
    ).rejects.toThrow();
  });

  it('يرفض إعادة جدولة بعد ما الفني يبقى في الطريق فعلاً (technician_on_way) — نفس قيد العميل بالظبط', async () => {
    const orderId = await insertOrder(`toolate-${runId}`, OrderStatus.TECHNICIAN_ON_WAY);
    await insertSlot('toolate-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('toolate-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '16:00');

    await expect(ordersService.rescheduleByAdmin(ids.adminUser, orderId, { newSlotId }, 'سبب تجريبي')).rejects.toThrow();
    expect(auditLogRecord).not.toHaveBeenCalled();
  });
});
