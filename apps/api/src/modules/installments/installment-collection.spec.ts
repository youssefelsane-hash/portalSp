import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../audit/audit-log.service';
import { PaymentsService } from '../payments/payments.service';
import { Payment, PaymentGatewayStatus } from '../payments/entities/payment.entity';
import { Refund } from '../payments/entities/refund.entity';
import { Wallet } from '../payments/entities/wallet.entity';
import { WalletTransaction } from '../payments/entities/wallet-transaction.entity';
import { WalletsService } from '../payments/wallets.service';
import { WebhookEvent } from '../payments/entities/webhook-event.entity';
import { InstallmentCollectionService } from '../payments/installment-collection.service';
import { SettingsService } from '../settings/settings.service';
import { Setting } from '../settings/entities/setting.entity';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Order } from '../orders/entities/order.entity';
import { Installment } from './entities/installment.entity';
import { InstallmentApplication } from './entities/installment-application.entity';
import { InstallmentPlan } from './entities/installment-plan.entity';
import { crewEarningsServiceStub } from '../payments/crew-earnings.testing';

/**
 * محرك تحصيل الأقساط (migration 0177) — أدلة التعريف الحرجة:
 * 1. مطفي افتراضيًا (BLOCKED) لحد تشغيل صريح من الإعدادات.
 * 2. claim ذرّي: sweep مرتين/متوازي مابيلتقطش نفس القسط مرتين.
 * 3. idempotency الدفعة: installment:{id}:{attempt} unique.
 * 4. webhook هو المؤكد: نجاح → paid + قيد double-entry **واحد بالظبط**؛ webhook مكرر
 *    بنفس الـevent id وبمعرّف مختلف برضه → تجاهل بلا أي أثر مالي تاني.
 */
