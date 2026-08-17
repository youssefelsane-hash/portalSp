import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order } from '../orders/entities/order.entity';
import { Payment, PaymentGatewayStatus, PaymentMethod } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent, WebhookProcessingStatus } from './entities/webhook-event.entity';

// اختبار حي ضد Postgres حقيقي — بيثبت إصلاح بَقّة أمنية/مالية حقيقية (مراجعة أمان شاملة
// 2026-08-13، بند P0-7 في docs/12): finalizeGatewayWebhook() كانت بتثق في succeeded=true من
// البوابة وتسوّي الطلب بالكامل من غير أي مقارنة بين المبلغ اللي وصل فعلاً (webhook) والمبلغ
// المتوقع (payment.amountCents) — توقيع HMAC بيمنع تزوير حدث، لكن مبيحميش من خطأ إعداد/تكامل
// حقيقي في البوابة (partial payment، عملة مختلفة) يسوّي طلب بمبلغ أقل من قيمته الحقيقية.
describe('PaymentsService.finalizeGatewayWebhook() — تحقق مبلغ الـwebhook قبل التسوية (regression P0-7)', () => {
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
  };
  const EXPECTED_AMOUNT_CENTS = 50000;
  const extraPaymentIds: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, Payment, Refund, User, WebhookEvent],
    });
    await dataSource.initialize();

    // finalizeGatewayWebhook's early-return لعدم تطابق المبلغ بيحصل قبل ما أي حاجة تانية غير
    // payments/webhookEvents تتلمس — باقي الاعتماديات الثقيلة (wallets, catalog, technicians,
    // إلخ) مش هتتنادى أبداً في المسار ده، فمفيش داعي حقيقي ليها هنا.
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
      { getNumber: async (_key: string, fallback: number) => fallback } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never, // savedPaymentMethods (docs/08 §21) — مش متنادى في الاختبار ده
    );

    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);

    const [country] = await q(
      `INSERT INTO countries (name_ar, name_en, iso_code, phone_prefix, currency_code) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [`دولة اختبار ${runId}`, `Test Country ${runId}`, 'T' + runId.slice(0, 1).toUpperCase(), '+000', 'EGP'],
    );
    ids.country = country.id;

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-pay-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-pay-${runId}`],
    );
    ids.category = category.id;

    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'fixed',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-pay-${runId}`],
    );
    ids.service = serviceRow.id;

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2014${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
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
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,'searching_technician',$6) RETURNING id`,
      [`TESTPAY-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone, EXPECTED_AMOUNT_CENTS],
    );
    ids.order = order.id;
  });

  beforeEach(async () => {
    // كل it() بيعمل الدفعة بتاعته من الصفر (pending) عشان الاختبارات تفضل مستقلة عن بعض.
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    if (ids.payment) await q(`DELETE FROM webhook_events WHERE true`);
    const [payment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key)
       VALUES ($1,$2,$3,$4,'card','pending',$5) RETURNING id`,
      [`PAYTEST-${Date.now()}`.slice(0, 24), ids.order, ids.customerProfile, EXPECTED_AMOUNT_CENTS, `idem-${Date.now()}-${Math.random()}`],
    );
    ids.payment = payment.id;
  });

  afterEach(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM webhook_events WHERE true`);
    for (const paymentId of extraPaymentIds.splice(0)) {
      await q(`DELETE FROM payments WHERE id = $1`, [paymentId]);
    }
    await q(`DELETE FROM payments WHERE id = $1`, [ids.payment]);
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
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

  it('مبلغ الـwebhook أقل من المتوقع: الحدث يترفض بأمان، الدفعة تفضل pending — كان الثغرة', async () => {
    const suspiciousAmount = EXPECTED_AMOUNT_CENTS - 10000;
    await service.finalizeGatewayWebhook(
      `evt-mismatch-${runId}`,
      'TRANSACTION',
      'paymob',
      { fake: true },
      true,
      ids.payment,
      true,
      null,
      'gw-txn-1',
      PaymentMethod.CARD,
      suspiciousAmount,
    );

    const payment = await dataSource.getRepository(Payment).findOne({ where: { id: ids.payment } });
    expect(payment?.paymentStatus).toBe(PaymentGatewayStatus.PENDING);

    const events = await dataSource.getRepository(WebhookEvent).find({ where: { externalEventId: `evt-mismatch-${runId}` } });
    expect(events[0]?.processingStatus).toBe(WebhookProcessingStatus.FAILED);
    expect(events[0]?.errorMessage).toContain('مايطابقش');
  });

  it('مبلغ الـwebhook مطابق تمامًا: الفحص بيعدّي (مايترفضش بسبب المبلغ)', async () => {
    // مش بنختبر التسوية الكاملة هنا (محتاجة fixtures تقنية/محفظة تقيلة) — بس بنثبت إن فحص
    // المبلغ نفسه مابيرفضش حدث المبلغ فيه مطابق فعلاً (لازم settleAndComplete تتنادى، فهيبدأ
    // الـtransaction ويحاول يقفل صف الطلب — دليل كافي إن الفحص عدّى).
    await expect(
      service.finalizeGatewayWebhook(
        `evt-match-${runId}`,
        'TRANSACTION',
        'paymob',
        { fake: true },
        true,
        ids.payment,
        true,
        null,
        'gw-txn-2',
        PaymentMethod.CARD,
        EXPECTED_AMOUNT_CENTS,
      ),
    ).rejects.toThrow();

    // لازم فشل settleAndComplete نفسه (اعتماديات ناقصة/مموّهة في الاختبار ده) مش رفض بسبب المبلغ.
    const events = await dataSource.getRepository(WebhookEvent).find({ where: { externalEventId: `evt-match-${runId}` } });
    expect(events[0]?.errorMessage).not.toContain('مايطابقش');
  });

  it('نفس external_event_id بيتبعت مرتين قبل موعد recovery: المرة التانية no-op بلا أثر مالي مكرر', async () => {
    const externalEventId = `evt-replay-${runId}`;
    // أول نداء — هيفشل داخليًا (اعتماديات مموّهة، زي أي اختبار تاني هنا) لكن المهم إن صف
    // webhook_events اتسجّل قبل الفشل.
    await service
      .finalizeGatewayWebhook(externalEventId, 'TRANSACTION', 'paymob', { fake: true }, true, ids.payment, true, null, 'gw-txn-3', PaymentMethod.CARD, EXPECTED_AMOUNT_CENTS)
      .catch(() => null);

    const eventsAfterFirst = await dataSource.getRepository(WebhookEvent).find({ where: { externalEventId } });
    expect(eventsAfterFirst.length).toBe(1);

    // نداء تاني قبل next_retry_at يرجع فورًا بلا صف جديد. إعادة المحاولة الفعلية يملكها recovery
    // المحدود بعد backoff، وليس كل delivery سريع من المزوّد.
    await expect(
      service.finalizeGatewayWebhook(externalEventId, 'TRANSACTION', 'paymob', { fake: true }, true, ids.payment, true, null, 'gw-txn-3', PaymentMethod.CARD, EXPECTED_AMOUNT_CENTS),
    ).resolves.toBeUndefined();

    const eventsAfterSecond = await dataSource.getRepository(WebhookEvent).find({ where: { externalEventId } });
    expect(eventsAfterSecond.length).toBe(1); // صف واحد بس، مش اتنين
  });

  it('حدث FAILED يعاد بنفس الهوية بعد backoff ويُعالج مرة واحدة لما تصبح الدفعة متاحة', async () => {
    const externalEventId = `evt-recover-${runId}`;
    const delayedPaymentId = randomUUID();
    extraPaymentIds.push(delayedPaymentId);

    // أول delivery وصل قبل ظهور صف الدفعة (تعطل/تأخر محلي عابر)، فلا يصبح processed كذبًا.
    await service.finalizeGatewayWebhook(
      externalEventId,
      'TRANSACTION',
      'paymob',
      { fake: true },
      true,
      delayedPaymentId,
      false,
      'declined by provider',
      'gw-recover',
      PaymentMethod.CARD,
    );
    const failedEvent = await dataSource.getRepository(WebhookEvent).findOne({ where: { provider: 'paymob', externalEventId } });
    expect(failedEvent?.processingStatus).toBe(WebhookProcessingStatus.FAILED);
    expect(failedEvent?.nextRetryAt).not.toBeNull();

    // نفس payment_id يظهر بعد ذلك؛ لا نغيّر هوية الحدث أو نحاكي event جديد.
    await dataSource.query(
      `INSERT INTO payments (id, payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'card','pending',$6)`,
      [
        delayedPaymentId,
        `PAYREC-${runId}`.slice(0, 24),
        ids.order,
        ids.customerProfile,
        EXPECTED_AMOUNT_CENTS,
        `idem-recover-${runId}`,
      ],
    );
    await dataSource.query(
      `UPDATE webhook_events SET next_retry_at = now() WHERE provider = 'paymob' AND external_event_id = $1`,
      [externalEventId],
    );

    await service.finalizeGatewayWebhook(
      externalEventId,
      'TRANSACTION',
      'paymob',
      { fake: true },
      true,
      delayedPaymentId,
      false,
      'declined by provider',
      'gw-recover',
      PaymentMethod.CARD,
    );

    const recoveredEvent = await dataSource.getRepository(WebhookEvent).findOne({ where: { provider: 'paymob', externalEventId } });
    const delayedPayment = await dataSource.getRepository(Payment).findOne({ where: { id: delayedPaymentId } });
    expect(recoveredEvent?.processingStatus).toBe(WebhookProcessingStatus.PROCESSED);
    expect(recoveredEvent?.retryCount).toBe(2);
    expect(delayedPayment?.paymentStatus).toBe(PaymentGatewayStatus.FAILED);
  });

  it('نفس external_event_id من بوابتين مختلفتين لا يتصادم: الهوية provider-scoped', async () => {
    const externalEventId = `numeric-reference-${runId}`;

    await Promise.all([
      service.finalizeGatewayWebhook(
        externalEventId,
        'TRANSACTION',
        'paymob',
        { fake: 'paymob' },
        true,
        null,
        false,
        'لا توجد دفعة',
        'paymob-txn',
        PaymentMethod.CARD,
      ),
      service.finalizeGatewayWebhook(
        externalEventId,
        'TRANSACTION',
        'fawry',
        { fake: 'fawry' },
        true,
        null,
        false,
        'لا توجد دفعة',
        'fawry-txn',
        PaymentMethod.FAWRY_REFERENCE,
      ),
    ]);

    const events = await dataSource.getRepository(WebhookEvent).find({ where: { externalEventId } });
    expect(events).toHaveLength(2);
    expect(new Set(events.map((event) => event.provider))).toEqual(new Set(['paymob', 'fawry']));
    expect(events.every((event) => event.processingStatus === WebhookProcessingStatus.IGNORED)).toBe(true);
  });

  it('delivery متزامن لنفس الحدث ينتج صفًا واحدًا فقط ومعالجة واحدة قابلة للمراجعة', async () => {
    const externalEventId = `evt-concurrent-${runId}`;
    await Promise.all([
      service.finalizeGatewayWebhook(
        externalEventId,
        'TRANSACTION',
        'paymob',
        { fake: true },
        true,
        null,
        false,
        'لا توجد دفعة',
        'gw-concurrent',
        PaymentMethod.CARD,
      ),
      service.finalizeGatewayWebhook(
        externalEventId,
        'TRANSACTION',
        'paymob',
        { fake: true },
        true,
        null,
        false,
        'لا توجد دفعة',
        'gw-concurrent',
        PaymentMethod.CARD,
      ),
    ]);

    const events = await dataSource.getRepository(WebhookEvent).find({ where: { provider: 'paymob', externalEventId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.processingStatus).toBe(WebhookProcessingStatus.IGNORED);
  });
});
