import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order, OrderPaymentStatus, OrderStatus } from '../orders/entities/order.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund, RefundMethod, RefundStatus, RefundType } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';

// اختبار حي ضد Postgres حقيقي — docs/08 §20 بند 11: PaymentsService.getFinancialSummaryForOrder()
// جديدة (كانت فجوة عرض حقيقية: platform_commission_cents/technician_earning_cents محسوبين
// ومخزّنين على الطلب من زمان بس صفر endpoint كان بيرجّعهم لأي أدمن). الاختبار ده بيتأكد إن الدالة
// بترجّع بالظبط أرقام الطلب + كل الدفعات/الاستردادات المرتبطة بيه، بلا أي حساب إضافي أو تلاعب.
describe('PaymentsService.getFinancialSummaryForOrder() — الملخص المالي لطلب واحد (docs/08 §20 بند 11)', () => {
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
    order: '',
    payment: '',
    refund: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, Payment, Refund, User, WebhookEvent],
    });
    await dataSource.initialize();
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, 'F' + runId.slice(0, 1).toUpperCase(), '+003', 'EGP'],
    );
    ids.country = country.id;
    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-fin-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-fin-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-fin-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2018${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status,
         payment_status, total_amount_cents, platform_commission_cents, technician_earning_cents, cancellation_fee_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,'completed','partially_refunded',100000,20000,80000,5000, now()) RETURNING id`,
      [`TESTFIN-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, completed_at)
       VALUES ($1,$2,$3,$4,'card','succeeded',$5, now()) RETURNING id`,
      [`PAYFIN-${runId}`.slice(0, 24), ids.order, ids.customerProfile, 100000, `idem-fin-${runId}`],
    );
    ids.payment = payment.id;

    const [refund] = await q(
      `INSERT INTO refunds (refund_number, payment_id, order_id, amount_cents, refund_type, refund_method, refund_status, requested_by_user_id, requested_at, completed_at)
       VALUES ($1,$2,$3,$4,'partial','wallet_credit','completed',$5, now(), now()) RETURNING id`,
      [`REFFIN-${runId}`.slice(0, 24), ids.payment, ids.order, 15000, ids.customerUser],
    );
    ids.refund = refund.id;

    service = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM refunds WHERE id = $1`, [ids.refund]);
    await q(`DELETE FROM payments WHERE id = $1`, [ids.payment]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
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

  it('بترجّع عمولة المنصة/أرباح الفني/رسوم الإلغاء المخزّنة على الطلب + كل الدفعات والاستردادات المرتبطة', async () => {
    const summary = await service.getFinancialSummaryForOrder(ids.order);

    expect(summary.platformCommissionCents).toBe(20000);
    expect(summary.technicianEarningCents).toBe(80000);
    expect(summary.cancellationFeeCents).toBe(5000);

    expect(summary.payments).toHaveLength(1);
    expect(summary.payments[0].paymentMethod).toBe(PaymentMethod.CARD);
    expect(summary.payments[0].paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
    expect(summary.payments[0].amountCents).toBe(100000);

    expect(summary.refunds).toHaveLength(1);
    expect(summary.refunds[0].amountCents).toBe(15000);
    expect(summary.refunds[0].refundType).toBe(RefundType.PARTIAL);
    expect(summary.refunds[0].refundMethod).toBe(RefundMethod.WALLET_CREDIT);
    expect(summary.refunds[0].refundStatus).toBe(RefundStatus.COMPLETED);
  });

  it('طلب غير موجود يترفض بوضوح بدل ما يرجّع بيانات فاضية بصمت', async () => {
    await expect(service.getFinancialSummaryForOrder('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'الطلب غير موجود',
    );
  });
});
