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
      { record: async () => undefined } as unknown as AuditLogService,
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
    );
  });

  afterEach(async () => {
    // Every test owns its fixture. Release the Phase 7 one-active-order resource before the next
    // case while preserving each assertion's state for the duration of that case.
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await dataSource.query(`UPDATE orders SET technician_id = NULL WHERE order_number LIKE $1`, [`TESTRSC-%`]);
    }
  });

  afterAll(async () => {
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRSC-%`]);
      await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTRSC-%`]);
      // Includes the isolated address-warning fixture even if that test failed before local cleanup.
      await q(`DELETE FROM addresses WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.customerUser, ids.techUser]);
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