describe('InstallmentCollectionService + webhook resolution (PostgreSQL)', () => {
  let dataSource: DataSource;
  let paymentsService: PaymentsService;
  let collectionService: InstallmentCollectionService;
  let secondCollectionService: InstallmentCollectionService;
  let cache: RedisCacheService;
  const runId = Date.now().toString(36);
  const ids = {
    customerUser: '',
    customerProfile: '',
    category: '',
    service: '',
    address: '',
    order: '',
    plan: '',
    application: '',
    installmentIds: [] as string[],
  };

   
  async function q<T = any>(sql: string, params?: unknown[]): Promise<T> {
    return dataSource.query(sql, params) as Promise<T>;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [
        User,
        CustomerProfile,
        Order,
        Payment,
        Refund,
        Wallet,
        WalletTransaction,
        WebhookEvent,
        Setting,
        InstallmentPlan,
        InstallmentApplication,
        Installment,
      ],
    });
    await dataSource.initialize();

    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2066${runId}`.slice(0, 15), `عميل أقساط ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [profile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [ids.customerUser]);
    ids.customerProfile = profile.id;

    const [addr] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `عنوان أقساط ${runId}`],
    );
    ids.address = addr.id;
    const [category] = await q(
      `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
      [`فئة أقساط ${runId}`, `Inst Cat ${runId}`, `inst-cat-${runId}`],
    );
    ids.category = category.id;
    const [service] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents)
       VALUES ($1,$2,$3,'formula',30000) RETURNING id`,
      [category.id, `خدمة أقساط ${runId}`, `inst-svc-${runId}`],
    );
    ids.service = service.id;
    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, order_status, payment_status, total_amount_cents, technician_earning_cents)
       VALUES ($1,$2,$3,$4,'searching_technician','unpaid',30000,0) RETURNING id`,
      [`INST-${runId}`.slice(0, 24), ids.customerProfile, service.id, addr.id],
    );
    ids.order = order.id;
    const [plan] = await q(
      `INSERT INTO installment_plans (name_ar, installment_count, interval_days) VALUES ('3 شهور اختبار', 3, 30) RETURNING id`,
    );
    ids.plan = plan.id;
    const [application] = await q(
      `INSERT INTO installment_applications
         (order_id, customer_id, plan_id, status, service_price_cents, financing_percentage, fixed_fee_cents,
          financing_fee_cents, total_financed_cents, down_payment_percentage, down_payment_cents,
          financed_balance_cents, installment_count, regular_installment_cents, final_installment_cents,
          interval_days, first_due_at, reviewed_by, reviewed_at, activated_at)
       VALUES ($1,$2,$3,'approved',30000,0,0,0,30000,0,0,30000,3,10000,10000,30, now(), NULL, now(), now())
       RETURNING id`,
      [order.id, ids.customerProfile, plan.id],
    );
    ids.application = application.id;
    // قسط واحد مستحق بس — الاختبارات بتتحكم في حالته صراحة بدل batch متشابك
    const [inst] = await q(
      `INSERT INTO installments (application_id, sequence_number, due_at, amount_cents)
       VALUES ($1, 1, now() - interval '1 hour', 10000) RETURNING id`,
      [application.id],
    );
    ids.installmentIds.push(inst.id);

    cache = new RedisCacheService({ get: () => process.env.REDIS_URL ?? 'redis://localhost:6379' } as never);
    const settingsService = new SettingsService(
      dataSource.getRepository(Setting),
      { record: async () => undefined } as unknown as AuditLogService,
      cache,
    );
    const events = new EventEmitter2();
    const walletsService = new WalletsService(dataSource.getRepository(Wallet), dataSource.getRepository(WalletTransaction), dataSource);
    paymentsService = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      walletsService,
      {} as never,
      { findByProfileIdOrThrow: async () => ({ id: ids.customerProfile, userId: ids.customerUser }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      settingsService,
      { record: async () => undefined } as unknown as AuditLogService,
      events,
      {} as never, // providers registry — المسار هنا بينتهي قبل نداء البوابة (مفيش كارت محفوظ)
      { findDefaultForCustomer: async () => null } as never, // مفيش بطاقة محفوظة = فشل مبكر آمن
      dataSource.getRepository(Installment),
      crewEarningsServiceStub(),
    );
    collectionService = new InstallmentCollectionService(
      dataSource.getRepository(Installment),
      dataSource,
      paymentsService,
      settingsService,
    );
    secondCollectionService = new InstallmentCollectionService(
      dataSource.getRepository(Installment),
      dataSource,
      paymentsService,
      settingsService,
    );
  });

  afterAll(async () => {
    if (!dataSource?.isInitialized) return;
    try {
      await q(
        `DELETE FROM wallet_transactions WHERE reference_type = 'installment'
         AND reference_id IN (SELECT id FROM installments WHERE application_id = $1)`,
        [ids.application],
      );
      await q(`UPDATE installments SET payment_id = NULL WHERE application_id = $1`, [ids.application]);
      await q(`DELETE FROM payments WHERE installment_id IN (SELECT id FROM installments WHERE application_id = $1)`, [ids.application]);
      await q(`DELETE FROM installments WHERE application_id = $1`, [ids.application]);
      await q(`DELETE FROM webhook_events WHERE external_event_id LIKE 'inst-test-%'`);
      await q(`DELETE FROM installment_applications WHERE id = $1`, [ids.application]);
      await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
      await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
      await q(`DELETE FROM wallets WHERE owner_user_id = $1 AND owner_type = 'customer'`, [ids.customerUser]);
      await q(`DELETE FROM wallets WHERE owner_user_id = $1 AND owner_type = 'customer'`, [ids.customerUser]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
      await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
      await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
      await q(`DELETE FROM installment_plans WHERE id = $1`, [ids.plan]);
    } finally {
      cache?.onModuleDestroy();
      await dataSource.destroy();
    }
  });

  async function flushSettingCache(value: string): Promise<void> {
    await q(`UPDATE settings SET value = $1 WHERE key = 'installments.auto_collection_enabled'`, [value]);
    // تعديل SQL مباشر مايمرش على invalidation بتاع SettingsService (كاش 60s بمفتاح settings:{key})
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect().catch(() => undefined);
    await redis.del('settings:installments.auto_collection_enabled').catch(() => undefined);
    redis.disconnect();
  }

  it('مطفي افتراضيًا — مفيش أي دفعة بتنشأ من غير تشغيل صريح (BLOCKED by default)', async () => {
    await flushSettingCache('false');
    await collectionService.sweep({ installmentIds: ids.installmentIds });
    const inst = await q<{ status: string }[]>(
      `SELECT status::text AS status FROM installments WHERE id=$1`,
      [ids.installmentIds[0]],
    );
    expect(inst[0].status).toBe('scheduled');
    const [{ count }] = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM payments p JOIN installments i ON i.id = p.installment_id WHERE i.application_id = $1`,
      [ids.application],
    );
    expect(Number(count)).toBe(0);
  });

  it('التشغيل الصريح: sweep مرتين ورا بعض = محاولة واحدة بالظبط (attempt=1 + دفعة واحدة)', async () => {
    await flushSettingCache('true');
    await q(`UPDATE installments SET status='scheduled', attempt_count=0, last_attempt_at=NULL WHERE id=$1`, [ids.installmentIds[0]]);

    await collectionService.sweep({ installmentIds: ids.installmentIds });
    await collectionService.sweep({ installmentIds: ids.installmentIds }); // التاني ملقاش حاجة جديدة (failed بعد الـbackoff لسه ما عداش)

    const inst = await q<{ attempt_count: number; status: string; last_error: string | null }[]>(
      `SELECT attempt_count, status::text AS status, last_error FROM installments WHERE id = $1`,
      [ids.installmentIds[0]],
    );
    // مفيش وسيلة دفع محفوظة → فشل مبكر آمن وموثّق بالسبب
    expect(inst[0].attempt_count).toBe(1);
    expect(inst[0].status).toBe('failed');
    expect(inst[0].last_error).toMatch(/بطاقة/);

    const payments = await q<{ idempotency_key: string; status: string }[]>(
      `SELECT p.idempotency_key, p.payment_status::text AS status FROM payments p WHERE p.installment_id = $1`,
      [ids.installmentIds[0]],
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].idempotency_key.endsWith(':1')).toBe(true);
    expect(payments[0].status).toBe('failed');
  });

  it('workerين متوازيين على نفس القسط المستحق = محاولة واحدة فقط (SKIP LOCKED)', async () => {
    await flushSettingCache('true');
    // نرجّعه scheduled مستحق تاني (محاكاة retry بعد ما الـbackoff عدى)
    await q(
      `UPDATE installments SET status='scheduled', last_attempt_at = now() - interval '30 days' WHERE id=$1`,
      [ids.installmentIds[0]],
    );
    await Promise.all([collectionService.sweep({ installmentIds: ids.installmentIds }), secondCollectionService.sweep({ installmentIds: ids.installmentIds })]);
    const [{ attempts }] = await q<{ attempts: number }[]>(
      `SELECT attempt_count AS attempts FROM installments WHERE id=$1`,
      [ids.installmentIds[0]],
    );
    expect(Number(attempts)).toBe(2); // المحاولة الأولى (1) + دي الثانية (2) — مش أكتر
    const payments = await q<{ idempotency_key: string }[]>(
      `SELECT idempotency_key FROM payments WHERE installment_id = $1 ORDER BY idempotency_key`,
      [ids.installmentIds[0]],
    );
    expect(payments.map((p) => p.idempotency_key)).toEqual([
      `installment:${ids.installmentIds[0]}:1`,
      `installment:${ids.installmentIds[0]}:2`,
    ]);
  });

  it('webhook النجاح: القسط paid + قيد double-entry واحد — والمكرر (نفس/مختلف event id) مالوش أي أثر', async () => {
    // نحاكي إن الشحنة اتقبلت مزامنًا: القسط processing + دفعة PENDING مربوطة بيه
    await q(`UPDATE installments SET status='processing', last_attempt_at=now() WHERE id=$1`, [ids.installmentIds[0]]);
    const paymentNumber = `PAY-IT-${randomUUID().slice(0, 10)}`;
    const [payment] = await q<{ id: string }[]>(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_gateway,
                             payment_status, idempotency_key, installment_id)
       VALUES ($1,$2,$3,10000,'card','paymob','pending',$4,$5) RETURNING id`,
      [paymentNumber, ids.order, ids.customerProfile, `it:${randomUUID()}`, ids.installmentIds[0]],
    );

    const externalEventId = `inst-test-${randomUUID()}`;
    await paymentsService.finalizeGatewayWebhook(
      externalEventId,
      'transaction.status',
      'paymob',
      {},
      true, // signatureValid
      payment.id,
      true, // succeeded
      null,
      'gw-tx-inst-1',
    );

    const instAfter = await q<{ status: string; paid_at: string | null }[]>(
      `SELECT status::text AS status, paid_at::text AS paid_at FROM installments WHERE id=$1`,
      [ids.installmentIds[0]],
    );
    expect(instAfter[0].status).toBe('paid');
    expect(instAfter[0].paid_at).not.toBeNull();

    // **نفس نمط دفعات الكارت اليوم**: تحصيل بوابة خارجية مابدخلش wallet ledger مباشرة —
    // حركة المحافظ بتحصل بس عند تسوية الفني. بنأكد إن مفيش أي قيد اتخترع للتحصيل ده.
    const ledger = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE reference_type='installment' AND reference_id=$1`,
      [ids.installmentIds[0]],
    );
    expect(Number(ledger[0].count)).toBe(0);

    // ===== المكرر 1: نفس external_event_id (provider بيعيد) =====
    await paymentsService.finalizeGatewayWebhook(
      externalEventId,
      'transaction.status',
      'paymob',
      {},
      true,
      payment.id,
      true,
      null,
      'gw-tx-inst-1',
    );
    // ===== المكرر 2: event id مختلف لنفس الدفعة (بوابة باعت حدثين) =====
    await paymentsService.finalizeGatewayWebhook(
      `inst-test-${randomUUID()}`,
      'transaction.status',
      'paymob',
      {},
      true,
      payment.id,
      true,
      null,
      'gw-tx-inst-1',
    );

    const ledgerAgain = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE reference_type='installment' AND reference_id=$1`,
      [ids.installmentIds[0]],
    );
    expect(Number(ledgerAgain[0].count)).toBe(0); // زي ما هي — مفيش أي قيد اتعمل

    const payStatus = await q<{ status: string }[]>(`SELECT payment_status::text AS status FROM payments WHERE id=$1`, [payment.id]);
    expect(payStatus[0].status).toBe(PaymentGatewayStatus.SUCCEEDED);
  });

  it('webhook فشل: القسط failed بالسبب ويفضل مرئي — ومفيش أي قيد مالي', async () => {
    // قسط تاني processing + دفعة pending
    const [inst] = await q<{ id: string }[]>(
      `INSERT INTO installments (application_id, sequence_number, due_at, amount_cents, status, last_attempt_at)
       VALUES ($1, 2, now(), 10000, 'processing', now()) RETURNING id`,
      [ids.application],
    );
    ids.installmentIds.push(inst.id);
    const [payment] = await q<{ id: string }[]>(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_gateway,
                             payment_status, idempotency_key, installment_id)
       VALUES ($1,$2,$3,10000,'card','paymob','pending',$4,$5) RETURNING id`,
      [`PAY-IT-${randomUUID().slice(0, 10)}`, ids.order, ids.customerProfile, `it:${randomUUID()}`, inst.id],
    );
    await paymentsService.finalizeGatewayWebhook(
      `inst-test-${randomUUID()}`,
      'transaction.status',
      'paymob',
      {},
      true,
      payment.id,
      false, // فشل عند البوابة
      'CARD_DECLINED_BY_ISSUER',
      'gw-tx-inst-2',
    );
    const instRow = await q<{ status: string; last_error: string | null }[]>(
      `SELECT status::text AS status, last_error FROM installments WHERE id=$1`,
      [inst.id],
    );
    expect(instRow[0].status).toBe('failed');
    expect(instRow[0].last_error).toContain('CARD_DECLINED');
    const ledger = await q<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM wallet_transactions WHERE reference_type='installment' AND reference_id=$1`,
      [inst.id],
    );
    expect(Number(ledger[0].count)).toBe(0); // الفشل = صفر حركة مالية
    void q; // eslint placeholder
  });
});
