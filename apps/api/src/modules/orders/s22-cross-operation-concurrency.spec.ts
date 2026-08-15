import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { FailedVisitOutcome } from './dto/resolve-failed-visit.dto';
import { FailedVisitReason } from './dto/report-failed-visit.dto';
import { CashDisputeOutcome } from './dto/resolve-cash-dispute.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User, UserType } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CatalogService } from '../catalog/catalog.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from '../technicians/entities/technician-schedule-slot.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';

// اختبار حي ضد Postgres حقيقي — تزامن/أمان عبر العمليات (docs/08 §22 بند 31-32). بيغطي بَقّتين
// حقيقيتين اتلقطتا وانصلحتا أثناء بناء الاختبار ده نفسه (مش سيناريو نظري): "double admin edit"
// (أدمنين بيحلّوا نفس النزاع في نفس اللحظة بقرارين مختلفين) في resolveFailedVisit/
// resolveCashHandoverDispute، وسباق reschedule() (العميل) مع depart() (الفني) على نفس الطلب —
// الاتنين كانوا بيكتبوا كامل الـobject القديم في الذاكرة (lost update) بدل ما يعيدوا التحقق تحت
// قفل حقيقي. زائد فحوصات IDOR حية للـendpoints الجديدة (مش قراءة كود بس).
describe('§22 بند 31-32: تزامن عبر العمليات + IDOR للـendpoints الجديدة', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
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
    // مستخدم/فني تاني — لاختبارات IDOR (طلب A بتاع الأول، محاولة وصول من التاني لازم ترفض)
    otherCustomerUser: '',
    otherCustomerProfile: '',
    otherTechUser: '',
    otherTechProfile: '',
    // أدمنين حقيقيين (UUID فعلي، changed_by_user_id عمود UUID) — "double admin edit" بمعناها
    // الحرفي، مش placeholder نصي.
    adminA: '',
    adminB: '',
  };

  async function insertOrder(
    label: string,
    orderStatus: OrderStatus,
    extra: { paymentStatus?: string; customerCashConfirmedAt?: boolean; technicianCashNotReceivedAt?: boolean; customerId?: string; technicianId?: string } = {},
  ) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,30000,20000) RETURNING id`,
      [
        `TS22C-${label}`.slice(0, 24),
        extra.customerId ?? ids.customerProfile,
        extra.technicianId ?? ids.techProfile,
        ids.service,
        ids.address,
        ids.zone,
        orderStatus,
        extra.paymentStatus ?? 'pending',
      ],
    );
    const orderId = order.id as string;
    if (extra.customerCashConfirmedAt) {
      await q(`UPDATE orders SET customer_cash_confirmed_at = now() WHERE id = $1`, [orderId]);
    }
    if (extra.technicianCashNotReceivedAt) {
      await q(`UPDATE orders SET technician_cash_not_received_at = now() WHERE id = $1`, [orderId]);
    }
    return orderId;
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

  const techUserPayload = (sub: string) => ({ sub, userType: UserType.TECHNICIAN, amr: ['otp'] as ('otp' | 'webauthn')[] });

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
        TechnicianProfile,
        TechnicianCompany,
        TechnicianScheduleSlot,
        Setting,
        Complaint,
        ComplaintMessage,
        ComplaintAttachment,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianLevelConfig,
        LoyaltyTransaction,
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
      `test-city-s22c-${runId}`,
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
      `test-category-s22c-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-s22c-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2035${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-s22c-${runId}@test.local`,
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
      `+2036${runId}`.slice(0, 15),
      `فني اختبار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.techUser, `TCS22C${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    // مستخدمين تانيين — IDOR بس، بلا طلبات مرتبطة بيهم أصلاً
    const [otherCustomerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2037${runId}`.slice(0, 15),
      `عميل تاني ${runId}`,
    ]);
    ids.otherCustomerUser = otherCustomerUser.id;
    const [otherCustomerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.otherCustomerUser]);
    ids.otherCustomerProfile = otherCustomerProfile.id;
    const [otherTechUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      `+2038${runId}`.slice(0, 15),
      `فني تاني ${runId}`,
    ]);
    ids.otherTechUser = otherTechUser.id;
    const [otherTechProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [otherTechUser.id, `TCS22C2${runId}`.slice(0, 20)],
    );
    ids.otherTechProfile = otherTechProfile.id;

    const [adminA] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2039${runId}a`.slice(0, 15),
      `أدمن أ ${runId}`,
    ]);
    ids.adminA = adminA.id;
    const [adminB] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`, [
      `+2039${runId}b`.slice(0, 15),
      `أدمن ب ${runId}`,
    ]);
    ids.adminB = adminB.id;

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      dataSource.getRepository(User),
      {} as never,
      {} as never,
      {} as unknown as AuditLogService,
      {} as never,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      {} as never,
    );
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();

    const paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      walletsService,
      catalogService,
      customerProfilesService,
      techniciansService,
      technicianLevelsService,
      { enqueueRecalculation: async () => undefined } as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never,
      {} as never,
    );

    const supportService = new SupportService(
      dataSource.getRepository(Complaint),
      dataSource.getRepository(ComplaintMessage),
      dataSource.getRepository(ComplaintAttachment),
      dataSource.getRepository(Order),
      dataSource,
      customerProfilesService,
      techniciansService,
      walletsService,
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
      {} as never, // cancellationReasonsService
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM complaints WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TS22C-%`]);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TS22C-%`]);
    await q(`DELETE FROM loyalty_transactions WHERE user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($1, $2))`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TS22C-%`]);
    await q(`DELETE FROM technician_schedule_slots WHERE technician_id = $1`, [ids.techProfile]);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TS22C-%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id IN ($1, $2)`, [ids.customerProfile, ids.otherCustomerProfile]);
    await q(`DELETE FROM technician_profiles WHERE id IN ($1, $2)`, [ids.techProfile, ids.otherTechProfile]);
    await q(`DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5, $6)`, [
      ids.customerUser,
      ids.techUser,
      ids.otherCustomerUser,
      ids.otherTechUser,
      ids.adminA,
      ids.adminB,
    ]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await dataSource.destroy();
  }, 30000);

  it('double admin edit — resolveFailedVisit(reschedule) و resolveFailedVisit(cancel_with_fee) على نفس نزاع الزيارة الفاشلة (طلب كاش) بالتزامن: واحد بس ينجح', async () => {
    const orderId = await insertOrder(`fv-race-${runId}`, OrderStatus.DISPUTED, { paymentStatus: 'pending' });

    const results = await Promise.allSettled([
      ordersService.resolveFailedVisit(ids.adminA, orderId, { outcome: FailedVisitOutcome.RESCHEDULE, admin_notes: 'أدمن أ قرر يرجّع الطلب نشط' }),
      ordersService.resolveFailedVisit(ids.adminB, orderId, {
        outcome: FailedVisitOutcome.CANCEL_WITH_FEE,
        admin_notes: 'أدمن ب قرر يلغي بالرسوم',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // الحالة النهائية لازم تطابق بالظبط قرار الفائز — مفيش حالة "ضاعت" أو اتلخبطت بكتابة الخاسر
    // فوقها (lost update). accepted (reschedule) أو cancelled_by_customer (cancel_with_fee) بس.
    const finalOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect([OrderStatus.ACCEPTED, OrderStatus.CANCELLED_BY_CUSTOMER]).toContain(finalOrder.orderStatus);

    // صف واحد بس في order_status_history لكل حالة، مش اتنين (يعني الخاسر فعلاً اترفض بالكامل،
    // مش نجح جوّه transaction وبعدين اتعمله rollback جزئي فقط).
    const historyRows = await dataSource
      .getRepository(OrderStatusHistory)
      .createQueryBuilder('h')
      .where('h.order_id = :orderId', { orderId })
      .getMany();
    expect(historyRows.length).toBe(1);
  });

  it('double admin edit — resolveCashHandoverDispute(retry) و resolveCashHandoverDispute(confirm_received) على نفس نزاع الكاش بالتزامن: واحد بس ينجح، صفر تسوية يتيمة', async () => {
    const orderId = await insertOrder(`cd-race-${runId}`, OrderStatus.DISPUTED, {
      paymentStatus: 'pending',
      technicianCashNotReceivedAt: true,
    });

    const results = await Promise.allSettled([
      ordersService.resolveCashHandoverDispute(ids.adminA, orderId, { outcome: CashDisputeOutcome.RETRY, admin_notes: 'أدمن أ قرر إعادة المحاولة' }),
      ordersService.resolveCashHandoverDispute(ids.adminB, orderId, {
        outcome: CashDisputeOutcome.CONFIRM_RECEIVED,
        admin_notes: 'أدمن ب اتأكد إن الفلوس استلمت فعلاً',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const finalOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    const paymentCount = await dataSource
      .getRepository(Payment)
      .createQueryBuilder('p')
      .where('p.order_id = :orderId', { orderId })
      .getCount();

    if (finalOrder.orderStatus === OrderStatus.COMPLETED) {
      // confirm_received فاز — لازم يبقى فيه Payment حقيقي واحد بالظبط بيثبت التسوية.
      expect(paymentCount).toBe(1);
    } else {
      // retry فاز — الطلب رجع work_completed قابل للتحصيل تاني، وصفر Payment اتسجّل (مفيش تسوية
      // حصلت فعلاً — لو كان فيه Payment هنا كان ده دليل "تسوية يتيمة" — البَقّة اللي اتصلحت).
      expect(finalOrder.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
      expect(paymentCount).toBe(0);
      expect(finalOrder.technicianCashNotReceivedAt).toBeNull();
    }
  });

  it('سباق reschedule() (العميل) مع depart() (الفني) على نفس الطلب — صفر ارتداد صامت لحالة الطلب', async () => {
    const orderId = await insertOrder(`resched-depart-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('rd-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('rd-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '17:00');

    const results = await Promise.allSettled([
      ordersService.reschedule(ids.customerUser, orderId, { new_slot_id: newSlotId }),
      ordersService.depart(ids.techUser, orderId),
    ]);

    // الاتنين شرعيين منطقيًا وقت الانطلاق (accepted تقبل الاتنين) — المهم إن الطلب متساقطش لحالة
    // قديمة كذب. البَقّة اللي اتصلحت: reschedule() كانت بتكتب order_status='accepted' (القيمة
    // القديمة في الذاكرة) فوق أي تغيير حالة حصل بالتزامن، حتى لو depart() نجحت فعليًا قبلها.
    const finalOrder = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    const departFulfilled = results[1].status === 'fulfilled';

    if (departFulfilled) {
      // depart() نجحت — لازم الحالة النهائية technician_on_way بالضبط، مش accepted (ارتداد صامت).
      expect(finalOrder.orderStatus).toBe(OrderStatus.TECHNICIAN_ON_WAY);
      expect(finalOrder.technicianDepartedAt).not.toBeNull();
    } else {
      // depart() فشلت (سباق رفضها reschedule() بعد ما قفلت الصف) — الطلب يفضل accepted، وده تمام.
      expect(finalOrder.orderStatus).toBe(OrderStatus.ACCEPTED);
    }
  });

  it('IDOR — عميل تاني مايقدرش يأكّد تسليم كاش على طلب مش بتاعه', async () => {
    const orderId = await insertOrder(`idor-cust-${runId}`, OrderStatus.WORK_COMPLETED);
    await expect(ordersService.confirmCashHandover(ids.otherCustomerUser, orderId)).rejects.toThrow();

    // الطلب نفسه لازم يفضل من غير أي أثر — صفر تأكيد اتسجّل من حساب مش بتاع الطلب.
    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.customerCashConfirmedAt).toBeNull();
  });

  it('IDOR — عميل تاني مايقدرش يعيد جدولة طلب مش بتاعه', async () => {
    const orderId = await insertOrder(`idor-cust-resched-${runId}`, OrderStatus.ACCEPTED);
    await insertSlot('idor-resched-old', TechnicianScheduleSlotStatus.BOOKED, orderId, '09:00');
    const newSlotId = await insertSlot('idor-resched-new', TechnicianScheduleSlotStatus.AVAILABLE, null, '18:00');

    await expect(ordersService.reschedule(ids.otherCustomerUser, orderId, { new_slot_id: newSlotId })).rejects.toThrow();
  });

  it('IDOR — فني تاني مايقدرش يبلّغ "لم أستلم" على طلب فني تاني', async () => {
    const orderId = await insertOrder(`idor-tech-cash-${runId}`, OrderStatus.WORK_COMPLETED);
    await expect(
      ordersService.reportCashNotReceived(techUserPayload(ids.otherTechUser), orderId, { description: 'محاولة وصول غير مصرح بيها' }),
    ).rejects.toThrow();

    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.technicianCashNotReceivedAt).toBeNull();
    expect(order.orderStatus).toBe(OrderStatus.WORK_COMPLETED);
  });

  it('IDOR — فني تاني مايقدرش يبلّغ زيارة فاشلة على طلب فني تاني', async () => {
    const orderId = await insertOrder(`idor-tech-visit-${runId}`, OrderStatus.TECHNICIAN_ARRIVED);
    await expect(
      ordersService.reportFailedVisit(techUserPayload(ids.otherTechUser), orderId, {
        reason: FailedVisitReason.CUSTOMER_NO_SHOW,
        description: 'محاولة وصول غير مصرح بيها',
      }),
    ).rejects.toThrow();

    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(order.orderStatus).toBe(OrderStatus.TECHNICIAN_ARRIVED);
  });
});
