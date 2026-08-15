import { DataSource } from 'typeorm';
import { AuditLogService } from '../audit/audit-log.service';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { PaymentsService } from '../payments/payments.service';
import type { PaymentProvider, RefundResult } from '../payments/gateways/payment-provider.interface';
import { Payment, PaymentGatewayStatus, PaymentMethod } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Setting } from '../settings/entities/setting.entity';
import { SettingsService } from '../settings/settings.service';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { OrderAutoCancelService } from './order-auto-cancel.service';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت بند 3+5 من تدقيق جاهزية الإطلاق (docs/08 §19):
// (أ) طلبات PENDING_PAYMENT قديمة (دفع إلكتروني مسبق ماتمّش) بتتلغى تلقائيًا بلا استرداد،
// (ب) طلبات SEARCHING_TECHNICIAN مدفوعة (كارت/InstaPay) بتاخد استرداد فوري تلقائي عند
// الإلغاء النظامي، (ج) طلبات SEARCHING_TECHNICIAN غير مدفوعة (كاش) متاخدش أي محاولة استرداد
// (regression — الإصلاح ميضيفش استرداد كاذب لطلبات مفيش فلوس اتاخدت أصلاً منها).
describe('OrderAutoCancelService — PENDING_PAYMENT sweep + استرداد تلقائي (docs/08 §19 بند 3+5)', () => {
  let dataSource: DataSource;
  let service: OrderAutoCancelService;
  let paymentsService: PaymentsService;

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
  const OLD_MINUTES_AGO = 200; // أقدم بكتير من أي إعداد مهلة معقول (15/20 دقيقة افتراضيًا)

  const makeFakeProvider = (behavior: 'succeed' | 'reject'): PaymentProvider => ({
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

  async function insertOrder(opts: {
    label: string;
    orderStatus: OrderStatus;
    paymentStatus: OrderPaymentStatus;
    minutesAgo: number;
  }) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0, now() - ($9 || ' minutes')::interval) RETURNING id, order_number`,
      [
        `TESTAC-${opts.label}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        opts.orderStatus,
        opts.paymentStatus,
        30000,
        opts.minutesAgo,
      ],
    );
    return { orderId: order.id as string, orderNumber: order.order_number as string };
  }

  async function insertSucceededPayment(orderId: string, label: string, paymentMethod: PaymentMethod) {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, gateway_transaction_id, completed_at)
       VALUES ($1,$2,$3,$4,$5,'succeeded',$6,$7, now()) RETURNING id`,
      [
        `PAYAC-${label}`.slice(0, 24),
        orderId,
        ids.customerProfile,
        30000,
        paymentMethod,
        `idem-ac-${label}-${Math.random()}`,
        paymentMethod === PaymentMethod.CARD ? `gw-ac-${label}` : null,
      ],
    );
    return payment.id as string;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, Payment, Refund, User, WebhookEvent, Setting],
    });
    await dataSource.initialize();

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, 'A' + runId.slice(0, 1).toUpperCase(), '+001', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-ac-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-ac-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-ac-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2016${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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

    const cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(dataSource.getRepository(Setting), {} as unknown as AuditLogService, cache);

    paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never, // walletsService — مش متنادى (technicianId=null دايمًا هنا، refundMethod=ORIGINAL_METHOD)
      {} as never, // catalogService
      {} as never, // customerProfiles
      {} as never, // techniciansService
      {} as never, // technicianLevelsService
      {} as never, // technicianStatsService
      {} as never, // loyaltyService
      settingsService,
      { record: async () => undefined } as never, // auditLog
      { emit: () => undefined } as never, // events
      { getProvider: () => makeFakeProvider('succeed') } as never, // paymentProviders
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
    );

    service = new OrderAutoCancelService(
      dataSource.getRepository(Order),
      dataSource,
      settingsService,
      { emit: () => undefined } as never,
      paymentsService,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTAC-%${runId}%`]);
    await q(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTAC-%${runId}%`]);
    await q(`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE order_number LIKE $1)`, [`TESTAC-%${runId}%`]);
    await q(`DELETE FROM orders WHERE order_number LIKE $1`, [`TESTAC-%${runId}%`]);
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

  it('طلب PENDING_PAYMENT قديم يتلغى تلقائيًا بلا أي محاولة استرداد (الدفع أصلاً مكملش)', async () => {
    const { orderId } = await insertOrder({
      label: `pp-${runId}`,
      orderStatus: OrderStatus.PENDING_PAYMENT,
      paymentStatus: OrderPaymentStatus.UNPAID,
      minutesAgo: OLD_MINUTES_AGO,
    });

    const cancelledCount = await service.sweep();
    expect(cancelledCount).toBeGreaterThanOrEqual(1);

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.CANCELLED_BY_SYSTEM);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.UNPAID);

    const refund = await dataSource.getRepository(Refund).findOne({ where: { orderId } });
    expect(refund).toBeNull();
  });

  it('طلب SEARCHING_TECHNICIAN مدفوع (كارت) قديم — يتلغى نظاميًا ويترد فورًا تلقائيًا (orderStatus فضل CANCELLED_BY_SYSTEM، paymentStatus بقى REFUNDED)', async () => {
    const { orderId } = await insertOrder({
      label: `pd-${runId}`,
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      paymentStatus: OrderPaymentStatus.PAID,
      minutesAgo: OLD_MINUTES_AGO,
    });
    await insertSucceededPayment(orderId, `pd-${runId}`, PaymentMethod.CARD);

    await service.sweep();

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.CANCELLED_BY_SYSTEM);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.REFUNDED);

    const payment = await dataSource.getRepository(Payment).findOne({ where: { orderId } });
    expect(payment?.paymentStatus).toBe(PaymentGatewayStatus.REFUNDED);

    const refund = await dataSource.getRepository(Refund).findOne({ where: { orderId } });
    expect(refund).not.toBeNull();
    expect(refund!.amountCents).toBe(30000);
    expect(refund!.providerRefundId).toBe(`prov-refund-${runId}`);
  });

  it('طلب SEARCHING_TECHNICIAN غير مدفوع (كاش) قديم — يتلغى بس بلا أي محاولة استرداد (regression: مفيش فلوس اتاخدت أصلاً)', async () => {
    const { orderId } = await insertOrder({
      label: `un-${runId}`,
      orderStatus: OrderStatus.SEARCHING_TECHNICIAN,
      paymentStatus: OrderPaymentStatus.UNPAID,
      minutesAgo: OLD_MINUTES_AGO,
    });

    await service.sweep();

    const order = await dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    expect(order?.orderStatus).toBe(OrderStatus.CANCELLED_BY_SYSTEM);
    expect(order?.paymentStatus).toBe(OrderPaymentStatus.UNPAID);

    const refund = await dataSource.getRepository(Refund).findOne({ where: { orderId } });
    expect(refund).toBeNull();
  });
});
