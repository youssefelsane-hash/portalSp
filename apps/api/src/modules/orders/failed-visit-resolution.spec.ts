import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { FailedVisitReason } from './dto/report-failed-visit.dto';
import { FailedVisitOutcome } from './dto/resolve-failed-visit.dto';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import type { PaymentProvider, RefundResult } from '../payments/gateways/payment-provider.interface';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User, UserType } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianScheduleSlot, TechnicianScheduleSlotStatus } from '../technicians/entities/technician-schedule-slot.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint, ComplaintCategory } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';

// اختبار حي ضد Postgres حقيقي — زيارة فاشلة/عدم حضور (docs/08 §22 بند 3-6). بيغطي الدورة الكاملة:
// الفني بيبلّغ (no-show أو required_work_rejected) → الطلب DISPUTED + شكوى مسجّلة بالتصنيف الصح →
// الأدمن يحل (reschedule بلا تحصيل تاني، أو cancel_with_fee برسوم + استرداد الباقي للمدفوع
// مسبقًا، صفر رسوم للكاش تمامًا).
describe('OrdersService.reportFailedVisit()/resolveFailedVisit() — زيارة فاشلة (docs/08 §22 بند 3-6)', () => {
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
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
    otherTechUser: '',
    otherTechProfile: '',
  };

  const makeFakeProvider = (): PaymentProvider => ({
    providerKey: 'fake-test-provider',
    isConfigured: true,
    supportsRefund: true,
    supportsVoid: false,
    supportsCapture: false,
    supportsTokenization: false,
    async createPayment() {
      throw new Error('not used in this test');
    },
    verifyWebhook() {
      throw new Error('not used in this test');
    },
    async getPaymentStatus() {
      throw new Error('not used in this test');
    },
    async refund(): Promise<RefundResult> {
      return { succeeded: true, providerRefundId: `prov-refund-${runId}`, status: 'refunded' as never, failureReason: null };
    },
    async void() {
      throw new Error('not used in this test');
    },
    async capture() {
      throw new Error('not used in this test');
    },
    async reconcile() {
      throw new Error('not used in this test');
    },
    async chargeToken() {
      throw new Error('not used in this test');
    },
    verifyCardSaveWebhook() {
      return null;
    },
  });

  async function insertOrder(opts: {
    label: string;
    orderStatus: OrderStatus;
    paymentStatus: OrderPaymentStatus;
    totalAmountCents: number;
  }) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0) RETURNING id, order_number`,
      [
        `TESTFV-${opts.label}`.slice(0, 24),
        ids.customerProfile,
        ids.techProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus,
        opts.paymentStatus,
        opts.totalAmountCents,
      ],
    );
    return { orderId: order.id as string, orderNumber: order.order_number as string };
  }

  async function insertSlot(opts: {
    technicianId: string;
    slotDate: string;
    startTime: string;
    endTime: string;
    status: TechnicianScheduleSlotStatus;
    orderId?: string;
  }) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [slot] = await q(
      `INSERT INTO technician_schedule_slots (technician_id, slot_date, start_time, end_time, status, order_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [opts.technicianId, opts.slotDate, opts.startTime, opts.endTime, opts.status, opts.orderId ?? null],
    );
    return slot.id as string;
  }

  async function insertSucceededPayment(orderId: string, label: string, amountCents: number) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now())`,
      [`PAYFV-${label}`.slice(0, 24), orderId, ids.customerProfile, amountCents, `idem-fv-${label}-${Math.random()}`, `gw-fv-${label}`],
    );
  }

  const techUserPayload = () => ({ sub: ids.techUser, userType: UserType.TECHNICIAN, amr: ['otp'] as ('otp' | 'webauthn')[] });

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
        Setting,
        Complaint,
        ComplaintMessage,
        ComplaintAttachment,
        TechnicianScheduleSlot,
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
      `test-city-fv-${runId}`,
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
      `test-category-fv-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',30000,20,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-fv-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2028${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-fv-${runId}@test.local`,
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
      `+2029${runId}`.slice(0, 15),
      `فني اختبار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.techUser, `TCFV${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    const [otherTechUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`, [
      // Keep this suite's namespace distinct from parallel order suites that can share Date.now().
      `+2998${runId}`.slice(0, 15),
      `فني تاني اختبار ${runId}`,
    ]);
    ids.otherTechUser = otherTechUser.id;
    const [otherTechProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, national_id_encrypted, years_of_experience, current_level) VALUES ($1,$2,'x',3,'new') RETURNING id`,
      [ids.otherTechUser, `TCFV2${runId}`.slice(0, 20)],
    );
    ids.otherTechProfile = otherTechProfile.id;

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
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const scheduleService = new TechnicianScheduleService(dataSource.getRepository(TechnicianScheduleSlot));
    const events = new EventEmitter2();

    paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      walletsService,
      {} as never, // catalogService
      customerProfilesService,
      techniciansService,
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      {} as never, // loyaltyService
      settingsService,
      { record: async () => undefined } as never, // auditLog
      events,
      { getProvider: () => makeFakeProvider() } as never, // paymentProviders
      {} as never, // savedPaymentMethods
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
      {} as never, // storage — مش متنادى (صفر مرفقات في الاختبار ده)
    );

    ordersService = new OrdersService(
      dataSource.getRepository(Order),
      {} as never, // technicianOrderCancellations
      {} as never, // orderMedia
      dataSource,
      { record: async () => undefined } as unknown as AuditLogService,
      customerProfilesService,
      {} as never, // addressesService
      {} as never, // catalogService
      {} as never, // geoService
      techniciansService,
      {} as never, // technicianCompaniesService
      scheduleService,
      {} as never, // pricingEngineService
      {} as never, // promoCodesService
      {} as never, // buildingsService
      {} as never, // cancellationReasonsService
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
    );
  });

  afterEach(async () => {
    // Phase 7 permits only one active order per technician. Cases in this suite are independent,
    // so release the shared technician resource before the next fixture is inserted.
    if (dataSource?.isInitialized) {
      await dataSource.query(`UPDATE orders SET technician_id = NULL WHERE order_number LIKE $1`, [`TESTFV-%`]);
    }
  });

  afterAll(async () => {
    try {
      const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
      const technicianIds = [ids.techProfile, ids.otherTechProfile].filter(Boolean);
      const userIds = [ids.customerUser, ids.techUser, ids.otherTechUser].filter(Boolean);
      if (technicianIds.length > 0) {
        await q(`DELETE FROM technician_schedule_slots WHERE technician_id = ANY($1::uuid[])`, [technicianIds]);
      }
      await q(`DELETE FROM complaints WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTFV-%`]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTFV-%`]);
      await q(`DELETE FROM wallet_transactions WHERE reference_type = 'refund' AND reference_id IN (SELECT id FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1))`, [`TESTFV-%`]);
      await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTFV-%`]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTFV-%`]);
      await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTFV-%`]);
      if (ids.address) await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      if (ids.customerProfile) await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      if (technicianIds.length > 0) {
        await q(`DELETE FROM technician_profiles WHERE id = ANY($1::uuid[])`, [technicianIds]);
      }
      if (userIds.length > 0) await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      if (ids.service) await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      if (ids.category) await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      if (ids.zone) await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      cache?.onModuleDestroy();
      if (dataSource?.isInitialized) await dataSource.destroy();
    }
  });

  it('no-show من TECHNICIAN_ARRIVED → DISPUTED + شكوى NO_SHOW، وresolve(reschedule) يحجز سلوت جديد حقيقي فعليًا (docs/08 §25.2)', async () => {
    const { orderId } = await insertOrder({
      label: `noshow-${runId}`,
      orderStatus: OrderStatus.TECHNICIAN_ARRIVED,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });
    const oldSlotId = await insertSlot({
      technicianId: ids.techProfile,
      slotDate: '2026-09-01',
      startTime: '10:00',
      endTime: '11:00',
      status: TechnicianScheduleSlotStatus.BOOKED,
      orderId,
    });
    const newSlotId = await insertSlot({
      technicianId: ids.techProfile,
      slotDate: '2026-09-03',
      startTime: '14:00',
      endTime: '15:00',
      status: TechnicianScheduleSlotStatus.AVAILABLE,
    });

    const reported = await ordersService.reportFailedVisit(techUserPayload(), orderId, {
      reason: FailedVisitReason.CUSTOMER_NO_SHOW,
      description: 'العميل مش موجود ولا رد على التليفون',
    });
    expect(reported.orderStatus).toBe(OrderStatus.DISPUTED);

    const complaint = await dataSource.getRepository(Complaint).findOne({ where: { orderId } });
    expect(complaint?.category).toBe(ComplaintCategory.NO_SHOW);
    expect(complaint?.filedByUserId).toBe(ids.techUser);

    const resolved = await ordersService.resolveFailedVisit(ids.customerUser, orderId, {
      outcome: FailedVisitOutcome.RESCHEDULE,
      admin_notes: 'العميل هيبقى موجود يوم تاني، نفس الطلب',
      new_slot_id: newSlotId,
    });
    expect(resolved.orderStatus).toBe(OrderStatus.ACCEPTED);
    expect(resolved.totalAmountCents).toBe(30000);
    expect(resolved.scheduledAt?.toISOString()).toBe(new Date('2026-09-03T14:00:00Z').toISOString());

    const oldSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOne({ where: { id: oldSlotId } });
    expect(oldSlot?.status).toBe(TechnicianScheduleSlotStatus.AVAILABLE);
    expect(oldSlot?.orderId).toBeNull();
    const newSlot = await dataSource.getRepository(TechnicianScheduleSlot).findOne({ where: { id: newSlotId } });
    expect(newSlot?.status).toBe(TechnicianScheduleSlotStatus.BOOKED);
    expect(newSlot?.orderId).toBe(orderId);
  });

  it('resolve(reschedule) من غير new_slot_id يترفض بوضوح — صفر "يرجع ACCEPTED بنفس الموعد القديم" بصمت', async () => {
    const { orderId } = await insertOrder({
      label: `noslot-${runId}`,
      orderStatus: OrderStatus.DISPUTED,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });
    await expect(
      ordersService.resolveFailedVisit(ids.customerUser, orderId, {
        outcome: FailedVisitOutcome.RESCHEDULE,
        admin_notes: 'محاولة من غير موعد جديد',
      }),
    ).rejects.toThrow();
    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.DISPUTED); // فضل معلّق، ماترجعش ACCEPTED بصمت
  });

  it('resolve(reschedule) بسلوت فني تاني يترفض — مينفعش تغيّر الفني نفسه من مسار حل النزاع', async () => {
    const { orderId } = await insertOrder({
      label: `wrongtech-${runId}`,
      orderStatus: OrderStatus.DISPUTED,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });
    const otherTechSlotId = await insertSlot({
      technicianId: ids.otherTechProfile,
      slotDate: '2026-09-05',
      startTime: '09:00',
      endTime: '10:00',
      status: TechnicianScheduleSlotStatus.AVAILABLE,
    });
    await expect(
      ordersService.resolveFailedVisit(ids.customerUser, orderId, {
        outcome: FailedVisitOutcome.RESCHEDULE,
        admin_notes: 'محاولة بسلوت فني تاني',
        new_slot_id: otherTechSlotId,
      }),
    ).rejects.toThrow();
  });

  it('required_work_rejected من IN_PROGRESS → DISPUTED + شكوى REQUIRED_WORK_REJECTED', async () => {
    const { orderId } = await insertOrder({
      label: `reqrej-${runId}`,
      orderStatus: OrderStatus.IN_PROGRESS,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });

    const reported = await ordersService.reportFailedVisit(techUserPayload(), orderId, {
      reason: FailedVisitReason.REQUIRED_WORK_REJECTED,
      description: 'العميل رفض تغيير الوصلة التالفة، مينفعش أكمّل من غيرها',
    });
    expect(reported.orderStatus).toBe(OrderStatus.DISPUTED);

    const complaint = await dataSource.getRepository(Complaint).findOne({ where: { orderId } });
    expect(complaint?.category).toBe(ComplaintCategory.REQUIRED_WORK_REJECTED);
  });

  it('مينفعش تبلّغ عن زيارة فاشلة قبل ما الفني يوصل أصلاً (ACCEPTED)', async () => {
    const { orderId } = await insertOrder({
      label: `tooearly-${runId}`,
      orderStatus: OrderStatus.ACCEPTED,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });
    await expect(
      ordersService.reportFailedVisit(techUserPayload(), orderId, {
        reason: FailedVisitReason.CUSTOMER_NO_SHOW,
        description: 'محاولة قبل الأوان',
      }),
    ).rejects.toThrow();
  });

  it('cancel_with_fee على طلب كاش — صفر رسوم دايمًا، صفر معاملة دفع وهمية، الطلب يتلغي مباشرة', async () => {
    const { orderId } = await insertOrder({
      label: `cash-${runId}`,
      orderStatus: OrderStatus.DISPUTED,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });

    const resolved = await ordersService.resolveFailedVisit(ids.customerUser, orderId, {
      outcome: FailedVisitOutcome.CANCEL_WITH_FEE,
      visit_fee_cents: 5000,
      admin_notes: 'العميل عايز يلغي، طلب كاش',
    });
    expect(resolved.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const refunds = await dataSource.getRepository(Refund).find({ where: { orderId } });
    expect(payments.length).toBe(0);
    expect(refunds.length).toBe(0);
  });

  it('cancel_with_fee على طلب مدفوع مسبقًا (استرداد جزئي بعد خصم الرسوم) — الطلب يتلغي بعد الاسترداد', async () => {
    const { orderId } = await insertOrder({
      label: `prepaidfee-${runId}`,
      orderStatus: OrderStatus.DISPUTED,
      paymentStatus: OrderPaymentStatus.PAID,
      totalAmountCents: 30000,
    });
    await insertSucceededPayment(orderId, `prepaidfee-${runId}`, 30000);

    const resolved = await ordersService.resolveFailedVisit(ids.customerUser, orderId, {
      outcome: FailedVisitOutcome.CANCEL_WITH_FEE,
      visit_fee_cents: 5000,
      admin_notes: 'العميل عايز يلغي، طلب مدفوع مسبقًا',
    });
    expect(resolved.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const refund = await dataSource.getRepository(Refund).findOne({ where: { orderId } });
    expect(refund?.amountCents).toBe(25000);
  });

  it('cancel_with_fee برسوم صفر على طلب مدفوع مسبقًا — استرداد كامل، الطلب REFUNDED تلقائيًا', async () => {
    const { orderId } = await insertOrder({
      label: `prepaidfull-${runId}`,
      orderStatus: OrderStatus.DISPUTED,
      paymentStatus: OrderPaymentStatus.PAID,
      totalAmountCents: 30000,
    });
    await insertSucceededPayment(orderId, `prepaidfull-${runId}`, 30000);

    const resolved = await ordersService.resolveFailedVisit(ids.customerUser, orderId, {
      outcome: FailedVisitOutcome.CANCEL_WITH_FEE,
      visit_fee_cents: 0,
      admin_notes: 'العميل عايز يلغي، صفر رسوم',
    });
    expect(resolved.orderStatus).toBe(OrderStatus.REFUNDED);

    const refund = await dataSource.getRepository(Refund).findOne({ where: { orderId } });
    expect(refund?.amountCents).toBe(30000);
  });

  it('مينفعش تحل زيارة فاشلة لطلب مش DISPUTED أصلاً', async () => {
    const { orderId } = await insertOrder({
      label: `notdisputed-${runId}`,
      orderStatus: OrderStatus.IN_PROGRESS,
      paymentStatus: OrderPaymentStatus.PENDING,
      totalAmountCents: 30000,
    });
    await expect(
      ordersService.resolveFailedVisit(ids.customerUser, orderId, {
        outcome: FailedVisitOutcome.RESCHEDULE,
        admin_notes: 'محاولة غلط',
      }),
    ).rejects.toThrow();
  });
});
