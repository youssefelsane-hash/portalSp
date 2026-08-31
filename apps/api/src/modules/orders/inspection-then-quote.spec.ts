import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InspectionQuoteService } from './inspection-quote.service';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { CUSTOMER_CANCELLABLE_STATUSES, canTransition } from './order-state-machine';
import { PaymentsService } from '../payments/payments.service';
import { Payment, PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { SavedPaymentMethod } from '../payments/entities/saved-payment-method.entity';
import { SavedPaymentMethodsService } from '../payments/saved-payment-methods.service';
import { CatalogService } from '../catalog/catalog.service';
import { PricingModel } from '../catalog/entities/service.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { Service } from '../catalog/entities/service.entity';
import { ServiceZonePricing } from '../catalog/entities/service-zone-pricing.entity';
import { ServiceLevelPricing } from '../catalog/entities/service-level-pricing.entity';
import { ServiceAddon } from '../catalog/entities/service-addon.entity';
import { ServiceStandardData } from '../catalog/entities/service-standard-data.entity';
import { TechniciansService } from '../technicians/technicians.service';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { TechnicianCompany } from '../technicians/entities/technician-company.entity';
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { Setting } from '../settings/entities/setting.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

// اختبار حي ضد Postgres حقيقي — معاينة-ثم-سعر كوضع حجز (ADR-0044، docs/08 §73 بند 1).
// بيغطي: (1) CatalogService.estimate() فرع inspection_then_quote — رسم معاينة بس وقت الحجز.
// (2) الفني يحدد سعر بعد المعاينة (submitInitialQuote) — لازم الخدمة تكون inspection_then_quote
// فعلاً، ولازم الطلب يكون technician_arrived. (3) العميل يوافق (approveInitialQuote) —
// total_amount_cents/commissionable_base_cents يتحدّثوا صح (workPriceCents بلا شرط سياسة)،
// محاولة تحصيل فورية للدلتا لو رسم المعاينة اتحصّل إلكترونيًا. (4) مسار الرفض state machine —
// awaiting_initial_quote_approval → cancelled_by_customer مسموح ومُدرج في CUSTOMER_CANCELLABLE_STATUSES.
describe('InspectionQuoteService — معاينة-ثم-سعر (ADR-0044)', () => {
  let dataSource: DataSource;
  let inspectionQuoteService: InspectionQuoteService;
  let catalogService: CatalogService;
  let paymentsService: PaymentsService;
  let savedPaymentMethods: SavedPaymentMethodsService;
  let cache: RedisCacheService;
  let fakeChargeTokenResult: { succeeded: boolean; providerReference: string | null; failureReason: string | null };

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    inspectionService: '',
    fixedService: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
  };

  async function insertOrder(
    label: string,
    serviceId: string,
    status: OrderStatus,
    opts: { totalAmountCents: number; estimatedPriceCents: number; inspectionFeeCents: number; paid: boolean },
  ): Promise<string> {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, estimated_price_cents, inspection_fee_cents, commissionable_base_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,0) RETURNING id`,
      [
        `TESTITQ-${label}`.slice(0, 24),
        ids.customerProfile,
        ids.techProfile,
        serviceId,
        ids.address,
        ids.zone,
        status,
        opts.paid ? 'paid' : 'pending',
        opts.totalAmountCents,
        opts.estimatedPriceCents,
        opts.inspectionFeeCents,
      ],
    );
    const orderId = order.id as string;
    if (opts.paid) {
      await q(
        `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
         VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now() - interval '1 hour')`,
        [`PAYITQ-o-${label}`.slice(0, 24), orderId, ids.customerProfile, opts.totalAmountCents, `idem-itq-o-${label}`, `gw-itq-o-${label}`],
      );
    }
    return orderId;
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
        SavedPaymentMethod,
        ServiceCategory,
        Service,
        ServiceZonePricing,
        ServiceLevelPricing,
        ServiceAddon,
        ServiceStandardData,
        TechnicianProfile,
        TechnicianCompany,
        CustomerProfile,
        LoyaltyTransaction,
        Setting,
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
      `test-city-itq-${runId}`,
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
      `test-category-itq-${runId}`,
    ]);
    ids.category = category.id;

    const [inspectionService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, inspection_fee_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'inspection_then_quote',10000,5000,20,0) RETURNING id`,
      [ids.category, `خدمة معاينة اختبار ${runId}`, `test-inspection-service-${runId}`],
    );
    ids.inspectionService = inspectionService.id;

    const [fixedService] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,20,0) RETURNING id`,
      [ids.category, `خدمة ثابتة اختبار ${runId}`, `test-fixed-service-itq-${runId}`],
    );
    ids.fixedService = fixedService.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2028${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-itq-${runId}@test.local`,
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
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCITQ${runId}`.slice(0, 20)],
    );
    ids.techProfile = techProfile.id;

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);
    catalogService = new CatalogService(
      dataSource.getRepository(ServiceCategory),
      dataSource.getRepository(Service),
      dataSource.getRepository(ServiceZonePricing),
      dataSource.getRepository(ServiceLevelPricing),
      dataSource.getRepository(ServiceAddon),
      dataSource.getRepository(ServiceStandardData),
      settingsService,
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
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);
    savedPaymentMethods = new SavedPaymentMethodsService(dataSource.getRepository(SavedPaymentMethod));

    fakeChargeTokenResult = { succeeded: true, providerReference: 'gw-token-charge', failureReason: null };
    const fakeProvider = {
      providerKey: 'fake-tokenizer',
      supportsTokenization: true,
      chargeToken: async () => fakeChargeTokenResult,
    };
    const paymentProviders = { getByProviderKey: () => fakeProvider, getProvider: () => fakeProvider } as never;

    const events = new EventEmitter2();

    paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never,
      catalogService,
      customerProfilesService,
      techniciansService,
      {} as never,
      {} as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never,
      events,
      paymentProviders,
      savedPaymentMethods,
      {} as never,
      crewEarningsServiceStub(),
    );

    inspectionQuoteService = new InspectionQuoteService(dataSource, customerProfilesService, techniciansService, catalogService, paymentsService, events);
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM payment_methods WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.customerUser, ids.techUser]);
      await q(`DELETE FROM services WHERE id IN ($1, $2)`, [ids.inspectionService, ids.fixedService]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('CatalogService.estimate() لخدمة inspection_then_quote — رسم معاينة بس، صفر سعر أساسي (ADR-0044 §1)', async () => {
    const estimate = await catalogService.estimate(ids.inspectionService, ids.zone);
    expect(estimate.base_price_cents).toBe(0);
    expect(estimate.estimated_total_cents).toBe(0);
    expect(estimate.inspection_fee_cents).toBe(5000);
  });

  it('الفني يحدد سعر بعد المعاينة (technician_arrived) — الطلب ينتقل awaiting_initial_quote_approval', async () => {
    const orderId = await insertOrder(`submit-${runId}`, ids.inspectionService, OrderStatus.TECHNICIAN_ARRIVED, {
      totalAmountCents: 5000,
      estimatedPriceCents: 0,
      inspectionFeeCents: 5000,
      paid: true,
    });

    const order = await inspectionQuoteService.submitInitialQuote(ids.techUser, orderId, 30000, 'محتاج تغيير الموتور بالكامل');
    expect(order.orderStatus).toBe(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL);
    expect(order.estimatedPriceCents).toBe(30000);

    const history = await dataSource.getRepository(OrderStatusHistory).find({ where: { orderId }, order: { createdAt: 'DESC' } });
    expect(history[0].newStatus).toBe(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL);
  });

  it('رفض تحديد سعر لخدمة مش inspection_then_quote (حماية دلالية)', async () => {
    const orderId = await insertOrder(`wrongmodel-${runId}`, ids.fixedService, OrderStatus.TECHNICIAN_ARRIVED, {
      totalAmountCents: 10000,
      estimatedPriceCents: 10000,
      inspectionFeeCents: 0,
      paid: false,
    });
    await expect(inspectionQuoteService.submitInitialQuote(ids.techUser, orderId, 30000)).rejects.toThrow();
  });

  it('رفض تحديد سعر لطلب مش technician_arrived (حماية state machine)', async () => {
    const orderId = await insertOrder(`wrongstatus-${runId}`, ids.inspectionService, OrderStatus.IN_PROGRESS, {
      totalAmountCents: 5000,
      estimatedPriceCents: 0,
      inspectionFeeCents: 5000,
      paid: true,
    });
    await expect(inspectionQuoteService.submitInitialQuote(ids.techUser, orderId, 30000)).rejects.toThrow();
  });

  it('العميل يوافق على السعر بعد المعاينة — total_amount_cents/commissionable_base_cents يتحدّثوا صح، تحصيل فوري للدلتا (ADR-0044 §4)', async () => {
    await savedPaymentMethods.upsertToken({
      customerId: ids.customerProfile,
      provider: 'fake-tokenizer',
      providerToken: `tok-itq-${runId}`,
      cardBrand: 'visa',
      maskedPan: '4242',
    });
    await savedPaymentMethods.setDefault(ids.customerUser, ids.customerProfile, (await savedPaymentMethods.listForCustomer(ids.customerProfile))[0].id);

    const orderId = await insertOrder(`approve-${runId}`, ids.inspectionService, OrderStatus.TECHNICIAN_ARRIVED, {
      totalAmountCents: 5000,
      estimatedPriceCents: 0,
      inspectionFeeCents: 5000,
      paid: true,
    });
    // الوعاء وقت الحجز = رسم المعاينة بس (workPriceCents=0 وقتها) — نفس ما OrdersService.createOrder() كانت هتحسبه فعليًا.
    await dataSource.query(`UPDATE orders SET commissionable_base_cents = 5000 WHERE id = $1`, [orderId]);

    await inspectionQuoteService.submitInitialQuote(ids.techUser, orderId, 30000);
    fakeChargeTokenResult = { succeeded: true, providerReference: 'gw-ref-itq-approve', failureReason: null };
    const order = await inspectionQuoteService.approveInitialQuote(ids.customerUser, orderId, 'electronic');

    expect(order.totalAmountCents).toBe(35000); // 5000 (رسم معاينة) + 30000 (سعر الشغل)
    expect(order.commissionableBaseCents).toBe(35000); // workPriceCents اتضاف بلا شرط سياسة
    expect(order.orderStatus).toBe(OrderStatus.IN_PROGRESS);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null);
    expect(addlPayment?.amountCents).toBe(30000);
    expect(addlPayment?.paymentStatus).toBe(PaymentGatewayStatus.PENDING); // مستنية تأكيد webhook زي أي تحصيل شغل إضافي
  });

  it('العميل اختار كاش للسعر بعد المعاينة — صفر محاولة تحصيل إلكتروني', async () => {
    const orderId = await insertOrder(`approve-cash-${runId}`, ids.inspectionService, OrderStatus.TECHNICIAN_ARRIVED, {
      totalAmountCents: 5000,
      estimatedPriceCents: 0,
      inspectionFeeCents: 5000,
      paid: true,
    });
    await dataSource.query(`UPDATE orders SET commissionable_base_cents = 5000 WHERE id = $1`, [orderId]);

    await inspectionQuoteService.submitInitialQuote(ids.techUser, orderId, 20000);
    const order = await inspectionQuoteService.approveInitialQuote(ids.customerUser, orderId, 'cash');

    expect(order.totalAmountCents).toBe(25000);
    expect(order.commissionableBaseCents).toBe(25000);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null);
    expect(addlPayment).toBeUndefined();
  });

  it('مسار الرفض — awaiting_initial_quote_approval → cancelled_by_customer مسموح ومُدرج في CUSTOMER_CANCELLABLE_STATUSES (ADR-0044 §4، صفر رسوم إلغاء إضافية)', () => {
    expect(canTransition(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL, OrderStatus.CANCELLED_BY_CUSTOMER)).toBe(true);
    expect(CUSTOMER_CANCELLABLE_STATUSES.has(OrderStatus.AWAITING_INITIAL_QUOTE_APPROVAL)).toBe(true);
  });
});
