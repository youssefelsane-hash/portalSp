import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Order } from '../orders/entities/order.entity';
import { Payment, PaymentGatewayStatus } from './entities/payment.entity';
import { Refund } from './entities/refund.entity';
import { User } from '../auth/entities/user.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { OrderStatusHistory } from '../orders/entities/order-status-history.entity';
import { crewEarningsServiceStub } from './crew-earnings.testing';

// اختبار حي ضد Postgres حقيقي — تكملة InstaPay اليدوي (ADR-0013 §7، docs/08 §163):
// confirmInstaPayTransferByCustomer() (العميل يقول "أنا حوّلت") + rejectInstaPayPayment()
// (الأدمن يرفض التحويل). كانت فجوتين حقيقيتين: العميل معندوش أثر مسجّل إنه ادّعى التحويل،
// والأدمن معندوش رفض صريح مقابل التأكيد.
describe('PaymentsService — تأكيد العميل ورفض الأدمن لتحويل InstaPay اليدوي', () => {
  let dataSource: DataSource;
  let service: PaymentsService;
  const runId = Date.now().toString(36);
  const auditRecord = jest.fn().mockResolvedValue(undefined);
  const eventsEmit = jest.fn();
  const ids = {
    country: '',
    city: '',
    zone: '',
    category: '',
    service: '',
    customerUser: '',
    customerProfile: '',
    otherCustomerUser: '',
    otherCustomerProfile: '',
    address: '',
    order: '',
    order2: '',
    instapayPayment: '',
    instapayPayment2: '',
    cardPayment: '',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [Order, Payment, Refund, User, WebhookEvent, CustomerProfile, OrderStatusHistory],
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
      [ids.country, `مدينة اختبار ${runId}`, `Test City ${runId}`, `test-city-ip-${runId}`],
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
      [`فئة اختبار ${runId}`, `Test Category ${runId}`, `test-category-ip-${runId}`],
    );
    ids.category = category.id;
    const [serviceRow] = await q(
      `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents) VALUES ($1,$2,$3,'formula',10000) RETURNING id`,
      [ids.category, `خدمة اختبار ${runId}`, `test-service-ip-${runId}`],
    );
    ids.service = serviceRow.id;
    const [customerUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2019${runId}`.slice(0, 15), `عميل اختبار ${runId}`],
    );
    ids.customerUser = customerUser.id;
    const [customerProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.customerUser,
    ]);
    ids.customerProfile = customerProfile.id;

    const [otherUser] = await q(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
      [`+2020${runId}`.slice(0, 15), `عميل تاني اختبار ${runId}`],
    );
    ids.otherCustomerUser = otherUser.id;
    const [otherProfile] = await q(`INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`, [
      ids.otherCustomerUser,
    ]);
    ids.otherCustomerProfile = otherProfile.id;

    const [address] = await q(
      `INSERT INTO addresses (user_id, street_name, location)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
      [ids.customerUser, `شارع اختبار ${runId}`],
    );
    ids.address = address.id;

    const [order] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status,
         payment_status, total_amount_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,'pending_payment','pending',100000, now()) RETURNING id`,
      [`TESTIP-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order = order.id;

    const [instapayPayment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, initiated_at)
       VALUES ($1,$2,$3,$4,'instapay','pending',$5, now()) RETURNING id`,
      [`PAYIP-${runId}`.slice(0, 24), ids.order, ids.customerProfile, 100000, `idem-ip-${runId}`],
    );
    ids.instapayPayment = instapayPayment.id;

    const [cardPayment] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, initiated_at)
       VALUES ($1,$2,$3,$4,'card','pending',$5, now()) RETURNING id`,
      [`PAYCARD-${runId}`.slice(0, 24), ids.order, ids.customerProfile, 100000, `idem-card-${runId}`],
    );
    ids.cardPayment = cardPayment.id;

    // طلب/دفعة InstaPay ثانية منفصلة تمامًا — مخصوصة لاختبار confirmInstaPayPayment() (§28) من
    // غير ما تتداخل مع طلب/دفعة confirmInstaPayTransferByCustomer/rejectInstaPayPayment فوق
    // (confirmInstaPayTransferByCustomer بيدوّر على "أحدث دفعة instapay pending للطلب" —
    // لازم يبقى طلب مختلف تمامًا عشان مايتلخبطش مع الدفعة التانية).
    const [order2] = await q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id, order_status,
         payment_status, total_amount_cents, placed_at)
       VALUES ($1,$2,$3,$4,$5,'pending_payment','pending',100000, now()) RETURNING id`,
      [`TESTIP2-${runId}`.slice(0, 24), ids.customerProfile, ids.service, ids.address, ids.zone],
    );
    ids.order2 = order2.id;
    const [instapayPayment2] = await q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status, idempotency_key, initiated_at)
       VALUES ($1,$2,$3,$4,'instapay','pending',$5, now()) RETURNING id`,
      [`PAYIP2-${runId}`.slice(0, 24), ids.order2, ids.customerProfile, 100000, `idem-ip2-${runId}`],
    );
    ids.instapayPayment2 = instapayPayment2.id;

    service = new PaymentsService(
      dataSource.getRepository(Order),
      dataSource.getRepository(Payment),
      dataSource.getRepository(Refund),
      dataSource.getRepository(User),
      dataSource.getRepository(WebhookEvent),
      dataSource,
      {} as never,
      {} as never,
      {
        findByUserIdOrThrow: async (userId: string) => {
          if (userId === ids.customerUser) return { id: ids.customerProfile } as CustomerProfile;
          if (userId === ids.otherCustomerUser) return { id: ids.otherCustomerProfile } as CustomerProfile;
          throw new Error('مستخدم اختبار غير معروف');
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { getNumber: async () => 4 } as never, // settingsService
      { record: auditRecord } as never,
      // events — emitAsync() كمان بيتنادى (مش emit() بس) جوّه emitPaymentConfirmedEvents()
      // لحدث ORDER_CREATED_EVENT.
      { emit: eventsEmit, emitAsync: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never, // installments repo (migration 0177)
      crewEarningsServiceStub(),
    );
  });

  afterAll(async () => {
    const q = (sql: string, params?: unknown[]) => dataSource.query(sql, params);
    await q(`DELETE FROM payments WHERE order_id = $1`, [ids.order]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order]);
    // order2/instapayPayment2 (§28 — confirmInstaPayPayment() تست) — بيولّد order_status_history
    // صف حقيقي (بعكس order1 اللي دورته كلها reject، مفيهاش أي history)، لازم يتمسح الأول قبل الطلب.
    await q(`DELETE FROM order_status_history WHERE order_id = $1`, [ids.order2]);
    await q(`DELETE FROM payments WHERE order_id = $1`, [ids.order2]);
    await q(`DELETE FROM orders WHERE id = $1`, [ids.order2]);
    await q(`DELETE FROM addresses WHERE id = $1`, [ids.address]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.customerProfile]);
    await q(`DELETE FROM customer_profiles WHERE id = $1`, [ids.otherCustomerProfile]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.customerUser]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.otherCustomerUser]);
    await q(`DELETE FROM services WHERE id = $1`, [ids.service]);
    await q(`DELETE FROM service_categories WHERE id = $1`, [ids.category]);
    await q(`DELETE FROM service_zones WHERE id = $1`, [ids.zone]);
    await q(`DELETE FROM cities WHERE id = $1`, [ids.city]);
    await dataSource.destroy();
  });

  describe('confirmInstaPayTransferByCustomer()', () => {
    it('عميل تاني معندوش صلاحية يأكد تحويل طلب مش بتاعه', async () => {
      await expect(
        service.confirmInstaPayTransferByCustomer(ids.otherCustomerUser, ids.order),
      ).rejects.toThrow('الطلب ده مش بتاعك');
    });

    it('طلب غير موجود يترفض بوضوح', async () => {
      await expect(
        service.confirmInstaPayTransferByCustomer(ids.customerUser, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow('الطلب غير موجود');
    });

    it('بيسجّل customer_confirmed_transfer_at أول مرة، وبيفضل ثابت (idempotent) في نداء تاني — وبيبعت حدث تبليغ للأدمن مرة واحدة بس', async () => {
      eventsEmit.mockClear();
      const first = await service.confirmInstaPayTransferByCustomer(ids.customerUser, ids.order);
      expect(first.id).toBe(ids.instapayPayment);
      expect(first.customerConfirmedTransferAt).not.toBeNull();
      const firstTimestamp = first.customerConfirmedTransferAt!.getTime();
      // §28 — فجوة الرصد اللي اتقفلت: أول تبليغ لازم يطلق حدث توجيه لفريق Finance.
      expect(eventsEmit).toHaveBeenCalledWith(
        'payment.instapay_transfer_reported',
        expect.objectContaining({ paymentId: ids.instapayPayment, orderId: ids.order }),
      );
      expect(eventsEmit).toHaveBeenCalledTimes(1);

      const second = await service.confirmInstaPayTransferByCustomer(ids.customerUser, ids.order);
      expect(second.customerConfirmedTransferAt!.getTime()).toBe(firstTimestamp);
      // نقر مزدوج — مفيش حدث تاني اتصدّر (كان هيبعت تنبيه مكرر لفريق Finance بلا داعي).
      expect(eventsEmit).toHaveBeenCalledTimes(1);

      const [row] = await dataSource.query(`SELECT customer_confirmed_transfer_at FROM payments WHERE id = $1`, [
        ids.instapayPayment,
      ]);
      expect(row.customer_confirmed_transfer_at).not.toBeNull();
    });
  });

  describe('confirmInstaPayPayment() — §28: إشعار تأكيد مخصوص + idempotency', () => {
    it('يأكّد الدفعة، يبدأ التوزيع، وبيبعت حدث تأكيد مخصوص للعميل مرة واحدة بس', async () => {
      eventsEmit.mockClear();
      // confirmInstaPayPayment() (بعكس rejectInstaPayPayment) بيحفظ collectedByUserId
      // (payments.collected_by_user_id) وchangedByUserId (order_status_history.changed_by_user_id)
      // في أعمدة UUID حقيقية بـFK فعلي على users — لازم مستخدم موجود بالفعل، مش نص حر زي
      // 'admin-1' ولا UUID عشوائي. بنستخدم customerUser الموجود أصلاً (مش دقيق دلاليًا كـ"أدمن"،
      // بس كفاية لاختبار سلوك الأحداث/الـidempotency).
      const adminUserId = ids.customerUser;
      const confirmed = await service.confirmInstaPayPayment(adminUserId, ids.instapayPayment2);
      expect(confirmed.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
      expect(confirmed.completedAt).not.toBeNull();

      expect(eventsEmit).toHaveBeenCalledWith(
        'payment.instapay_confirmed',
        expect.objectContaining({ orderId: ids.order2, customerId: ids.customerProfile }),
      );
      const confirmedEmitCount = eventsEmit.mock.calls.filter((call) => call[0] === 'payment.instapay_confirmed').length;
      expect(confirmedEmitCount).toBe(1);

      // نقر مزدوج — الدفعة بقت succeeded خلاص، مسار الـidempotency بيرجّعها من غير أثر مالي إضافي
      // ومن غير ما يبعت حدث "تأكيد" تاني (كان هيوصل للعميل إشعار مكرر "تحويلك اتأكّد" بلا داعي).
      eventsEmit.mockClear();
      const confirmedAgain = await service.confirmInstaPayPayment(adminUserId, ids.instapayPayment2);
      expect(confirmedAgain.paymentStatus).toBe(PaymentGatewayStatus.SUCCEEDED);
      expect(confirmedAgain.completedAt!.getTime()).toBe(confirmed.completedAt!.getTime());
      expect(eventsEmit).not.toHaveBeenCalledWith('payment.instapay_confirmed', expect.anything());

      const [row] = await dataSource.query(
        `SELECT p.payment_status AS payment_status, o.order_status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1`,
        [ids.instapayPayment2],
      );
      expect(row.payment_status).toBe(PaymentGatewayStatus.SUCCEEDED);
      expect(row.order_status).toBe('searching_technician');
    });
  });

  describe('rejectInstaPayPayment()', () => {
    it('مش InstaPay يترفض بوضوح', async () => {
      await expect(service.rejectInstaPayPayment('admin-1', ids.cardPayment, 'سبب تجريبي')).rejects.toThrow(
        'الدفعة دي مش InstaPay',
      );
    });

    it('دفعة غير موجودة تترفض بوضوح', async () => {
      await expect(
        service.rejectInstaPayPayment('admin-1', '00000000-0000-0000-0000-000000000000', 'سبب تجريبي'),
      ).rejects.toThrow('الدفعة غير موجودة');
    });

    it('يرفض الدفعة المعلّقة، يسجّل السبب، ويبعت حدث الرفض — والرفض التاني يترفض لأنها مش pending', async () => {
      eventsEmit.mockClear();
      const rejected = await service.rejectInstaPayPayment('admin-1', ids.instapayPayment, 'الكود المرجعي مش مطابق');

      expect(rejected.paymentStatus).toBe(PaymentGatewayStatus.FAILED);
      expect(rejected.failureCode).toBe('instapay_manual_rejection');
      expect(rejected.failureMessage).toBe('الكود المرجعي مش مطابق');
      expect(rejected.failedAt).not.toBeNull();
      expect(eventsEmit).toHaveBeenCalledWith(
        'payment.instapay_rejected',
        expect.objectContaining({ orderId: ids.order, reason: 'الكود المرجعي مش مطابق' }),
      );

      const [row] = await dataSource.query(`SELECT payment_status, failure_code FROM payments WHERE id = $1`, [
        ids.instapayPayment,
      ]);
      expect(row.payment_status).toBe(PaymentGatewayStatus.FAILED);
      expect(row.failure_code).toBe('instapay_manual_rejection');

      await expect(
        service.rejectInstaPayPayment('admin-1', ids.instapayPayment, 'محاولة رفض تانية'),
      ).rejects.toThrow('الدفعة دي مش معلّقة عشان ترفضها');
    });

    it('طلب معلق InstaPay اتقفل بعد الرفض، العميل ميقدرش يأكد تحويل بعد كده (مفيش دفعة pending)', async () => {
      await expect(service.confirmInstaPayTransferByCustomer(ids.customerUser, ids.order)).rejects.toThrow(
        'مفيش دفعة InstaPay معلّقة للطلب ده',
      );
    });
  });
});
