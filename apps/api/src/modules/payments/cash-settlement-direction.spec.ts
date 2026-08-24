import { DataSource } from 'typeorm';
import { ORDER_STATUS_CHANGED_EVENT } from '../../common/events/order-status-changed.event';
import { PaymentsService } from './payments.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import {
  WebhookEvent,
  WebhookProcessingStage,
  WebhookProcessingStatus,
} from './entities/webhook-event.entity';
import { Wallet, PLATFORM_SYSTEM_USER_ID, WalletOwnerType } from './entities/wallet.entity';
import { WalletTransaction, WalletTxType } from './entities/wallet-transaction.entity';
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

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح فجوة محاسبية جوهرية (docs/08 §20 بند 2/3/4، تدقيق
// تسوية مالية شامل قبل الإطلاق): settleAndComplete() كانت دايمًا بتحوّل technicianEarningCents
// من محفظة المنصة لمحفظة الفني بغض النظر عن طريقة الدفع — صحيح للإلكتروني (المنصة فعلاً ماسكة
// الفلوس)، غلط تمامًا للكاش (الفني ماسك المبلغ الكامل من العميل يدًا بيد، فمفروض هو المديون
// للمنصة بالعمولة، مش العكس). النتيجة العملية للبَقّة القديمة: طلب كاش كان بيخلّي رصيد الفني +800ج
// كأن المنصة مدينة له، فيقدر يطلب صرف 800ج إضافيين فوق الـ1000ج اللي ماسكها بالفعل — فلوس مضاعفة.
describe('PaymentsService.settleAndComplete() — اتجاه التسوية الصحيح حسب مين ماسك الفلوس (docs/08 §20)', () => {
  let dataSource: DataSource;
  let service: PaymentsService;
  let walletsService: WalletsService;
  let cache: RedisCacheService;
  let failStatusEventForOrderId: string | null = null;
  let deliveredStatusEvents = 0;

  const runId = Date.now().toString(36);
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service20: '', // عمولة 20%
    serviceZero: '', // عمولة 0%
    customerUser: '',
    customerProfile: '',
    address: '',
    techUser: '',
    techProfile: '',
  };

  async function techWalletBalance(): Promise<number> {
    const [row] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.techUser]);
    // المحفظة نفسها ممكن متتعملش لسه (getOrCreateWallet بيتنادى بس لما فيه حركة فعلية) — قبل أول
    // تسوية، ده يعادل رصيد صفر، مش خطأ.
    return row ? Number(row.balance_cents) : 0;
  }

  let orderSeq = 0;

  async function insertWorkCompletedOrder(label: string, totalAmountCents: number, serviceId: string) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    // بَقّة حقيقية اتلقطت (docs/08 §36.14 — تحقق نهائي شامل): order_number عموده VARCHAR(24)،
    // وكان بيتقص من الآخر (`TESTCSD-${label}`.slice(0, 24)) — أي label طويل (زي
    // "refund-two-payments") كان بياكل الـrunId نفسه بالكامل، يسيب order_number **ثابت** بين كل
    // تشغيلة → تصادم `orders_order_number_key` مع أي تشغيلة سابقة اتقطعت قبل afterAll. أول
    // محاولة إصلاح (قص label بدل runId) جابت بَقّة تانية: أي تلات labels بادئها متشابه ("refund-
    // cash"/"refund-wallet"/"refund-two-payments") كانوا بيتقصّوا لنفس الـ7 حروف ("refund-")
    // فيتصادموا مع بعض جوّه نفس التشغيلة. الإصلاح الصح: نسيب label للتوثيق/debug بس (مش جزء من
    // order_number خالص) ونبني التفرد من مصدرين مضمونين مساحتهم: runId (بين التشغيلات) + عدّاد
    // تسلسلي orderSeq (جوّه نفس التشغيلة) — الاتنين مع بعض أقصر بكتير من 24 حرف دايمًا.
    orderSeq += 1;
    const orderNumber = `TESTCSD-${runId}-${orderSeq}`.slice(0, 24);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'work_completed','unpaid',$7,0) RETURNING id`,
      [orderNumber, ids.customerProfile, ids.techProfile, serviceId, ids.address, ids.zone, totalAmountCents],
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

    // بنستخدم دولة مصر المزروعة بالفعل (migration 0004) بدل إنشاء صف جديد — countries.iso_code
    // عمودها VARCHAR(2) بس، فأي uniqueness scheme محلي (زي حرف من runId) عرضة للتصادم مع نفسه
    // بسرعة عبر تشغيلات متكررة؛ إعادة استخدام صف ثابت موجود أبسط وأضمن (مفيش إنشاء/حذف مطلوب له خالص).
    // بَقّة حقيقية اتلقطت واتصلحت (تدقيق CI، 2026-08-15): migration 0004 بتزرع الدولة بس، مش أي
    // مدينة — الافتراض القديم إن فيه مدينة "مزروعة بالفعل" كان غلط، وبيعدّي بالصدفة بس لو قاعدة
    // البيانات المحلية فيها مدينة متسيبة من اختبار تاني سابق. على قاعدة migrated طازجة (CI) الـSELECT
    // بيرجع صفر صفوف. الحل: ننشئ مدينة الاختبار بنفسنا زي أي صف تاني هنا، ونمسحها في afterAll.
    const [country] = await q(`SELECT id FROM countries WHERE iso_code = 'EG' LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-csd-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-csd-${runId}`],
    );
    ids.category = category.id;
    const [service20] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,20,0) RETURNING id`,
      [ids.category, `خدمة عمولة 20 ${runId}`, `test-service-csd20-${runId}`],
    );
    ids.service20 = service20.id;
    const [serviceZero] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
       VALUES ($1,$2,$3,'fixed',10000,0,0) RETURNING id`,
      [ids.category, `خدمة عمولة صفر ${runId}`, `test-service-csd0-${runId}`],
    );
    ids.serviceZero = serviceZero.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2022${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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
      [`+2023${runId}`.slice(0, 15), `فني اختبار ${runId}`],
    );
    ids.techUser = techUser.id;
    const [techProfile] = await q(
      `INSERT INTO technician_profiles (user_id, technician_code, years_of_experience, current_level) VALUES ($1,$2,3,'new') RETURNING id`,
      [ids.techUser, `TCCSD${runId}`.slice(0, 20)],
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
    // الاختبار يثبت اتجاه الأموال حسب وسيلة الدفع، لا سياسة المستوى القابلة للتعديل من الأدمن.
    const technicianLevelsService = { getOrThrow: async () => ({ commissionAdjustmentPercentage: '0' }) } as never;
    walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    const customerProfilesService = new CustomerProfilesService(dataSource.getRepository(CustomerProfile), dataSource);
    const loyaltyService = new LoyaltyService(dataSource.getRepository(CustomerProfile), dataSource.getRepository(LoyaltyTransaction), dataSource);

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
      { enqueueRecalculation: async () => undefined } as never,
      loyaltyService,
      settingsService,
      { record: async () => undefined } as never,
      {
        emit: (eventName: string, event: { orderId?: string }) => {
          if (eventName !== ORDER_STATUS_CHANGED_EVENT || !event.orderId) return false;
          if (event.orderId === failStatusEventForOrderId) {
            failStatusEventForOrderId = null;
            throw new Error('simulated post-commit event failure');
          }
          deliveredStatusEvents++;
          return true;
        },
      } as never,
      // paymentProviders — cash/wallet مالهمش gatewayTransactionId خالص، فـgoesThroughGateway في
      // refundOrder() بترجع false دايمًا وprovider.refund() مايتنادىش أصلاً هنا؛ supportsRefund=false
      // كافي عشان الفحص يعدّي بأمان.
      { getProvider: () => ({ supportsRefund: false, refund: async () => ({ succeeded: false }) }) } as never,
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
      {} as never, // installments repo (migration 0177)
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCSD-%`]);
    // wallet_transactions بتتحذف بـwallet_id (مش بس reference_id=order) — قيود الاسترداد بترجع
    // referenceType='refund'/referenceId=refund.id، مش الطلب نفسه.
    await q(
      `DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE owner_user_id IN ($1, $2))`,
      [ids.techUser, ids.customerUser],
    );
    await q(`DELETE FROM webhook_events WHERE external_event_id LIKE $1`, [`evt-csd-%${runId}%`]);
    await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCSD-%`]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTCSD-%`]);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTCSD-%`]);
    await q(`DELETE FROM wallets WHERE owner_user_id IN ($1, $2)`, [ids.techUser, ids.customerUser]);
    await q(`DELETE FROM technician_profiles WHERE id = $1`, [ids.techProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.techUser]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM loyalty_transactions WHERE user_id = $1`, [ids.customerUser]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id IN ($1, $2)`, [ids.service20, ids.serviceZero]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    // الدولة (مصر) مش بتاعتنا — صف ثابت مزروع مسبقًا (migration 0004)، مُعاد استخدامه بس، مفيش حذف هنا عمدًا.
    cache.onModuleDestroy();
    await dataSource.destroy();
  });

  it('طلب كاش بالكامل — الفني مديون للمنصة بالعمولة، مش المنصة مدينة له بالأرباح', async () => {
    const before = await techWalletBalance();
    const orderId = await insertWorkCompletedOrder(`cash`, 100000, ids.service20); // 1000ج، عمولة 20% = 200ج

    const payment = await service.collectCash(ids.techUser, orderId);
    expect(payment.amountCents).toBe(100000);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(order?.platformCommissionCents).toBe(20000);
    expect(order?.technicianEarningCents).toBe(80000);

    // الفني ماسك الـ1000ج كاملة، فمفروض رصيده ينزل بـ200ج (العمولة) — مش يزيد بـ800ج
    const after = await techWalletBalance();
    expect(after - before).toBe(-20000);

    // قيد COMMISSION_DEDUCTION فني→منصة، مش ORDER_EARNING منصة→فني
    const txs = await dataSource
      .getRepository(WalletTransaction)
      .find({ where: { referenceId: orderId, referenceType: 'order' } });
    const debitTx = txs.find((t) => t.direction === 'debit');
    expect(debitTx?.transactionType).toBe(WalletTxType.COMMISSION_DEDUCTION);
    expect(debitTx?.amountCents).toBe(20000);
  });

  it('طلب إلكتروني بالكامل (محفظة) — المنصة مدينة للفني بالأرباح (regression: زي زمان بالحرف)', async () => {
    const before = await techWalletBalance();
    const orderId = await insertWorkCompletedOrder(`wallet`, 100000, ids.service20);

    // نفس مسار payWithWallet's Payment insertion بس مباشر (العميل هنا مش الاختبار الأساسي)
    await dataSource.query(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,'wallet','succeeded',$5, now())`,
      [`PAYCSD-w-${runId}`.slice(0, 24), orderId, ids.customerProfile, 100000, `idem-csd-w-${runId}`],
    );

    await dataSource.transaction(async (manager) => {
      const order = await manager.findOneOrFail(Order, { where: { id: orderId } });
      await (service as unknown as { settleAndComplete: (...args: unknown[]) => Promise<Order> }).settleAndComplete(
        manager,
        order,
        PaymentMethod.WALLET,
        ids.customerUser,
        'customer',
      );
    });

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.technicianEarningCents).toBe(80000);

    // المنصة ماسكة الفلوس (دفعت المحفظة الداخلية) — رصيد الفني لازم يزيد بـ800ج كاملة
    const after = await techWalletBalance();
    expect(after - before).toBe(80000);

    const txs = await dataSource
      .getRepository(WalletTransaction)
      .find({ where: { referenceId: orderId, referenceType: 'order' } });
    const creditTx = txs.find((t) => t.direction === 'credit');
    expect(creditTx?.transactionType).toBe(WalletTxType.ORDER_EARNING);
    expect(creditTx?.amountCents).toBe(80000);
  });

  it('timeout ثم webhook ناجح متأخر يصحح PROCESSING مرة واحدة ولا يطلب دفعًا ثانيًا', async () => {
    const orderId = await insertWorkCompletedOrder(`late-webhook`, 100000, ids.service20);
    const [payment] = await dataSource.query(
      `INSERT INTO payments
         (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status,
          idempotency_key, failure_code, failure_message)
       VALUES ($1,$2,$3,100000,'card','processing',$4,
               'GATEWAY_REGISTRATION_OUTCOME_UNKNOWN','gateway timeout')
       RETURNING id`,
      [`PAYCSD-late-${runId}`.slice(0, 24), orderId, ids.customerProfile, `idem-csd-late-${runId}`],
    );
    const balanceBefore = await techWalletBalance();

    await service.finalizeGatewayWebhook(
      `evt-csd-late-${runId}`,
      'TRANSACTION',
      'paymob',
      { scenario: 'late-success-after-timeout' },
      true,
      payment.id,
      true,
      null,
      `gw-csd-late-${runId}`,
      PaymentMethod.CARD,
      100000,
    );

    const settledPayment = await dataSource.getRepository(Payment).findOneByOrFail({ id: payment.id });
    const settledOrder = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });
    expect(settledPayment.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
    expect(settledPayment.gatewayTransactionId).toBe(`gw-csd-late-${runId}`);
    expect(settledOrder.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(settledOrder.paymentStatus).toBe(OrderPaymentStatus.PAID);
    expect((await techWalletBalance()) - balanceBefore).toBe(80000);

    // Provider retries with another event id for the same payment: payment state is the second
    // idempotency boundary, so the duplicate becomes IGNORED without a second ledger effect.
    await service.finalizeGatewayWebhook(
      `evt-csd-late-duplicate-${runId}`,
      'TRANSACTION',
      'paymob',
      { scenario: 'duplicate-late-success' },
      true,
      payment.id,
      true,
      null,
      `gw-csd-late-${runId}`,
      PaymentMethod.CARD,
      100000,
    );
    expect((await techWalletBalance()) - balanceBefore).toBe(80000);
    const duplicateEvent = await dataSource.getRepository(WebhookEvent).findOneByOrFail({
      provider: 'paymob',
      externalEventId: `evt-csd-late-duplicate-${runId}`,
    });
    expect(duplicateEvent.processingStatus).toBe(WebhookProcessingStatus.IGNORED);
  });

  it('فشل event بعد commit يُسترد من checkpoint دائم بلا إعادة التسوية المالية', async () => {
    const orderId = await insertWorkCompletedOrder(`effects-recovery`, 100000, ids.service20);
    const [payment] = await dataSource.query(
      `INSERT INTO payments
         (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key)
       VALUES ($1,$2,$3,100000,'card','processing',$4)
       RETURNING id`,
      [`PAYCSD-eff-${runId}`.slice(0, 24), orderId, ids.customerProfile, `idem-csd-eff-${runId}`],
    );
    const externalEventId = `evt-csd-effects-${runId}`;
    const balanceBefore = await techWalletBalance();
    deliveredStatusEvents = 0;
    failStatusEventForOrderId = orderId;

    await expect(
      service.finalizeGatewayWebhook(
        externalEventId,
        'TRANSACTION',
        'paymob',
        { scenario: 'post-commit-effect-failure' },
        true,
        payment.id,
        true,
        null,
        `gw-csd-effects-${runId}`,
        PaymentMethod.CARD,
        100000,
      ),
    ).rejects.toThrow('simulated post-commit event failure');

    expect((await dataSource.getRepository(Payment).findOneByOrFail({ id: payment.id })).paymentStatus).toBe(
      PaymentGatewayStatus.SUCCEEDED,
    );
    expect((await dataSource.getRepository(Order).findOneByOrFail({ id: orderId })).orderStatus).toBe(OrderStatus.COMPLETED);
    const failedEvent = await dataSource.getRepository(WebhookEvent).findOneByOrFail({ provider: 'paymob', externalEventId });
    expect(failedEvent.processingStatus).toBe(WebhookProcessingStatus.FAILED);
    expect(failedEvent.processingStage).toBe(WebhookProcessingStage.EFFECTS);
    expect(failedEvent.signatureValid).toBe(true);
    expect(failedEvent.retryCount).toBe(1);
    expect(failedEvent.effectsPayload).toEqual(expect.objectContaining({ orderId }));
    expect(deliveredStatusEvents).toBe(0);
    expect((await techWalletBalance()) - balanceBefore).toBe(80000);
    expect(
      await dataSource.getRepository(WalletTransaction).count({ where: { referenceType: 'order', referenceId: orderId } }),
    ).toBe(2);

    await dataSource.query(`UPDATE webhook_events SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [failedEvent.id]);
    expect(
      await dataSource.query(
        `SELECT id FROM webhook_events WHERE id = $1 AND processing_status = 'failed' AND next_retry_at <= now()`,
        [failedEvent.id],
      ),
    ).toHaveLength(1);
    await service.recoverWebhookEvent(failedEvent.id);

    const recoveredEvent = await dataSource.getRepository(WebhookEvent).findOneByOrFail({ provider: 'paymob', externalEventId });
    expect(recoveredEvent.processingStatus).toBe(WebhookProcessingStatus.PROCESSED);
    expect(recoveredEvent.effectsDeliveredAt).not.toBeNull();
    expect(deliveredStatusEvents).toBe(1);
    expect((await techWalletBalance()) - balanceBefore).toBe(80000);
    expect(
      await dataSource.getRepository(WalletTransaction).count({ where: { referenceType: 'order', referenceId: orderId } }),
    ).toBe(2);

    await service.finalizeGatewayWebhook(
      externalEventId,
      'TRANSACTION',
      'paymob',
      { scenario: 'post-commit-effect-failure' },
      true,
      payment.id,
      true,
      null,
      `gw-csd-effects-${runId}`,
      PaymentMethod.CARD,
      100000,
      true,
    );
    expect(deliveredStatusEvents).toBe(1);
  });

  it('طلب مختلط — دفع مسبق إلكتروني (كارت) + دلتا كاش بعد بند إضافي (ADR-0015) — المنصة بتدفع الفرق بس، مش نصيب الفني كامل', async () => {
    // 10000 مقدّم كارت + 2000 دلتا كاش = 12000 إجمالي. عمولة 20% = 2400. أرباح الفني = 9600.
    // الفني ماسك 2000 كاش بس من الـ9600 المفروضة له — المنصة تدفعله الفرق (7600) بس، مش الـ9600 كاملة.
    const before = await techWalletBalance();
    const orderId = await insertWorkCompletedOrder(`mixed`, 120000, ids.service20);
    await dataSource.query(
      `UPDATE orders SET payment_status = 'paid' WHERE id = $1`,
      [orderId],
    );
    await dataSource.query(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now() - interval '1 hour')`,
      [`PAYCSD-m1-${runId}`.slice(0, 24), orderId, ids.customerProfile, 100000, `idem-csd-m1-${runId}`, `gw-csd-m1-${runId}`],
    );

    // بند إضافي اتوافق عليه بعد الدفع المسبق — الطلب بينتقل AWAITING_PAYMENT، ودلتا 20000 تتحصّل كاش
    await service.settleAlreadyPaidOrder(orderId);
    let order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.AWAITING_PAYMENT);

    const deltaPayment = await service.collectCash(ids.techUser, orderId);
    expect(deltaPayment.amountCents).toBe(20000); // الدلتا بس، مش الإجمالي

    order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(order?.technicianEarningCents).toBe(96000); // 80% من 120000
    expect(order?.platformCommissionCents).toBe(24000);

    // المنصة ماسكة 100000 (كارت)، الفني ماسك 20000 (كاش دلتا). نصيب الفني العادل 96000 —
    // المنصة تدفعله الفرق بس (96000-20000=76000)، مش الـ96000 كاملة (كان ده هيبقى فلوس مضاعفة).
    const after = await techWalletBalance();
    expect(after - before).toBe(76000);
  });

  it('طلب كاش بعمولة صفر — مفيش حركة محفظة خالص (الفني ماسك بالظبط نصيبه العادل)', async () => {
    const before = await techWalletBalance();
    const orderId = await insertWorkCompletedOrder(`zero`, 50000, ids.serviceZero);

    await service.collectCash(ids.techUser, orderId);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.platformCommissionCents).toBe(0);
    expect(order?.technicianEarningCents).toBe(50000);

    const after = await techWalletBalance();
    expect(after).toBe(before); // صفر تغيير — netMovement=0

    const txs = await dataSource
      .getRepository(WalletTransaction)
      .find({ where: { referenceId: orderId, referenceType: 'order' } });
    expect(txs).toHaveLength(0);
  });

  it('استرداد كامل لطلب كاش — الفني بيبقى مديون بكامل المبلغ (مش بس العمولة)، العميل بياخد رد كامل', async () => {
    // مقارنة بالفرق (delta) مش قيمة مطلقة — رصيد الفني تراكمي عبر كل it() في الملف ده (نفس
    // الفني/المحفظة)، مش معزول لكل اختبار لوحده.
    const techBalanceBefore = await techWalletBalance();
    const customerWalletBefore = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]);
    const customerBalanceBefore = customerWalletBefore.length > 0 ? Number(customerWalletBefore[0].balance_cents) : 0;

    const orderId = await insertWorkCompletedOrder(`refund-cash`, 100000, ids.service20);
    await service.collectCash(ids.techUser, orderId);

    const techBalanceAfterSettlement = await techWalletBalance();
    expect(techBalanceAfterSettlement - techBalanceBefore).toBe(-20000); // مديون بالعمولة بس لحد كده

    const refund = await service.refundOrder(ids.customerUser, orderId, 'اختبار استرداد كاش كامل');
    expect(refund.refundType).toBe('full');
    expect(refund.refundMethod).toBe('wallet_credit');

    // بعد الاسترداد الكامل: الفني لازم يبقى مديون بالـ1000ج كاملة (مش الـ200ج بس) — لازم يرجّع
    // كل اللي ماسكه، مش بس العمولة، لأن الطلب اتلغى بالكامل.
    const techBalanceAfterRefund = await techWalletBalance();
    expect(techBalanceAfterRefund - techBalanceBefore).toBe(-100000);

    // العميل بياخد الـ1000ج كاملة رد في محفظته
    const customerWalletAfter = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]);
    const customerBalanceAfter = Number(customerWalletAfter[0].balance_cents);
    expect(customerBalanceAfter - customerBalanceBefore).toBe(100000);

    // ميزان محاسبي: التغيير الصافي لرصيد الفني + العميل من العملية دي بالكامل لازم يفضل صفر —
    // مفيش فلوس اختفت أو اتضاعفت (المنصة استلمت 1000 من الفني — 200 عمولة + 800 عكس أرباح —
    // ودفعت 1000 للعميل، صافي أثرها على محفظتها = صفر من العملية دي).
    const techDelta = techBalanceAfterRefund - techBalanceBefore;
    const customerDelta = customerBalanceAfter - customerBalanceBefore;
    expect(techDelta + customerDelta).toBe(0);
  });

  it('استرداد كامل لطلب إلكتروني — رصيد الفني يرجع صفر (عكس الائتمان، regression)', async () => {
    const orderId = await insertWorkCompletedOrder(`refund-wallet`, 100000, ids.service20);
    await dataSource.query(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,'wallet','succeeded',$5, now())`,
      [`PAYCSD-rw-${runId}`.slice(0, 24), orderId, ids.customerProfile, 100000, `idem-csd-rw-${runId}`],
    );
    const techBalanceBefore = await techWalletBalance();
    await dataSource.transaction(async (manager) => {
      const order = await manager.findOneOrFail(Order, { where: { id: orderId } });
      await (service as unknown as { settleAndComplete: (...args: unknown[]) => Promise<Order> }).settleAndComplete(
        manager,
        order,
        PaymentMethod.WALLET,
        ids.customerUser,
        'customer',
      );
    });
    const techBalanceAfterSettlement = await techWalletBalance();
    expect(techBalanceAfterSettlement - techBalanceBefore).toBe(80000);

    await service.refundOrder(ids.customerUser, orderId, 'اختبار استرداد إلكتروني كامل');

    const techBalanceAfterRefund = await techWalletBalance();
    expect(techBalanceAfterRefund).toBe(techBalanceBefore); // رجع لنفس القيمة قبل التسوية بالظبط
  });

  it('استرداد دفعتين مختلفتين بالتوازي يجمع حالة الطلب مرة واحدة بلا lost update أو عكس مزدوج', async () => {
    const orderId = await insertWorkCompletedOrder(`refund-two-payments`, 100000, ids.service20);
    const payments = await dataSource.query(
      `INSERT INTO payments
         (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status,
          idempotency_key, completed_at)
       VALUES
         ($1,$2,$3,60000,'wallet','succeeded',$4,now()),
         ($5,$2,$3,40000,'wallet','succeeded',$6,now())
       RETURNING id, amount_cents`,
      [
        `PAYCSD-2A-${runId}`.slice(0, 24),
        orderId,
        ids.customerProfile,
        `idem-csd-2a-${runId}`,
        `PAYCSD-2B-${runId}`.slice(0, 24),
        `idem-csd-2b-${runId}`,
      ],
    );
    const techBalanceBefore = await techWalletBalance();
    const [customerBeforeRow] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [
      ids.customerUser,
    ]);
    const customerBalanceBefore = customerBeforeRow ? Number(customerBeforeRow.balance_cents) : 0;

    await dataSource.transaction(async (manager) => {
      const order = await manager.findOneOrFail(Order, { where: { id: orderId } });
      await (service as unknown as { settleAndComplete: (...args: unknown[]) => Promise<Order> }).settleAndComplete(
        manager,
        order,
        PaymentMethod.WALLET,
        ids.customerUser,
        'customer',
      );
    });
    expect((await techWalletBalance()) - techBalanceBefore).toBe(80000);

    const outcomes = await Promise.allSettled([
      service.refundOrder(ids.customerUser, orderId, 'استرداد الدفعة أ', undefined, undefined, payments[0].id),
      service.refundOrder(ids.customerUser, orderId, 'استرداد الدفعة ب', undefined, undefined, payments[1].id),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(2);

    const persistedPayments = await dataSource.getRepository(Payment).find({ where: { orderId } });
    expect(persistedPayments).toHaveLength(2);
    expect(persistedPayments.every((payment) => payment.paymentStatus === PaymentGatewayStatus.REFUNDED)).toBe(true);
    const refunds = await dataSource.getRepository(Refund).find({ where: { orderId } });
    expect(refunds).toHaveLength(2);
    expect(refunds.reduce((sum, refund) => sum + refund.amountCents, 0)).toBe(100000);

    const order = await dataSource.getRepository(Order).findOneByOrFail({ id: orderId });
    expect(order.paymentStatus).toBe(OrderPaymentStatus.REFUNDED);
    expect(order.orderStatus).toBe(OrderStatus.REFUNDED);
    expect(
      await dataSource.getRepository(OrderStatusHistory).count({ where: { orderId, newStatus: OrderStatus.REFUNDED } }),
    ).toBe(1);

    const refundTxs = await dataSource.query(
      `SELECT wt.reference_id, wt.direction, wt.amount_cents, w.owner_type
       FROM wallet_transactions wt
       JOIN wallets w ON w.id = wt.wallet_id
       WHERE wt.reference_type = 'refund'
         AND wt.reference_id = ANY($1::uuid[])`,
      [refunds.map((refund) => refund.id)],
    );
    expect(refundTxs).toHaveLength(8); // two balanced entries for earning reversal + two for customer credit per refund
    expect(
      refundTxs
        .filter((tx: { owner_type: string; direction: string }) => tx.owner_type === 'technician' && tx.direction === 'debit')
        .reduce((sum: number, tx: { amount_cents: number }) => sum + Number(tx.amount_cents), 0),
    ).toBe(80000);
    expect(
      refundTxs
        .filter((tx: { owner_type: string; direction: string }) => tx.owner_type === 'customer' && tx.direction === 'credit')
        .reduce((sum: number, tx: { amount_cents: number }) => sum + Number(tx.amount_cents), 0),
    ).toBe(100000);
    expect(await techWalletBalance()).toBe(techBalanceBefore);
    const [customerAfterRow] = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [
      ids.customerUser,
    ]);
    expect(Number(customerAfterRow.balance_cents) - customerBalanceBefore).toBe(100000);
  });

  // §20 بند 6 — تغيير السعر النهائي لأقل (المثال أ من طلب المالك): مفيش مسار منفصل مطلوب، إعادة
  // استخدام refundOrder() الموجودة بمبلغ استرداد جزئي = الفرق. الاختبارين دول بيثبتوا إن الصيغة
  // النسبية الموجودة أصلاً (technicianReversalCents = earning × refund/paymentTotal) بتحسب صافي دَين
  // الفني الصح تلقائيًا حتى مع كاش — من غير أي كود جديد.
  it('استرداد جزئي لطلب كاش (تصحيح سعر نهائي لأقل) — دَين الفني = العمولة المصححة + الكاش الزيادة المردودة', async () => {
    // طلب 1000ج (عمولة 20% = 200، أرباح 800)، السعر الصح طلع 900ج بس (100ج زيادة اترد للعميل).
    // دَين الفني الصح = عمولة 900*20%=180 + الـ100 الزيادة اللي المنصة ردّتها للعميل بدل الفني مباشرة = 280.
    const techBalanceBefore = await techWalletBalance();
    const customerWalletBefore = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]);
    const customerBalanceBefore = customerWalletBefore.length > 0 ? Number(customerWalletBefore[0].balance_cents) : 0;

    const orderId = await insertWorkCompletedOrder(`partial-cash`, 100000, ids.service20);
    await service.collectCash(ids.techUser, orderId);

    const refund = await service.refundOrder(ids.customerUser, orderId, 'تصحيح سعر نهائي — 100ج زيادة', 10000);
    expect(refund.refundType).toBe('partial');
    expect(refund.refundMethod).toBe('wallet_credit');

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED); // استرداد جزئي مايغيّرش حالة الطلب
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.PARTIALLY_REFUNDED);

    const techBalanceAfter = await techWalletBalance();
    expect(techBalanceAfter - techBalanceBefore).toBe(-28000); // -200 (عمولة) - 80 (عكس نسبي) = -280ج

    const customerWalletAfter = await dataSource.query(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [ids.customerUser]);
    const customerBalanceAfter = Number(customerWalletAfter[0].balance_cents);
    expect(customerBalanceAfter - customerBalanceBefore).toBe(10000); // العميل ياخد الفرق بالظبط
  });

  it('استرداد جزئي لطلب إلكتروني (تصحيح سعر نهائي لأقل) — رصيد الفني يرجع مطابق للعمولة المصححة بالظبط', async () => {
    const orderId = await insertWorkCompletedOrder(`partial-wallet`, 100000, ids.service20);
    await dataSource.query(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,'wallet','succeeded',$5, now())`,
      [`PAYCSD-pw-${runId}`.slice(0, 24), orderId, ids.customerProfile, 100000, `idem-csd-pw-${runId}`],
    );
    const techBalanceBeforeSettlement = await techWalletBalance();
    await dataSource.transaction(async (manager) => {
      const order = await manager.findOneOrFail(Order, { where: { id: orderId } });
      await (service as unknown as { settleAndComplete: (...args: unknown[]) => Promise<Order> }).settleAndComplete(
        manager,
        order,
        PaymentMethod.WALLET,
        ids.customerUser,
        'customer',
      );
    });

    await service.refundOrder(ids.customerUser, orderId, 'تصحيح سعر نهائي — 100ج زيادة', 10000);

    // المنصة ماسكة الفلوس أصلاً — بعد التصحيح لازم رصيد الفني يطابق أرباح الـ900ج الصح (720ج) بالظبط
    const techBalanceAfter = await techWalletBalance();
    expect(techBalanceAfter - techBalanceBeforeSettlement).toBe(72000);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.PARTIALLY_REFUNDED);
  });

  it('استرداد دفعة عمل إضافي أصغر يعكس حصتها من إجمالي أرباح الطلب فقط، ثم يقفل الطلب بعد استرداد الدفعة الأساسية أيضًا', async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, technician_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,$6,'completed','paid',120000,96000) RETURNING id`,
      [
        `TESTCSD-component-${runId}`.slice(0, 24),
        ids.customerProfile,
        ids.techProfile,
        ids.service20,
        ids.address,
        ids.zone,
      ],
    );
    const [basePayment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,100000,'wallet','succeeded',$4,now()) RETURNING id`,
      [`PAYCSD-base-${runId}`.slice(0, 24), order.id, ids.customerProfile, `idem-csd-base-${runId}`],
    );
    const [additionalPayment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,20000,'wallet','succeeded',$4,now()) RETURNING id`,
      [`PAYCSD-add-${runId}`.slice(0, 24), order.id, ids.customerProfile, `idem-csd-add-${runId}`],
    );

    const techBalanceBefore = await techWalletBalance();
    await service.refundOrder(ids.customerUser, order.id, 'استرداد بند عمل إضافي', undefined, undefined, additionalPayment.id);

    // 20,000 / 120,000 من أرباح الفني 96,000 = 16,000 فقط. القسمة على مبلغ الدفعة (20,000)
    // كانت ستعكس 96,000 كاملة — بَقّة مالية جوهرية.
    expect((await techWalletBalance()) - techBalanceBefore).toBe(-16000);
    let reloadedOrder = await dataSource.getRepository(Order).findOneByOrFail({ id: order.id });
    expect(reloadedOrder.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(reloadedOrder.paymentStatus).toBe(OrderPaymentStatus.PARTIALLY_REFUNDED);
    expect((await dataSource.getRepository(Payment).findOneByOrFail({ id: additionalPayment.id })).paymentStatus).toBe(
      PaymentGatewayStatus.REFUNDED,
    );

    await service.refundOrder(ids.customerUser, order.id, 'استرداد الدفعة الأساسية', undefined, undefined, basePayment.id);
    reloadedOrder = await dataSource.getRepository(Order).findOneByOrFail({ id: order.id });
    expect(reloadedOrder.orderStatus).toBe(OrderStatus.REFUNDED);
    expect(reloadedOrder.paymentStatus).toBe(OrderPaymentStatus.REFUNDED);
    expect((await techWalletBalance()) - techBalanceBefore).toBe(-96000);
  });
});
