import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { CancellationReasonsService } from './cancellation-reasons.service';
import { CancellationAppliesTo, CancellationReason } from './entities/cancellation-reason.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order, OrderPaymentStatus, OrderStatus } from './entities/order.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { commissionBaseServiceStub } from '../pricing/commission-base.testing';

// اختبار حي ضد Postgres حقيقي — ثغرة رسوم الإلغاء (docs/08 §112).
//
// **البَقّة اللي بيثبتها الاختبار ده**: `cancellation_reason_id` كان اختياري بالكامل، ورسوم
// الإلغاء بتتحسب **جوّه** `if (dto.cancellation_reason_id)` بس. يعني العميل — وهو اللي بيدفع
// الرسوم — كان هو اللي بيقرر لو هي تنطبق عليه أصلاً: يسيب الراديو من غير اختيار، ويطلع بصفر
// رسوم مهما كانت سياسة الأدمن (`charges_fee`/`fee_percentage`) على كل الأسباب المعروضة.
//
// القاعدة بعد الإصلاح: لو الأدمن معرّف أسباب إلغاء للعميل، الاختيار إجباري. لو مفيش أسباب
// معرّفة خالص، الإلغاء بيفضل شغّال بنص حر — عشان ما نقفلش على العميل باب الإلغاء بسبب داتا
// ناقصة (وده بالظبط وضع الـseed الافتراضي: migration 0216 بتزرع أسباب الفني بس).
describe('OrdersService.cancel() — سبب الإلغاء إجباري لما يكون فيه قايمة (docs/08 §112)', () => {
  let dataSource: DataSource;
  let service: OrdersService;
  let serviceWithNoReasonsConfigured: OrdersService;
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
    reason: '',
  };

  async function insertOrder(label: string) {
    const [order] = await dataSource.query(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, payment_status, total_amount_cents, technician_earning_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0, now()) RETURNING id`,
      [
        `TESTCRR-${label}-${runId}`.slice(0, 24),
        ids.customerProfile,
        ids.service,
        ids.address,
        ids.zone,
        OrderStatus.SEARCHING_TECHNICIAN,
        OrderPaymentStatus.PENDING,
        30000,
      ],
    );
    return order.id as string;
  }

  function buildOrdersService(cancellationReasonsService: unknown): OrdersService {
    return new OrdersService(
      dataSource.getRepository(Order),
      {} as never, // technicianOrderCancellations
      {} as never, // orderMedia
      dataSource,
      { record: async () => undefined } as never, // auditLog
      { findByUserIdOrThrow: async () => ({ id: ids.customerProfile }) as CustomerProfile } as never,
      {} as never, // addressesService
      {} as never, // catalogService
      {} as never, // geoService
      {} as never, // techniciansService
      {} as never, // technicianCompaniesService
      {} as never, // scheduleService
      {} as never, // pricingEngineService
      { releaseUsage: async () => undefined } as never, // promoCodesService
      {} as never, // buildingsService
      cancellationReasonsService as never,
      {} as never, // walletsService — مايتناداش (charges_fee=false في كل أسباب الاختبار)
      {} as never, // settingsService — مايتناداش لنفس السبب
      {} as never, // paymentsService — الطلب payment_status=pending فمفيش استرداد
      {} as never, // supportService
      { emit: () => undefined } as never, // events
      {} as never, // orderTeamService
      commissionBaseServiceStub(),
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, OrderStatusHistory, CustomerProfile, CancellationReason],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-crr-${runId}`],
    );
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
      `test-category-crr-${runId}`,
    ]);
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-crr-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(`INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`, [
      `+2018${runId}`.slice(0, 15),
      `عميل اختبار ${runId}`,
    ]);
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = customerProfile.id;
    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [reason] = await q(
      `INSERT INTO cancellation_reasons (reason_ar, reason_en, applies_to, charges_fee, fee_percentage, display_order, is_active)
       VALUES ($1,$2,'customer',false,0,900,true) RETURNING id`,
      [`سبب اختبار ${runId}`, `Test reason ${runId}`],
    );
    ids.reason = reason.id;

    // خدمة أسباب الإلغاء الحقيقية — بتقرا من نفس الجدول اللي زرعنا فيه فوق، مش stub.
    service = buildOrdersService(
      new CancellationReasonsService(dataSource.getRepository(CancellationReason), { record: async () => undefined } as never),
    );

    // النسخة دي بتمثّل «الأدمن مامعرّفش أي سبب إلغاء للعميل». مابنعطّلش صفوف الجدول الحقيقية
    // عشان ما نتعارضش مع أي سويت تانية شغالة بالتوازي على نفس القاعدة — الفرق الوحيد هنا هو
    // ناتج listActive()، وهو بالظبط المدخل اللي القاعدة الجديدة بتتفرّع عليه.
    serviceWithNoReasonsConfigured = buildOrdersService({ listActive: async () => [] });
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)`, [ids.customerProfile]);
    await q(`DELETE FROM orders WHERE customer_id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM cancellation_reasons WHERE id = $1`, [ids.reason]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  it('فيه أسباب معرّفة والعميل ما اختارش — الإلغاء بيترفض (الثغرة اتقفلت)', async () => {
    const orderId = await insertOrder('noreason');

    await expect(service.cancel(ids.customerUser, orderId, {})).rejects.toThrow('لازم تختار سبب الإلغاء من القايمة');

    // الطلب لازم يفضل زي ما هو بالظبط — الرفض قبل أي كتابة.
    const [row] = await dataSource.query(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    expect(row.order_status).toBe(OrderStatus.SEARCHING_TECHNICIAN);
  });

  it('العميل اختار سبب من القايمة — الإلغاء بينجح والسبب بيتسجّل على الطلب', async () => {
    const orderId = await insertOrder('withreason');

    const cancelled = await service.cancel(ids.customerUser, orderId, { cancellation_reason_id: ids.reason });
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const [row] = await dataSource.query(`SELECT cancellation_reason_id, cancellation_fee_cents FROM orders WHERE id = $1`, [orderId]);
    expect(row.cancellation_reason_id).toBe(ids.reason);
    expect(Number(row.cancellation_fee_cents)).toBe(0);
  });

  it('سبب بتاع الفني مش مقبول كسبب إلغاء عميل', async () => {
    const orderId = await insertOrder('wrongaudience');
    const [technicianReason] = await dataSource.query(
      `SELECT id FROM cancellation_reasons WHERE applies_to = $1 AND is_active = true ORDER BY display_order ASC LIMIT 1`,
      [CancellationAppliesTo.TECHNICIAN],
    );
    // القاعدة دي موجودة من قبل التغيير ده — الاختبار هنا عشان الحارس الجديد ما يكونش بلعها.
    if (!technicianReason) return;

    await expect(
      service.cancel(ids.customerUser, orderId, { cancellation_reason_id: technicianReason.id }),
    ).rejects.toThrow('سبب الإلغاء ده مش لإلغاء العميل');
  });

  it('مفيش أي أسباب معرّفة للعميل — الإلغاء بنص حر لسه شغّال (ما نقفلش الباب على العميل)', async () => {
    const orderId = await insertOrder('emptylist');

    const cancelled = await serviceWithNoReasonsConfigured.cancel(ids.customerUser, orderId, { reason: 'اتفقت مع حد تاني' });
    expect(cancelled.orderStatus).toBe(OrderStatus.CANCELLED_BY_CUSTOMER);

    const [row] = await dataSource.query(`SELECT cancellation_reason_id FROM orders WHERE id = $1`, [orderId]);
    expect(row.cancellation_reason_id).toBeNull();
  });
});
