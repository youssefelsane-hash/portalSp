import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderItemsService } from './order-items.service';
import { Order, OrderStatus } from './entities/order.entity';
import { AdditionalWorkProposalStatus, OrderItem, OrderItemType } from './entities/order-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { PaymentsService } from '../payments/payments.service';
import { Payment, PaymentGatewayStatus, PaymentMethod } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { SavedPaymentMethod } from '../payments/entities/saved-payment-method.entity';
import { SavedPaymentMethodsService } from '../payments/saved-payment-methods.service';
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
import { CustomerProfilesService } from '../customers/customer-profiles.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { LoyaltyService } from '../promotions/loyalty.service';
import { LoyaltyTransaction } from '../promotions/entities/loyalty-transaction.entity';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';
import { OrderFinancialFinalizationService } from '../pricing/order-financial-finalization.service';

// اختبار حي ضد Postgres حقيقي — تحصيل شغل إضافي معتمد إلكترونيًا بوسيلة دفع محفوظة (docs/08 §21).
// بيغطي الثوابت المالية الحرجة: موافقة العميل = obligation واحد بس (§12)، مفيش وسيلة دفع محفوظة =
// الفشل يفضل obligation واضح مش يختفي (§10/§18)، amountOwedNow() بتحسب صح لو المحاولة الفورية
// نجحت (صفر تحصيل مزدوج وقت الاكتمال، §9/§11)، رفض العميل = صفر تأثير مالي (§2)، webhook مكرر =
// صفر تأثير مزدوج (§13).
describe('OrderItemsService.approve() × تحصيل شغل إضافي إلكتروني (docs/08 §21)', () => {
  let dataSource: DataSource;
  let orderItemsService: OrderItemsService;
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
    service: '',
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
  };

  async function insertPrepaidOrder(label: string, totalAmountCents: number): Promise<string> {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','paid',$7,0) RETURNING id`,
      // `runId` في رقم الطلب مش تجميل: `orders.order_number` عليه UNIQUE، و`TESTAWP-<label>`
      // الثابت كان معناه إن أي تشغيلة اتقطعت قبل التنظيف بتقفل السبيك **للأبد** على نفس القاعدة
      // (حصلت فعلاً: صفوف متروكة من 2026-09-02 كانت بتفشّلها بـduplicate key بلا أي علاقة
      // بالمنطق اللي بتختبره). وكمان بيمنع تصادم تشغيلتين متوازيتين على نفس قاعدة CI.
      [`TAWP-${runId}-${label}`.slice(0, 24), ids.customerProfile, ids.techProfile, ids.service, ids.address, ids.zone, totalAmountCents],
    );
    const orderId = order.id as string;
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now() - interval '1 hour')`,
      [`PAYAWP-o-${label}`.slice(0, 24), orderId, ids.customerProfile, totalAmountCents, `idem-awp-o-${label}`, `gw-awp-o-${label}`],
    );
    return orderId;
  }

  async function amountOwedNowFor(orderId: string): Promise<number> {
    const order = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    return (paymentsService as unknown as { amountOwedNow: (o: Order) => Promise<number> }).amountOwedNow(order);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        Order,
        OrderItem,
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
      `test-city-awp-${runId}`,
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
      `test-category-awp-${runId}`,
    ]);
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'formula',10000,20,0) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-awp-${runId}`],
    );
    ids.service = service.id;

    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type, email) VALUES ($1,$2,'customer',$3) RETURNING id`, [
      `+2026${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
      `customer-awp-${runId}@test.local`,
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
      `+2027${runId}`.slice(0, 15),
      `فني اختبار ${runId}`,
    ]);
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCAWP${runId}`.slice(0, 20)],
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
      {} as never,
      {} as never, // docs/08 §36.24 ADR-0025 — ServicePricingTierPricing repo جديد
    );
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
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource, settingsService);
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
      {} as never, // walletsService — مش متنادى (الاختبارات دي بتغطي مسار الدفع الإضافي بس، مش التسوية)
      catalogService,
      customerProfilesService,
      techniciansService,
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never, // auditLog
      events,
      paymentProviders,
      savedPaymentMethods,
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );

    orderItemsService = new OrderItemsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(OrderItem),
      dataSource,
      customerProfilesService,
      techniciansService,
      paymentsService,
      events,
      commissionBaseServiceStub(),
      new OrderFinancialFinalizationService(),
    );
  });

  beforeEach(async () => {
    if (!dataSource?.isInitialized || !ids.customerProfile) return;
    // Each scenario owns a separate order; retire the previous fixture so the
    // production one-active-order-per-technician invariant remains exercised.
    await dataSource.query(
      `UPDATE orders
       SET order_status = 'completed'
       WHERE customer_id = $1
         AND order_number LIKE 'TESTAWP-%'
         AND order_status IN (
           'accepted', 'technician_on_way', 'technician_arrived', 'in_progress',
           'awaiting_quote_approval', 'work_completed', 'awaiting_payment'
         )`,
      [ids.customerProfile],
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    try {
      await q(`DELETE FROM webhook_events WHERE external_event_id LIKE $1`, [`evt-awp-%${runId}%`]);
      // كانت ناقصة، والنتيجة إن التنظيف بيقع على FK وسط الطريق فيسيب طلبات ورا: تعيين الفني
      // بينشئ `chat_threads` تلقائيًا، وحذف الطلب قبلها بيرفع
      // `chat_threads_order_id_fkey`. أي تشغيلة بتفشل هنا بتلوّث قاعدة التطوير للتشغيلة اللي بعدها.
      await q(
        `DELETE FROM chat_messages WHERE thread_id IN (
           SELECT id FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1))`,
        [ids.customerProfile],
      );
      await q(`DELETE FROM chat_threads WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
      await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM payment_methods WHERE customer_id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
      await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.customerUser, ids.techUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    } finally {
      cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  it('مفيش وسيلة دفع محفوظة — المحاولة تفشل فورًا بـobligation واضح، المبلغ يفضل مستحق (§10/§18)', async () => {
    const orderId = await insertPrepaidOrder(`nosaved-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.SPARE_PART, name_ar: 'قطعة اختبار', quantity: 1, unit_price_cents: 15000 },
    ]);
    const { order } = await orderItemsService.approve(ids.customerUser, orderId);
    expect(order.totalAmountCents).toBe(115000);
    expect(order.orderStatus).toBe(OrderStatus.IN_PROGRESS);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null);
    expect(addlPayment?.amountCents).toBe(15000);
    expect(addlPayment?.paymentStatus).toBe(PaymentGatewayStatus.FAILED);
    expect(addlPayment?.failureCode).toBe('NO_SAVED_PAYMENT_METHOD');

    const owed = await amountOwedNowFor(orderId);
    expect(owed).toBe(15000); // المبلغ فضل obligation واضح، مش اختفى
  });

  it('وسيلة دفع محفوظة + المحاولة الفورية نجحت + تأكيد webhook — amountOwedNow() تساوي صفر (صفر تحصيل مزدوج، §9/§11)', async () => {
    await savedPaymentMethods.upsertToken({
      customerId: ids.customerProfile,
      provider: 'fake-tokenizer',
      providerToken: `tok-${runId}`,
      cardBrand: 'visa',
      maskedPan: '4242',
    });

    const orderId = await insertPrepaidOrder(`saved-ok-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.EXTRA_LABOR, name_ar: 'أجرة إضافية', quantity: 1, unit_price_cents: 15000 },
    ]);
    fakeChargeTokenResult = { succeeded: true, providerReference: 'gw-ref-ok', failureReason: null };
    await orderItemsService.approve(ids.customerUser, orderId);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null)!;
    expect(addlPayment.paymentStatus).toBe(PaymentGatewayStatus.PENDING); // مستنية تأكيد webhook نهائي (§13)، مش succeeded لسه

    let owed = await amountOwedNowFor(orderId);
    expect(owed).toBe(15000); // لسه pending، مش succeeded — لازم يفضل مستحق لحد التأكيد

    // تأكيد webhook (مصدر الحقيقة النهائي، §13) — نفس المسار اللي WebhooksController بينادّيه فعليًا
    await paymentsService.finalizeGatewayWebhook(
      `evt-awp-ok-${runId}`,
      'TRANSACTION',
      'fake-tokenizer',
      {},
      true,
      addlPayment.id,
      true,
      null,
      'gw-ref-ok-final',
      PaymentMethod.CARD,
      15000,
    );

    const addlPaymentAfter = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: addlPayment.id } });
    expect(addlPaymentAfter.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);

    const orderAfter = await dataSource.getRepository(Order).findOneOrFail({ where: { id: orderId } });
    expect(orderAfter.orderStatus).toBe(OrderStatus.IN_PROGRESS); // الطلب فضل شغال — الويب-هوك ده مايقفلش الطلب

    owed = await amountOwedNowFor(orderId);
    expect(owed).toBe(0); // اتحصّل بالكامل — صفر تحصيل مزدوج وقت الاكتمال
  });

  it('webhook مكرر لنفس الحدث — صفر تأثير مزدوج (idempotency، §13)', async () => {
    await savedPaymentMethods.upsertToken({
      customerId: ids.customerProfile,
      provider: 'fake-tokenizer',
      providerToken: `tok-dup-${runId}`,
      cardBrand: 'visa',
      maskedPan: '1111',
    });
    await savedPaymentMethods.setDefault(ids.customerUser, ids.customerProfile, (await savedPaymentMethods.listForCustomer(ids.customerProfile))[0].id);

    const orderId = await insertPrepaidOrder(`dupwebhook-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.ADDON, name_ar: 'إضافة اختبار', quantity: 1, unit_price_cents: 8000 },
    ]);
    fakeChargeTokenResult = { succeeded: true, providerReference: 'gw-ref-dup', failureReason: null };
    await orderItemsService.approve(ids.customerUser, orderId);

    const addlPayment = (await dataSource.getRepository(Payment).find({ where: { orderId } })).find((p) => p.orderItemBatchId !== null)!;

    const eventId = `evt-awp-dup-${runId}`;
    for (let i = 0; i < 2; i++) {
      await paymentsService.finalizeGatewayWebhook(eventId, 'TRANSACTION', 'fake-tokenizer', {}, true, addlPayment.id, true, null, 'gw-final-dup', PaymentMethod.CARD, 8000);
    }

    const addlPaymentAfter = await dataSource.getRepository(Payment).findOneOrFail({ where: { id: addlPayment.id } });
    expect(addlPaymentAfter.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
    const owed = await amountOwedNowFor(orderId);
    expect(owed).toBe(0); // مفيش أي تأثير مالي مزدوج من إعادة إرسال نفس الحدث
  });

  it('العميل رفض البنود — صفر تأثير مالي وصفر محاولة دفع، مع بقاء الدليل المرفوض قابلًا للمراجعة (§2)', async () => {
    const orderId = await insertPrepaidOrder(`declined-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.SPARE_PART, name_ar: 'قطعة مرفوضة', quantity: 1, unit_price_cents: 20000 },
    ]);
    const { order } = await orderItemsService.decline(ids.customerUser, orderId);
    expect(order.totalAmountCents).toBe(100000); // زي ما هو، صفر تغيير

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null);
    expect(addlPayment).toBeUndefined(); // صفر محاولة دفع خالص

    const [declined] = await dataSource.getRepository(OrderItem).find({ where: { orderId } });
    expect(declined).toBeDefined();
    expect(declined.proposalStatus).toBe(AdditionalWorkProposalStatus.DECLINED);
    expect(declined.declinedAt).not.toBeNull();
    expect(declined.declinedByUserId).toBe(ids.customerUser);
  });

  it('العميل اختار الدفع كاش للمبلغ الإضافي — صفر محاولة تحصيل إلكتروني، الدلتا تتجمّع في total_amount_cents بس (docs/08 §22 بند 8)', async () => {
    const orderId = await insertPrepaidOrder(`cashchoice-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.SPARE_PART, name_ar: 'قطعة اختارها العميل كاش', quantity: 1, unit_price_cents: 12000 },
    ]);
    const { order } = await orderItemsService.approve(ids.customerUser, orderId, 'cash');
    expect(order.totalAmountCents).toBe(112000);
    expect(order.orderStatus).toBe(OrderStatus.IN_PROGRESS);

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    const addlPayment = payments.find((p) => p.orderItemBatchId !== null);
    expect(addlPayment).toBeUndefined(); // صفر محاولة دفع إلكتروني خالص لما العميل يختار كاش

    // الدلتا لسه جزء من amountOwedNow (مش اختفت) — هتتحصّل كاش وقت الاكتمال زي أي طلب مختلط
    const owed = await amountOwedNowFor(orderId);
    expect(owed).toBe(12000);
  });

  it('أكتر من طلب شغل إضافي مستقل على نفس الطلب — كل دفعة قابلة للتتبع لوحدها (docs/08 §22 بند 7)', async () => {
    const orderId = await insertPrepaidOrder(`multibatch-${runId}`, 100000);

    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.SPARE_PART, name_ar: 'قطعة أولى', quantity: 1, unit_price_cents: 5000 },
    ]);
    const first = await orderItemsService.approve(ids.customerUser, orderId, 'cash');
    expect(first.order.totalAmountCents).toBe(105000);

    // دورة تانية مستقلة — الطلب رجع in_progress بعد الموافقة الأولى، فالفني يقدر يقترح تاني
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.EXTRA_LABOR, name_ar: 'أجرة إضافية تانية', quantity: 1, unit_price_cents: 7000 },
    ]);
    const second = await orderItemsService.approve(ids.customerUser, orderId, 'cash');
    expect(second.order.totalAmountCents).toBe(112000); // 100000 + 5000 + 7000، صفر تعارض بين الدفعتين

    const allItems = await dataSource.getRepository(OrderItem).find({ where: { orderId } });
    const batchIds = new Set(allItems.map((i) => i.batchId));
    expect(batchIds.size).toBe(2); // دفعتين مستقلتين فعلاً، مش دفعة واحدة اتلخبطت
    expect(allItems.every((i) => i.isCustomerApproved)).toBe(true);
  });

  it('idempotencyKey فريد على مستوى الـDB — محاولتين لنفس batchId يترفض تانيهم بوضوح (§12، حماية إضافية تحت مستوى القفل)', async () => {
    const orderId = await insertPrepaidOrder(`dbunique-${runId}`, 100000);
    const batchId = randomUUID();
    await paymentsService.attemptAdditionalWorkCharge(orderId, batchId, 5000);
    await expect(paymentsService.attemptAdditionalWorkCharge(orderId, batchId, 5000)).rejects.toThrow();

    const payments = await dataSource.getRepository(Payment).find({ where: { orderId, orderItemBatchId: batchId } });
    expect(payments.length).toBe(1); // صف واحد بس اتسجّل، مش اتنين
  });

  it('propose × propose المتزامن يسمح بـbatch معلّق واحد فقط ويرجع تعارض نطاق واضح للطلب الآخر', async () => {
    const orderId = await insertPrepaidOrder(`propose-race-${runId}`, 100000);
    const results = await Promise.allSettled([
      orderItemsService.propose(ids.techUser, orderId, [
        { item_type: OrderItemType.SPARE_PART, name_ar: 'اقتراح متزامن أ', quantity: 1, unit_price_cents: 5000 },
      ]),
      orderItemsService.propose(ids.techUser, orderId, [
        { item_type: OrderItemType.EXTRA_LABOR, name_ar: 'اقتراح متزامن ب', quantity: 1, unit_price_cents: 7000 },
      ]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const pending = await dataSource.getRepository(OrderItem).find({
      where: { orderId, proposalStatus: AdditionalWorkProposalStatus.PENDING },
    });
    expect(pending).toHaveLength(1);
    expect(new Set(pending.map((item) => item.batchId)).size).toBe(1);
  });

  it('approve × decline المتزامن يختار قرارًا نهائيًا واحدًا، من دون حذف أو total_amount متناقض', async () => {
    const orderId = await insertPrepaidOrder(`decision-race-${runId}`, 100000);
    await orderItemsService.propose(ids.techUser, orderId, [
      { item_type: OrderItemType.SPARE_PART, name_ar: 'بند قرار متزامن', quantity: 1, unit_price_cents: 9000 },
    ]);

    const results = await Promise.allSettled([
      orderItemsService.approve(ids.customerUser, orderId, 'cash'),
      orderItemsService.decline(ids.customerUser, orderId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });
    const [item] = await dataSource.getRepository(OrderItem).find({ where: { orderId } });
    expect(item).toBeDefined();
    expect(order.orderStatus).toBe(OrderStatus.IN_PROGRESS);
    if (item.proposalStatus === AdditionalWorkProposalStatus.APPROVED) {
      expect(order.totalAmountCents).toBe(109000);
      expect(item.isCustomerApproved).toBe(true);
    } else {
      expect(item.proposalStatus).toBe(AdditionalWorkProposalStatus.DECLINED);
      expect(order.totalAmountCents).toBe(100000);
      expect(item.isCustomerApproved).toBe(false);
    }
  });
});
