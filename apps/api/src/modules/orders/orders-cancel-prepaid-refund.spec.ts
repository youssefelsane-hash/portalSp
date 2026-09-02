import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { PaymentsService } from '../payments/payments.service';
import type { PaymentProvider, RefundResult } from '../payments/gateways/payment-provider.interface';
import { Payment, PaymentMethod } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { OrdersService } from './orders.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';
import { REFUND_RESOLVED_EVENT } from '../../common/events/refund-resolved.event';

// اختبار حي ضد Postgres حقيقي — بند 6/§20.7 من تدقيق التسوية المالية: عميل بيلغي بنفسه (مش
// النظام) طلب مدفوع مسبقًا إلكترونيًا (كارت/InstaPay، ADR-0013) قبل ما فني يتعيّن أو بعده قبل
// بدء الشغل. **البَقّة اللي بيثبتها الاختبار ده**: قبل الإصلاح، PaymentsService.refundSystemCancelledOrder()
// كانت مقفولة على CANCELLED_BY_SYSTEM بس — فإلغاء العميل نفسه كان بيسيب paymentStatus=PAID
// معلّقة على طلب CANCELLED_BY_CUSTOMER نهائي، رغم إن نفس السيناريو المالي بالظبط كان بيتصرف صح
// تلقائيًا لو النظام هو اللي لغى (order-auto-cancel-pending-payment.spec.ts). بعد الإصلاح،
// PaymentsService.refundCancelledPrepaidOrder() بقت تتقبل الاتنين، وOrdersService.cancel() بقت
// تناديها لأي طلب paymentStatus=PAID وقت الإلغاء.
describe('OrdersService.cancel() — استرداد تلقائي لطلب مدفوع مسبقًا اتلغى من العميل نفسه (docs/08 §20.7)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  let paymentEvents: { emit: jest.Mock };
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
    /** الافتراضي 30000 — طلب شغل عادي. طلب التقييم بالصور إجماليه = رسم التقييم بس. */
    totalAmountCents?: number;
    assessmentType?: 'remote' | 'onsite';
    priceStatus?: string;
  }) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, placed_at, assessment_type, price_status, remote_assessment_fee_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0, now(), $9, COALESCE($10, 'confirmed'), $11) RETURNING id, order_number`,
      [
        `TESTCPR-${opts.label}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus,
        opts.paymentStatus,
        opts.totalAmountCents ?? 30000,
        opts.assessmentType ?? null,
        opts.priceStatus ?? null,
        opts.assessmentType === 'remote' ? (opts.totalAmountCents ?? 0) : 0,
      ],
    );
    return { orderId: order.id as string, orderNumber: order.order_number as string };
  }

  async function insertSucceededPayment(orderId: string, label: string, amountCents = 30000) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now())`,
      [`PAYCPR-${label}`.slice(0, 24), orderId, ids.customerProfile, amountCents, `idem-cpr-${label}-${Math.random()}`, `gw-cpr-${label}`],
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, Payment, Refund, User, WebhookEvent, WalletTransaction, CustomerProfile],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    // بَقّة نظافة اختبارات متكررة (§63 شريحة 7، نفس اللي اتصلحت في matching-work-opportunity.spec.ts):
    // iso_code عشوائي من حرفين = مساحة صغيرة واحتمال تصادم عالي، وتنظيف afterAll بيفشل على قيود
    // المفاتيح الأجنبية فبيسيب صف دولة ورا كل تشغيلة فاشلة — فالتصادم مسألة وقت وبيكسر سويتات
    // ملهاش أي علاقة بالكود المتغيّر. الحل: نستعمل دولة موجودة بدل ما ننشئ واحدة.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-cpr-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-cpr-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-cpr-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2017${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    paymentEvents = { emit: jest.fn() };
    const paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never, // walletsService — مش متنادى (technicianId=null دايمًا هنا)
      {} as never, // catalogService
      {} as never, // customerProfiles
      {} as never, // techniciansService
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      {} as never, // loyaltyService
      {} as never, // settingsService
      { record: async () => undefined } as never, // auditLog
      paymentEvents as never,
      { getProvider: () => makeFakeProvider() } as never, // paymentProviders
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );

    // OrdersService.cancel() الحقيقية — بس التبعيات اللي فعليًا بتتنادى في المسار ده (طلب بلا
    // cancellation_reason_id، يعني بلا رسوم) بقيتها stub آمن مايتناداش خالص.
    service = new OrdersService(
      dataSource.getRepository(Order),
      {} as never, // technicianOrderCancellations
      {} as never, // orderMedia — مش متنادى في cancel()
      dataSource,
      { record: async () => undefined } as never, // auditLog
      {
        findByUserIdOrThrow: async () => ({ id: ids.customerProfile }) as CustomerProfile,
      } as never, // customerProfiles
      {} as never, // addressesService
      {} as never, // catalogService
      {} as never, // geoService
      {} as never, // techniciansService
      {} as never, // technicianCompaniesService
      {} as never, // scheduleService
      {} as never, // pricingEngineService
      { releaseUsage: async () => undefined } as never, // promoCodesService — الاختبار ده ملوش علاقة بأكواد الخصم
      {} as never, // buildingsService
      // القاعدة الجديدة (docs/08 §112) بتسأل عن أسباب الإلغاء المتاحة للعميل قبل ما ترفض إلغاء
      // بلا سبب. الاختبار ده كله بيلغي بلا سبب عمدًا، فبنمثّل «مفيش أسباب معرّفة».
      { listActive: async () => [] } as never, // cancellationReasonsService
      {} as never, // walletsService
      {} as never, // settingsService
      paymentsService,
      {} as never, // supportService
      { emit: () => undefined } as never, // events
      {} as never, // orderTeamService (docs/08 §35) — مش متنادى في المسار ده
      commissionBaseServiceStub(),
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('العميل يلغي طلب مدفوع (كارت) قبل تعيين فني (SEARCHING_TECHNICIAN) — يترد تلقائيًا فورًا', async () => {
    const { orderId } = await insertOrder({
      label: 'before-assign',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      paymentStatus: OrderPaymentStatus.PAID,
    });
    await insertSucceededPayment(orderId, 'before-assign');

    const cancelled = await service.cancel(ids.customerUser, orderId, {});
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    // refundCancelledPrepaidOrder() بتحصل برّه transaction الإلغاء نفسها (نداء بوابة برّه أي DB
    // transaction ممكن ترجع لورا) — استعلام مباشر من القاعدة يثبت النتيجة الفعلية بعد ما cancel() ترجع.
    const [orderRow] = await dataSource.query(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(orderRow.payment_status).toBe('refunded');

    const [paymentRow] = await dataSource.query(`SELECT payment_status FROM payments WHERE order_id = $1`, [orderId]);
    expect(paymentRow.payment_status).toBe('refunded');

    const [refundRow] = await dataSource.query(`SELECT amount_cents, refund_status FROM refunds WHERE order_id = $1`, [orderId]);
    expect(refundRow.amount_cents).toBe(30000);
    expect(refundRow.refund_status).toBe('completed');
    expect(paymentEvents.emit).toHaveBeenCalledWith(
      REFUND_RESOLVED_EVENT,
      expect.objectContaining({
        orderId,
        customerProfileId: ids.customerProfile,
        amountCents: 30000,
        status: 'completed',
        method: 'original_method',
      }),
    );
  });

  it('العميل يلغي طلب مدفوع (كارت) بعد تعيين فني بس قبل بدء الشغل (ACCEPTED) — يترد تلقائيًا برضه (صفر تسوية أرباح فني تحتاج عكس، لسه ما بدأش شغل)', async () => {
    const { orderId } = await insertOrder({
      label: 'after-assign',
      orderStatus: OrderStatus.ACCEPTED,
      paymentStatus: OrderPaymentStatus.PAID,
    });
    await insertSucceededPayment(orderId, 'after-assign');
    // technicianId مش لازم يكون فني حقيقي هنا — cancel() لا تلمسه خالص، بس نتأكد الانتقال
    // ACCEPTED → CANCELLED_BY_CUSTOMER مسموح (order-state-machine.ts).

    const cancelled = await service.cancel(ids.customerUser, orderId, {});
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const [orderRow] = await dataSource.query(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(orderRow.payment_status).toBe('refunded');
  });

  // **قرار المالك (2026-09-02، docs/08 §117): استرداد كامل دايمًا.**
  //
  // العميل يقدر يلغي وهو في `awaiting_admin_quote` — يعني ممكن يكون الإدارة خلاص فرزت الصور
  // وسعّرت. المالك اختار صراحة إن الرسم يترد **كامل** برضه، مش نسبة ولا صفر.
  //
  // الاختبار ده بيقفل القرار ده: أي تغيير مستقبلي لسياسة الاسترداد (خصم رسم فرز، استرداد جزئي)
  // هيكسّره، فمحدش يغيّرها بالغلط من غير قرار جديد من المالك.
  it('قرار المالك: رسم التقييم بيترد **كامل** لو العميل لغى بعد الدفع — حتى لو الإدارة فرزت', async () => {
    const FEE_CENTS = 7500;
    const { orderId } = await insertOrder({
      label: 'assessment-fee',
      orderStatus: OrderStatus.AWAITING_ADMIN_QUOTE,
      paymentStatus: OrderPaymentStatus.PAID,
      totalAmountCents: FEE_CENTS,
      assessmentType: 'remote',
      priceStatus: 'waiting_assessment',
    });
    await insertSucceededPayment(orderId, 'assessment-fee', FEE_CENTS);

    const cancelled = await service.cancel(ids.customerUser, orderId, {});
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const [orderRow] = await dataSource.query(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(orderRow.payment_status).toBe('refunded');

    const [refundRow] = await dataSource.query(`SELECT amount_cents, refund_status FROM refunds WHERE order_id = $1`, [orderId]);
    // كامل — مش أقل بأي جنيه.
    expect(refundRow.amount_cents).toBe(FEE_CENTS);
    expect(refundRow.refund_status).toBe('completed');
  });

  it('العميل يلغي طلب غير مدفوع (كاش) — مفيش أي محاولة استرداد (regression — مفيش فلوس اتاخدت أصلاً)', async () => {
    const { orderId } = await insertOrder({
      label: 'unpaid-cash',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      paymentStatus: OrderPaymentStatus.UNPAID,
    });

    const cancelled = await service.cancel(ids.customerUser, orderId, {});
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const [orderRow] = await dataSource.query(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]);
    expect(orderRow.payment_status).toBe('unpaid'); // زي ما هي — مفيش استرداد كاذب لطلب مدفعش

    const refunds = await dataSource.query(`SELECT id FROM refunds WHERE order_id = $1`, [orderId]);
    expect(refunds).toHaveLength(0);
  });

  it('استدعاء cancel() مرتين على نفس الطلب المدفوع — الاسترداد يحصل مرة واحدة بس (idempotency، الثانية بترفض ORDR_003 لأن الطلب بقى نهائي أصلاً)', async () => {
    const { orderId } = await insertOrder({
      label: 'idempotent',
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      paymentStatus: OrderPaymentStatus.PAID,
    });
    await insertSucceededPayment(orderId, 'idempotent');

    await service.cancel(ids.customerUser, orderId, {});
    await expect(service.cancel(ids.customerUser, orderId, {})).rejects.toThrow();

    const refunds = await dataSource.query(`SELECT id FROM refunds WHERE order_id = $1`, [orderId]);
    expect(refunds).toHaveLength(1); // مش اتنين — idx_refunds_payment_id_unique + الفحص الأول في refundCancelledPrepaidOrder()
  });
});
