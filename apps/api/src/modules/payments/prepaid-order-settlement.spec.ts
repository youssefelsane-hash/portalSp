import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction } from './entities/wallet-transaction.entity';
import { WalletsService } from './wallets.service';
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
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { crewEarningsServiceStub } from './crew-earnings.testing';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح البَقّة الحرجة اللي ADR-0015 وثّقها (docs/08 §19
// بند 2 + اكتشاف عاجل): طلب مدفوع مسبقًا (كارت/InstaPay قبل التوزيع) كان بيفضل عالق في
// WORK_COMPLETED للأبد — أي تسوية كانت بترفض بـ"الطلب مدفوع بالفعل" رغم إن الشغل خلص فعلاً.
describe('PaymentsService.settleAlreadyPaidOrder() — تسوية الطلب المدفوع مسبقًا (ADR-0015)', () => {
  let dataSource: DataSource;
  let service: PaymentsService;
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
  const COMMISSION_PERCENT = 10;

  async function insertPrepaidWorkCompletedOrder(label: string, totalAmountCents: number, originalPaidCents: number) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, payment_method, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'work_completed','paid','card',$7,0) RETURNING id`,
      [`TESTPPS-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, totalAmountCents],
    );
    // الدفعة الأصلية (المسبقة) اللي اتحصّلت قبل التوزيع — completed_at أقدم عمدًا (وقت التوزيع)
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now() - interval '2 hours')`,
      [`PAYPPS-${label}`.slice(0, 24), order.id, ids.customerProfile, originalPaidCents, `idem-pps-${label}`, `gw-pps-${label}`],
    );
    return order.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order,
        Payment,
        Refund,
        User,
        WebhookEvent,
        OrderStatusHistory,
        Wallet,
        WalletTransaction,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianProfile,
        TechnicianCompany,
        TechnicianLevelConfig,
        CustomerProfile,
        LoyaltyTransaction,
        Setting,
      ],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, 'P' + runId.slice(0, 1).toUpperCase(), '+008', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-pps-${runId}`],
    );
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق اختبار ${runId}`,
      `Test Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-pps-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,$4,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-pps-${runId}`, COMMISSION_PERCENT],
    );
    ids.service = serviceRow.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2020${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [techUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+2021${runId}`.slice(0, 15), `فني اختبار ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCPPS${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      {} as never, // pricingEngineService — مش متنادى (findServiceOrThrow بس)
      {} as never, // docs/08 §36.24 ADR-0025 — ServicePricingTierPricing repo جديد
    );
    const techniciansService = new TechniciansService(
      dataSource.getRepository(TechnicianProfile),
      dataSource.getRepository(TechnicianCompany),
      {} as never, // technicianServicesRepo
      {} as never, // servicesRepo
      dataSource.getRepository(User),
      {} as never, // portfolioLinksService
      {} as never, // certificatesService
      {} as unknown as AuditLogService,
      {} as never, // geoService
      {} as never, // settingsService
    );
    // سياسة المستوى إعداد عالمي متغير؛ هذا الاختبار يعزل تسوية الدفع المسبق فقط.
    const technicianLevelsService = { getOrThrow: async () => ({ commissionAdjustmentPercentage: '0' }) } as never;
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);

    // محفظة المنصة لازم تكون موجودة فعليًا (findByUserIdOrThrow بترفض لو مش موجودة) — مش مضمونة
    // في قاعدة اختبار جديدة تمامًا، بس migration 0019 المفروض عملتها. نتأكد دفاعيًا.
    await walletsService.getOrCreateWallet(PLATFORM_SYSTEM_USER_ID, WalletOwnerType.PLATFORM);

    service = new PaymentsService(
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
      { enqueueRecalculation: async () => undefined } as never, // technicianStatsService — بره نطاق الاختبار ده
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never, // auditLog
      { emit: () => undefined } as never, // events
      {} as never, // paymentProviders — مش متنادى (collectCash بس هنا)
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(
        `DELETE FROM wallet_transactions
         WHERE reference_id IN (SELECT id FROM orders WHERE customer_id = $1)
            OR wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($2, $3))`,
        [ids.customerProfile, ids.techUser, ids.customerUser],
      );
      await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.techUser]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    } finally {
      cache.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('طلب مدفوع مسبقًا بالكامل (مفيش بند إضافي، دلتا=صفر): تسوية تلقائية فورية — COMPLETED + أرباح الفني اتحوّلت', async () => {
    const orderId = await insertPrepaidWorkCompletedOrder(`z-${runId}`, 30000, 30000);

    await service.settleAlreadyPaidOrder(orderId);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.PAID);
    // عمولة 10% → أرباح الفني 27000 قرش من إجمالي 30000
    expect(order?.technicianEarningCents).toBe(27000);
    expect(order?.platformCommissionCents).toBe(3000);

    // مفيش صف Payment جديد اتسجّل — مفيش دفعة إضافية حصلت أصلاً (دلتا=صفر)
    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    expect(payments.length).toBe(1); // الدفعة الأصلية بس

    const techWallet = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    expect(Number(techWallet[0].balance_cents)).toBe(27000);
  });

  it('فقد event بعد commit يُسترد من PostgreSQL، ونسختا sweep لا تكرران التسوية', async () => {
    const orderId = await insertPrepaidWorkCompletedOrder(`r-${runId}`, 30000, 30000);
    const [beforeRow] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    const balanceBefore = beforeRow ? Number(beforeRow.balance_cents) : 0;

    await Promise.all([
      service.reconcilePrepaidWorkCompleted(25),
      service.reconcilePrepaidWorkCompleted(25),
    ]);

    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });
    expect(order.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(order.paymentStatus).toBe(OrderPaymentStatus.PAID);
    const [afterRow] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    expect(Number(afterRow.balance_cents) - balanceBefore).toBe(27000);
    expect(
      await dataSource.getRepository(OrderStatusHistory).count({
        where: { orderId, newStatus: OrderStatus.COMPLETED },
      }),
    ).toBe(1);
  });

  it('طلب مدفوع مسبقًا بس فيه بند إضافي اتوافق عليه بعدين (دلتا>صفر): ينتقل لـAWAITING_PAYMENT بلا تسوية فورية، وبعد تحصيل الدلتا يقفل صح', async () => {
    // اتحصّل مسبقًا 30000، بس بعد بند إضافي اتوافق عليه بعد الدفع، الإجمالي بقى 45000 (دلتا=15000)
    const orderId = await insertPrepaidWorkCompletedOrder(`d-${runId}`, 45000, 30000);

    await service.settleAlreadyPaidOrder(orderId);

    let order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.AWAITING_PAYMENT);
    expect(order?.technicianEarningCents).toBe(0); // لسه مفيش تسوية، الأرباح متحسبتش لسه

    // ثاني مرة (idempotent) — مفيش تكرار انتقال، برضه AWAITING_PAYMENT
    await service.settleAlreadyPaidOrder(orderId);
    order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.AWAITING_PAYMENT);

    // تحصيل الدلتا فعليًا (كاش — الفني حصّلها على الطبيعة) — لازم يحصّل 15000 بس، مش 45000 كاملة
    const payment = await service.collectCash(ids.techUser, orderId);
    expect(payment.amountCents).toBe(15000);

    order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED);
    // عمولة 10% من الإجمالي الكامل (45000) — مش من الدلتا بس
    expect(order?.technicianEarningCents).toBe(40500);
    expect(order?.platformCommissionCents).toBe(4500);

    // محاولة تحصيل تالتة (الطلب COMPLETED خلاص) لازم ترفض — منع تحصيل مزدوج
    await expect(service.collectCash(ids.techUser, orderId)).rejects.toThrow('الطلب مدفوع بالفعل');
  });

  it('طلب عادي (مش مدفوع مسبقًا) في WORK_COMPLETED — settleAlreadyPaidOrder() لا تفعل شيء (regression: المسار العادي فضل زي زمان)', async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'work_completed','unpaid',20000,0) RETURNING id`,
      [`TESTPPS-n-${runId}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone],
    );

    await service.settleAlreadyPaidOrder(order.id);

    const reloaded = await dataSource.getRepository(Order).findOne({ where: { id: order.id } });
    expect(reloaded?.orderStatus).toBe(OrderStatus.WORK_COMPLETED); // زي ما هو، مفيش تدخل
    expect(reloaded?.paymentStatus).toBe(OrderPaymentStatus.UNPAID);

    // المسار العادي لسه شغال زي زمان — collectCash بيحصّل الإجمالي كامل عادي
    const payment = await service.collectCash(ids.techUser, order.id);
    expect(payment.amountCents).toBe(20000);
  });
});
