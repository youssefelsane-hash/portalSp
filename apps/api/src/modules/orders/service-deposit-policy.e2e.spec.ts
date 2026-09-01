import { DataSource, EntityManager } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { Address } from '../customers/entities/address.entity';
import { AddressesService } from '../customers/addresses.service';
import { CatalogService } from '../catalog/catalog.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { GeoService } from '../geo/geo.service';
import { City } from '../geo/entities/city.entity';
import { Area } from '../geo/entities/area.entity';
import { ServiceZone } from '../geo/entities/service-zone.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { TechnicianLevelsService } from '../technicians/technician-levels.service';
import { TechnicianLevelConfig } from '../technicians/entities/technician-level-config.entity';
import { TechnicianScheduleService } from '../technicians/technician-schedule.service';
import { TechnicianScheduleSlot } from '../technicians/entities/technician-schedule-slot.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { SupportService } from '../support/support.service';
import { Complaint } from '../support/entities/complaint.entity';
import { ComplaintMessage } from '../support/entities/complaint-message.entity';
import { ComplaintAttachment } from '../support/entities/complaint-attachment.entity';
import { OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

/**
 * ADR-0027 (docs/08 §42 Phase A.3) — سياسة إيداع لكل خدمة. الاختبار ده بيغطي:
 * 1. خدمة deposit_required=true + غياب payment_method (كاش ضمنيًا): ترفض VAL_001.
 * 2. خدمة deposit_required=true + payment_method=card: الطلب يتسجّل PENDING_PAYMENT بمبلغ
 *    deposit_amount_cents محسوب صح (نسبة% من total_amount_cents، snapshot وقت الإنشاء).
 * 3. تحصيل الإيداع (PaymentsService.amountOwedNow عبر collectCash) يرجّع مبلغ الإيداع بس، مش
 *    الإجمالي — السطر الحرج المُعدَّل في amountOwedNow().
 * 4. خدمة عادية (deposit_required=false الافتراضي): رجريشن صفري، الإجمالي كامل زي زمان.
 */
describe('OrdersService/PaymentsService — سياسة إيداع الخدمة (ADR-0027)', () => {
  let dataSource: DataSource;
  let cache: RedisCacheService;
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    serviceDeposit: '',
    serviceNoDeposit: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    warrantyPlan: '',
  };

  async function q(sql: string, params?: unknown[]) {
    return dataSource.query(sql, params);
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
        City,
        Area,
        ServiceZone,
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

    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(`INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`, [
      ids.country,
      `مدينة إيداع ${runId}`,
      `Deposit Policy City ${runId}`,
      `test-city-deposit-${runId}`,
    ]);
    ids.city = city.id;
    const [zone] = await q(`INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`, [
      ids.city,
      `نطاق إيداع ${runId}`,
      `Deposit Policy Zone ${runId}`,
    ]);
    ids.zone = zone.id;
    const [category] = await q(`INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`, [
      `فئة إيداع ${runId}`,
      `Deposit Policy Category ${runId}`,
      `test-category-deposit-${runId}`,
    ]);
    ids.category = category.id;
    // إجمالي 1000ج (100000 قرش)، إيداع 30% = 30000 قرش بالظبط.
    const [serviceDeposit] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, unit_name_ar, commission_percentage, warranty_days, deposit_required, deposit_percentage)
       VALUES ($1,$2,$3,'per_unit',100000,'قطعة',20,0,true,30) RETURNING id`,
      [ids.category, `خدمة إيداع ${runId}`, `test-service-deposit-${runId}`],
    );
    ids.serviceDeposit = serviceDeposit.id;
    const [serviceNoDeposit] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',100000,20,0) RETURNING id`,
      [ids.category, `خدمة عادية إيداع ${runId}`, `test-service-no-deposit-${runId}`],
    );
    ids.serviceNoDeposit = serviceNoDeposit.id;
    const [warrantyPlan] = await q(
      `INSERT INTO warranty_plans (
         slug, name_ar, warranty_type, target_service_id, pricing_model, price_value,
         coverage_months, max_claims, terms_ar
       ) VALUES ($1,$2,'extended_workmanship',$3,'percentage',30,12,2,$4) RETURNING id`,
      [`test-order-warranty-${runId}`, `ضمان إضافي ${runId}`, ids.serviceDeposit, 'شروط ثابتة وقت الشراء'],
    );
    ids.warrantyPlan = warrantyPlan.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2034${runId}`.slice(0, 15),
      `عميل إيداع ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, city_id, street_name, location)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, ids.city, `شارع إيداع ${runId}`],
    );
    ids.address = address.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), { record: async () => undefined } as unknown as AuditLogService, cache);
    const geoService = new GeoService(dataSource.getRepository(City), dataSource.getRepository(Area), dataSource.getRepository(ServiceZone), dataSource);
    const addressesService = new AddressesService(
      dataSource.getRepository(Address),
      dataSource.getRepository(CustomerProfile),
      dataSource.getRepository(Order),
      geoService,
    );
    const catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
      // ADR-0050 §1 — `evaluatePreset()` بقى بيمر على محرك المعادلات لكل طرق الحساب، فمحرك
      // فاضي هنا مابقاش كافي. الطرق الجاهزة مابتقراش من الريبوهات، فالبناء بلا اعتماديات صح.
      new PricingEngineService({} as never, {} as never, {} as never),
      {} as never,
    );
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
      {} as never,
    );
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const technicianLevelsService = new TechnicianLevelsService(
      dataSource.getRepository(TechnicianLevelConfig),
      {} as unknown as AuditLogService,
    );
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
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
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
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
      addressesService,
      catalogService,
      geoService,
      techniciansService,
      {} as never,
      scheduleService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      walletsService,
      settingsService,
      paymentsService,
      supportService,
      events,
      {} as never,
      commissionBaseServiceStub(),
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(`DELETE FROM customer_warranties WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [ids.customerUser]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [
        ids.customerProfile,
      ]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM warranty_plans WHERE id = $1`, [ids.warrantyPlan]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = ANY($1)`, [[ids.serviceDeposit, ids.serviceNoDeposit]]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    } finally {
      await cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('deposit_required=true + غياب payment_method (كاش ضمنيًا): يترفض بوضوح VAL_001', async () => {
    await expect(
      ordersService.create(ids.customerUser, {
        service_id: ids.serviceDeposit,
        address_id: ids.address,
        pricing_quantity: 1,
      } as never),
    ).rejects.toMatchObject({ code: 'VAL_001' });
  });

  it('خدمة بالوحدة ترفض الحجز والمعاينة من غير كمية صريحة', async () => {
    const input = { service_id: ids.serviceDeposit, address_id: ids.address };
    await expect(ordersService.previewPrice(ids.customerUser, input)).rejects.toMatchObject({ code: 'VAL_001' });
    await expect(ordersService.create(ids.customerUser, { ...input, payment_method: 'card' })).rejects.toMatchObject({
      code: 'VAL_001',
    });
  });

  it('deposit_required=true + payment_method=card: يتسجّل PENDING_PAYMENT بمبلغ إيداع 30% محسوب صح', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
      payment_method: 'card',
    } as never);
    expect(order.serviceId).toBe(ids.serviceDeposit);
    expect(order.totalAmountCents).toBe(100000);
    expect(order.depositAmountCents).toBe(30000);
    expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentStatus).toBe(OrderPaymentStatus.UNPAID);
  });

  it('Fawry يعمل كدفع مسبق حقيقي ولا يبدأ توزيع الطلب قبل تأكيد المرجع', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
      payment_method: 'fawry_reference',
    });
    expect(order.orderStatus).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.depositAmountCents).toBe(30000);
  });

  it('سعر الوحدة × الكمية ثم الضمان ثم الإيداع: المعاينة والطلب النهائي متطابقان', async () => {
    const input = {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 2,
      warranty_plan_id: ids.warrantyPlan,
    };
    const preview = await ordersService.previewPrice(ids.customerUser, input);
    expect(preview.base_price_cents).toBe(200000);
    expect(preview.warranty_price_cents).toBe(60000);
    expect(preview.total_amount_cents).toBe(260000);
    expect(preview.deposit_amount_cents).toBe(78000);
    expect(preview.remaining_amount_cents).toBe(182000);

    const order = await ordersService.create(ids.customerUser, { ...input, payment_method: 'card' });
    expect(order.estimatedPriceCents).toBe(preview.base_price_cents);
    expect(order.warrantyPriceCents).toBe(preview.warranty_price_cents);
    expect(order.totalAmountCents).toBe(preview.total_amount_cents);
    expect(order.depositAmountCents).toBe(preview.deposit_amount_cents);
    expect(Number(order.pricingQuantity)).toBe(2);
  });

  it('الضمان الاختياري 30% يضاف للإجمالي، يعيد حساب الإيداع، ويصدر من snapshot غير قابل للتغيير', async () => {
    const preview = await ordersService.previewPrice(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
      warranty_plan_id: ids.warrantyPlan,
    });
    expect(preview.warranty_price_cents).toBe(30000);
    expect(preview.total_amount_cents).toBe(130000);
    expect(preview.deposit_amount_cents).toBe(39000);

    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
      payment_method: 'card',
      warranty_plan_id: ids.warrantyPlan,
    });
    expect(order.warrantyPriceCents).toBe(30000);
    expect(order.totalAmountCents).toBe(130000);
    expect(order.depositAmountCents).toBe(39000);
    expect(order.warrantyPlanSnapshot).toMatchObject({ coverage_months: 12, price_value: 30 });

    await q(`UPDATE warranty_plans SET coverage_months=24, price_value=50, version=version+1 WHERE id=$1`, [ids.warrantyPlan]);
    order.orderStatus = OrderStatus.WORK_COMPLETED;
    await dataSource.transaction(async (manager) => {
      await manager.save(order);
      await (paymentsService as unknown as {
        settleAndComplete: (
          manager: EntityManager,
          order: Order,
          method: PaymentMethod,
          userId: string,
          role: 'customer',
        ) => Promise<Order>;
      }).settleAndComplete(manager, order, PaymentMethod.CARD, ids.customerUser, 'customer');
    });

    const [warranty] = await q(
      `SELECT price_paid_cents, coverage_months, terms_ar FROM customer_warranties WHERE order_id=$1`,
      [order.id],
    );
    expect(Number(warranty.price_paid_cents)).toBe(30000);
    expect(warranty.coverage_months).toBe(12);
    expect(warranty.terms_ar).toBe('شروط ثابتة وقت الشراء');
  });

  it('amountOwedNow() — السطر الحرج (ADR-0027): قبل أي دفع بترجع مبلغ الإيداع، وبعد ما الإيداع يتحصّل بترجع الباقي (الدلتا)', async () => {
    // مفيش provider دفع حقيقي متاح في بيئة الاختبار دي (paymentProviders مش متبني هنا، نفس
    // قيود service-cash-allowed.spec.ts) — فبنختبر amountOwedNow() مباشرة (دالة private، بس ده
    // نفس أسلوب التحقق الداخلي المقبول لما المسار العام محتاج بوابة دفع خارجية). الاستعلامات
    // اللي جوّه الدالة (تحميل الطلب، مجموع الدفعات الناجحة) حقيقية 100% ضد Postgres فعلي — مفيش mock.
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
      payment_method: 'card',
    } as never);

    // 1) قبل أي دفع (paymentStatus=UNPAID، PENDING_PAYMENT) — لازم ترجع مبلغ الإيداع بس (30000)،
    //    مش الإجمالي (100000). ده السطر الحرج المُعدَّل في PaymentsService.amountOwedNow().
    const owedBeforeDeposit = await (paymentsService as unknown as { amountOwedNow: (o: Order) => Promise<number> }).amountOwedNow(order);
    expect(owedBeforeDeposit).toBe(30000);

    // 2) نحاكي نجاح دفع الإيداع فعليًا (نفس أثر handlePaymentConfirmed بعد webhook/تأكيد InstaPay
    //    ناجح — Payment SUCCEEDED بمبلغ الإيداع + orders.payment_status=paid).
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,30000,'card','succeeded',$4, now())`,
      [`PAY-TEST-DEP-${runId}`, order.id, ids.customerProfile, `idem-test-dep-${runId}`],
    );
    await q(`UPDATE orders SET payment_status = 'paid' WHERE id = $1`, [order.id]);
    const [{ id: reloadedId, total_amount_cents, deposit_amount_cents, payment_status }] = await q(
      `SELECT id, total_amount_cents, deposit_amount_cents, payment_status FROM orders WHERE id = $1`,
      [order.id],
    );
    const reloadedOrder = {
      id: reloadedId,
      totalAmountCents: Number(total_amount_cents),
      depositAmountCents: Number(deposit_amount_cents),
      paymentStatus: payment_status,
    } as Order;

    // 3) بعد ما الإيداع اتحصّل، amountOwedNow() لازم ترجع الباقي (الدلتا) = 100000 - 30000 = 70000
    //    — نفس آلية البند الإضافي (ADR-0015) بالحرف، صفر كود جديد.
    const owedAfterDeposit = await (paymentsService as unknown as { amountOwedNow: (o: Order) => Promise<number> }).amountOwedNow(
      reloadedOrder,
    );
    expect(owedAfterDeposit).toBe(70000);
  });

  it('deposit_required=false (الافتراضي): رجريشن صفري — الإجمالي كامل بيتحصّل زي زمان، deposit_amount_cents=null', async () => {
    const order = await ordersService.create(ids.customerUser, {
      service_id: ids.serviceNoDeposit,
      address_id: ids.address,
    } as never);
    expect(order.serviceId).toBe(ids.serviceNoDeposit);
    expect(order.totalAmountCents).toBe(100000);
    expect(order.depositAmountCents).toBeNull();
    expect(order.orderStatus).toBe(OrderStatus.SEARCHING_TECHNICIAN);

    // رجريشن على amountOwedNow() نفسها — خدمة بلا إيداع لازم تفضل ترجع الإجمالي كامل زي زمان
    // بالظبط (depositAmountCents=null → fallback لـtotalAmountCents، صفر تغيير سلوكي).
    const owedNow = await (paymentsService as unknown as { amountOwedNow: (o: Order) => Promise<number> }).amountOwedNow(order);
    expect(owedNow).toBe(100000);
  });

  it('previewPrice() بيرجّع نفس تفصيل الإيداع اللي create() هتحسبه بالظبط (مفيش فرق معاينة/محصّل)', async () => {
    const preview = await ordersService.previewPrice(ids.customerUser, {
      service_id: ids.serviceDeposit,
      address_id: ids.address,
      pricing_quantity: 1,
    } as never);
    expect(preview.total_amount_cents).toBe(100000);
    expect(preview.deposit_amount_cents).toBe(30000);
    expect(preview.due_now_cents).toBe(30000);
    expect(preview.remaining_amount_cents).toBe(70000);
  });
});
