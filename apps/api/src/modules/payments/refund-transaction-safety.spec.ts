import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order, OrderStatus, OrderPaymentStatus } from '../orders/entities/order.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund, RefundStatus } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import type { PaymentProvider, RefundResult } from './gateways/payment-provider.interface';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح بَقّة distributed-transaction حقيقية (docs/08 §19
// بند 4): كان provider.refund() (نداء خارجي حقيقي للبوابة) بينفّذ جوّه DB transaction واحدة مع
// باقي الكتابة — لو نجح فعليًا عند البوابة وبعده خطوة تانية جوّه نفس الـtransaction فشلت، DB
// rollback بيمحي كل حاجة بينما الفلوس فعليًا اترجعت عند البوابة، ونظامنا مش عارف. الإصلاح:
// تقسيم لتلات مراحل (تسجيل PROCESSING قبل النداء، النداء نفسه برّه أي transaction، تسجيل
// النتيجة بعده في transaction منفصلة) — provider مزيّف هنا بيتحقق فعليًا من وجود صف Refund
// بحالة PROCESSING **قبل** ما ينفّذ، عشان نثبت الترتيب الفعلي مش نفترضه.
describe('PaymentsService.refundOrder() — أمان الـtransaction الموزّعة (regression)', () => {
  let dataSource: DataSource;
  let service: PaymentsService;

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
  const PAID_AMOUNT_CENTS = 30000;

  let refundRowSeenAsProcessingDuringProviderCall = false;

  const makeFakeProvider = (behavior: 'succeed' | 'reject' | 'throw'): PaymentProvider => ({
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
    async refund(input): Promise<RefundResult> {
      // اللحظة دي بالظبط هي المرحلة (ب) من الإصلاح — لازم صف الـRefund يكون اتسجّل بالفعل
      // COMMITTED بحالة PROCESSING **قبل** النداء ده، مش بعده. بنتحقق من DB حقيقي (connection
      // منفصلة تمامًا عن أي transaction مفتوحة) عشان نثبت إنه فعلاً committed مش لسه معلّق.
      const rows = await dataSource.query(
        `SELECT refund_status FROM refunds WHERE payment_id = (SELECT id FROM payments WHERE gateway_transaction_id = $1)`,
        [input.providerReference],
      );
      refundRowSeenAsProcessingDuringProviderCall = rows.length === 1 && rows[0].refund_status === 'processing';

      if (behavior === 'throw') throw new Error('محاكاة انقطاع شبكة أثناء نداء البوابة');
      if (behavior === 'reject') {
        return { succeeded: false, providerRefundId: null, status: 'failed' as never, failureReason: 'رفض من البوابة' };
      }
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

  async function insertPaidOrderAndPayment(label: string, gatewayTxnId: string) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,$5,'completed','paid',$6,0) RETURNING id`,
      [`TESTRF-${label}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, PAID_AMOUNT_CENTS],
    );
    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5,$6, now()) RETURNING id`,
      [`PAYRF-${label}`.slice(0, 24), order.id, ids.customerProfile, PAID_AMOUNT_CENTS, `idem-rf-${label}-${Math.random()}`, gatewayTxnId],
    );
    return { orderId: order.id as string, paymentId: payment.id as string };
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, Payment, Refund, User, WebhookEvent, OrderStatusHistory],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, 'R' + runId.slice(0, 1).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-rf-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-rf-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-rf-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2015${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRF-%${runId}%`]);
    await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRF-%${runId}%`]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTRF-%${runId}%`]);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTRF-%${runId}%`]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await q(`DELETE FROM countries WHERE id = $1`, [ids.country]);
    await dataSource.destroy();
  });

  function buildService(provider: PaymentProvider) {
    return new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never, // walletsService — مش متنادى (مفيش فني على الطلب، refundMethod=ORIGINAL_METHOD مش WALLET_CREDIT)
      {} as never, // catalogService
      {} as never, // customerProfiles — نفس السبب
      {} as never, // techniciansService — نفس السبب (order.technicianId=null)
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      {} as never, // loyaltyService
      {} as never, // settingsService
      { record: async () => undefined } as never, // auditLog — نداء واحد بسيط بس
      { emit: () => undefined } as never, // events
      { getProvider: () => provider } as never, // paymentProviders — الـfake provider بتاعنا
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
    );
  }

  it('استرداد ناجح: صف Refund اتسجّل PROCESSING (committed) قبل نداء البوابة، وبعده اترحّل لـCOMPLETED مع providerRefundId', async () => {
    const gatewayTxnId = `gw-succeed-${runId}`;
    const { orderId } = await insertPaidOrderAndPayment(`ok-${runId}`, gatewayTxnId);
    service = buildService(makeFakeProvider('succeed'));
    refundRowSeenAsProcessingDuringProviderCall = false;

    const refund = await service.refundOrder(ids.customerUser, orderId, 'اختبار استرداد ناجح');

    expect(refundRowSeenAsProcessingDuringProviderCall).toBe(true);
    expect(refund.refundStatus).toBe(RefundStatus.COMPLETED);
    expect(refund.providerRefundId).toBe(`prov-refund-${runId}`);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.REFUNDED);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.REFUNDED);

    const payment = await dataSource.getRepository(Payment).findOne({ where: { orderId } });
    expect(payment?.paymentStatus).toBe(PaymentGatewayStatus.REFUNDED);
  });

  it('البوابة رفضت الاسترداد صراحة: الصف يترحّل لـREJECTED، الطلب يفضل زي ما هو (مفيش تأثير مالي كاذب)', async () => {
    const gatewayTxnId = `gw-reject-${runId}`;
    const { orderId } = await insertPaidOrderAndPayment(`rej-${runId}`, gatewayTxnId);
    service = buildService(makeFakeProvider('reject'));

    const refund = await service.refundOrder(ids.customerUser, orderId, 'اختبار رفض من البوابة');
    expect(refund.refundStatus).toBe(RefundStatus.REJECTED);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED); // زي ما هو، مش REFUNDED
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.PAID); // زي ما هو
  });

  it('نداء البوابة رمى استثناء (شبكة اتقطعت): صف الـRefund يفضل PROCESSING (مش ضايع)، والطلب يفضل PAID — أي محاولة تانية تترفض فورًا (الثغرة الأصلية اتقفلت)', async () => {
    const gatewayTxnId = `gw-throw-${runId}`;
    const { orderId } = await insertPaidOrderAndPayment(`thr-${runId}`, gatewayTxnId);
    service = buildService(makeFakeProvider('throw'));

    await expect(service.refundOrder(ids.customerUser, orderId, 'اختبار انقطاع الشبكة')).rejects.toThrow(
      'محاكاة انقطاع شبكة أثناء نداء البوابة',
    );

    // الطلب لازم يفضل زي ما هو تمامًا — مفيش REFUNDED كاذب حصل رغم إن الاسترداد لسه مش مؤكّد.
    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.COMPLETED);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.PAID);

    // صف الـRefund لازم يفضل موجود (مش اترمى مع rollback) بحالة PROCESSING — ده بالظبط اللي
    // بيمنع محاولة استرداد تانية تنادي البوابة مرة تانية لنفس الدفعة.
    const payment = await dataSource.getRepository(Payment).findOne({ where: { orderId } });
    const refund = await dataSource.getRepository(Refund).findOne({ where: { paymentId: payment!.id } });
    expect(refund).not.toBeNull();
    expect(refund!.refundStatus).toBe(RefundStatus.PROCESSING);

    // محاولة استرداد تانية لنفس الطلب — لازم تترفض فورًا (409) بدل ما تنادي البوابة تاني.
    await expect(service.refundOrder(ids.customerUser, orderId, 'محاولة تانية')).rejects.toThrow(
      'محاولة استرداد سابقة لسه قيد التأكيد',
    );
  });

  it('البوابة رفضت أول محاولة (الطلب يفضل PAID)، محاولة تانية تلاقي الصف REJECTED وترفض برضه — منع تكرار المحاولة على نفس الدفعة', async () => {
    const gatewayTxnId = `gw-double-${runId}`;
    const { orderId } = await insertPaidOrderAndPayment(`dbl-${runId}`, gatewayTxnId);
    service = buildService(makeFakeProvider('reject'));

    const first = await service.refundOrder(ids.customerUser, orderId, 'استرداد أول');
    expect(first.refundStatus).toBe(RefundStatus.REJECTED);

    await expect(service.refundOrder(ids.customerUser, orderId, 'استرداد تاني')).rejects.toThrow('اترد قبل كده');
  });
});
