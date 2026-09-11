import { DataSource } from 'typeorm';
import { FinancialDashboardService } from './financial-dashboard.service';
import { deleteWalletTransactions } from '../payments/wallet-cleanup.testing';

/**
 * ADR-0081 §5 — لوحة المال، و«Unreconciled money = 0» اللي المالك سمّاه أهم سطر.
 *
 * **الاختبار اللي بيهم فعلاً هو اللي بيكسر الدفتر عمدًا.** فحص تسوية بيعدّي على بيانات سليمة
 * مش بيثبت حاجة — أي دالة بترجّع قايمة فاضية بتعدّي عليه. عشان كده هنا بنعمل تلات أنواع تلف
 * حقيقي في دفتر القيود واحدة واحدة، وبنتأكد إن كل واحدة **بتتمسك** وبيتقال فرقها بالقرش،
 * وبعدين بنصلّحها وبنتأكد إن الفحص رجع نضيف.
 *
 * ولإن الفحص بيمشي على كل محافظ القاعدة (مش بتوعنا بس)، كل اختبار بيقارن **بخط أساس** اتقاس
 * قبل التلف — فبيانات قديمة في قاعدة التطوير مابتخلّيش الاختبار كاذب في الاتجاهين.
 */
describe('FinancialDashboardService — لوحة المال وفحص التسوية (ADR-0081 §5) — حي', () => {
  jest.setTimeout(30_000);

  let dataSource: DataSource;
  let service: FinancialDashboardService;

  const runId = Date.now().toString(36);
  const ids = { user: '', wallet: '' };
  const txIds: string[] = [];

  const q = <T = unknown>(sql: string, params?: unknown[]): Promise<T> => dataSource.query(sql, params) as Promise<T>;

  /** حركة محفظة سليمة: بتحدّث الرصيد وبتسجّل السلسلة صح — زي ما `doubleEntry()` بيعمل. */
  async function addTransaction(direction: 'credit' | 'debit', amount: number): Promise<string> {
    const [wallet] = await q<{ balance_cents: number }[]>(`SELECT balance_cents FROM wallets WHERE id = $1`, [
      ids.wallet,
    ]);
    const before = Number(wallet.balance_cents);
    const after = direction === 'credit' ? before + amount : before - amount;
    const [tx] = await q<{ id: string }[]>(
      `INSERT INTO wallet_transactions (wallet_id, transaction_number, direction, transaction_type, amount_cents,
                                        balance_before_cents, balance_after_cents)
       VALUES ($1, $2, $3::wallet_tx_direction, 'adjustment', $4, $5, $6) RETURNING id`,
      [ids.wallet, `TXF-${runId}-${txIds.length}`.slice(0, 24), direction, amount, before, after],
    );
    await q(`UPDATE wallets SET balance_cents = $2 WHERE id = $1`, [ids.wallet, after]);
    txIds.push(tx.id);
    return tx.id;
  }

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak',
      entities: [],
    }).initialize();
    service = new FinancialDashboardService(dataSource);

    const [user] = await q<{ id: string }[]>(
      `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'technician') RETURNING id`,
      [`+20fd${runId}`.slice(0, 15), `فني مال ${runId}`],
    );
    ids.user = user.id;
    const [wallet] = await q<{ id: string }[]>(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',0) RETURNING id`,
      [user.id],
    );
    ids.wallet = wallet.id;

    await addTransaction('credit', 100_000);
    await addTransaction('debit', 30_000);
    await addTransaction('credit', 5_000);
  });

  afterAll(async () => {
    await deleteWalletTransactions(q, `wallet_id = $1`, [ids.wallet]);
    await q(`DELETE FROM wallets WHERE id = $1`, [ids.wallet]);
    await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await dataSource.destroy();
  });

  /**
   * الفحص **مقصور على محفظتنا** — قاعدة التطوير مليانة حركات كتبتها سبيكات تانية بأرصدة
   * يدوية، والعيّنة المرجّعة كانت هتبتلع مخالفاتنا وسطها. الفلتر ده هو نفسه اللي بيخدم
   * الأدمن لما يشخّص فني بعينه.
   */
  const myIssues = async () => (await service.reconciliationCheck(ids.wallet)).issues;

  describe('الدفتر السليم', () => {
    it('محفظة أرقامها مظبوطة مابتظهرش كمخالفة', async () => {
      expect(await myIssues()).toEqual([]);
    });

    it('الرصيد الفعلي = مجموع الحركات', async () => {
      const [row] = await q<{ balance_cents: number }[]>(`SELECT balance_cents FROM wallets WHERE id = $1`, [
        ids.wallet,
      ]);
      expect(Number(row.balance_cents)).toBe(75_000);
    });
  });

  describe('**كسر الدفتر عمدًا** — الفحص بيمسك ولا لأ؟', () => {
    it('١) رصيد اتعدّل من غير حركة: بيتمسك بالفرق بالقرش', async () => {
      await q(`UPDATE wallets SET balance_cents = balance_cents + 1234 WHERE id = $1`, [ids.wallet]);

      const issues = await myIssues();
      expect(issues).toHaveLength(1);
      expect(issues[0].kind).toBe('balance_mismatch');
      expect(issues[0].difference_cents).toBe(1234);
      expect(issues[0].owner_user_id).toBe(ids.user);

      await q(`UPDATE wallets SET balance_cents = balance_cents - 1234 WHERE id = $1`, [ids.wallet]);
      expect(await myIssues()).toEqual([]);
    });

    it('٢) حركة حسابها غلط (`after ≠ before ± amount`): بتتمسك بالحركة نفسها', async () => {
      const target = txIds[1];
      await q(`UPDATE wallet_transactions SET balance_after_cents = balance_after_cents + 500 WHERE id = $1`, [target]);

      const issues = await myIssues();
      const arithmetic = issues.filter((i) => i.kind === 'row_arithmetic');
      expect(arithmetic).toHaveLength(1);
      expect(arithmetic[0].transaction_id).toBe(target);
      expect(arithmetic[0].difference_cents).toBe(500);

      await q(`UPDATE wallet_transactions SET balance_after_cents = balance_after_cents - 500 WHERE id = $1`, [target]);
      expect(await myIssues()).toEqual([]);
    });

    it('٣) **السلسلة مكسورة والرصيد النهائي صح**: الثابتة الأولى وحدها كانت هتعدّي عليها', async () => {
      // بنعدّل `balance_before` و`balance_after` لحركة وسط بنفس المقدار — فحساب الصف يفضل
      // صح، والرصيد النهائي للمحفظة يفضل صح، **بس** السلسلة اتقطعت. ده بالظبط شكل التلف
      // اللي بيخلّي كشف حساب الفني كذب رغم إن الإجمالي مظبوط.
      const target = txIds[1];
      await q(
        `UPDATE wallet_transactions
            SET balance_before_cents = balance_before_cents + 700,
                balance_after_cents = balance_after_cents + 700
          WHERE id = $1`,
        [target],
      );

      const issues = await myIssues();
      expect(issues.some((i) => i.kind === 'balance_mismatch')).toBe(false);
      expect(issues.some((i) => i.kind === 'row_arithmetic')).toBe(false);
      const chain = issues.filter((i) => i.kind === 'chain_break');
      // الحركة اللي اتعدّلت + اللي بعدها (بقت بتبدأ من رصيد مختلف).
      expect(chain.length).toBeGreaterThanOrEqual(1);
      expect(chain[0].difference_cents).not.toBe(0);

      await q(
        `UPDATE wallet_transactions
            SET balance_before_cents = balance_before_cents - 700,
                balance_after_cents = balance_after_cents - 700
          WHERE id = $1`,
        [target],
      );
      expect(await myIssues()).toEqual([]);
    });

    it('حركة معكوسة مابتتحسبش في الرصيد المتوقّع', async () => {
      // حركة `is_reversed = true` المفروض تكون اتعكست بحركة مضادة، فمابتدخلش في المجموع.
      // بنسجّلها من غير ما نغيّر الرصيد، ولازم الفحص **مايشتكيش**.
      const [wallet] = await q<{ balance_cents: number }[]>(`SELECT balance_cents FROM wallets WHERE id = $1`, [
        ids.wallet,
      ]);
      const balance = Number(wallet.balance_cents);
      const [tx] = await q<{ id: string }[]>(
        `INSERT INTO wallet_transactions (wallet_id, transaction_number, direction, transaction_type, amount_cents,
                                          balance_before_cents, balance_after_cents, is_reversed)
         VALUES ($1, $2, 'credit', 'adjustment', 9000, $3, $4, true) RETURNING id`,
        [ids.wallet, `TXR-${runId}`.slice(0, 24), balance, balance + 9000],
      );

      const issues = await myIssues();
      // السلسلة هتشتكي (الحركة دي غيّرت الرصيد المسجّل بعدها) — بس **مش** الرصيد الإجمالي،
      // اللي هو اللي بيثبت إن المعكوسة اتستبعدت من المجموع.
      expect(issues.some((i) => i.kind === 'balance_mismatch')).toBe(false);

      // حذف خام **عن قصد**، مش `deleteWalletTransactions`: الصف ده اتكتب فوق من غير ما
      // يغيّر رصيد المحفظة (ده نص الاختبار)، فإرجاع أثره كان هيخصم 9000 من رصيد مظبوط
      // ويخلق `balance_mismatch` حقيقي بدل ما ينضّف.
      await q(`DELETE FROM wallet_transactions WHERE id = $1`, [tx.id]);
      expect(await myIssues()).toEqual([]);
    });
  });

  describe('لقطة المال — السلّم الخماسي اللي السياسة نصّت عليه', () => {
    it('بترجّع الخمس سطور بالاسم وبالترتيب، وكل واحد معاه تعريفه', async () => {
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));
      expect(snapshot.lines.map((l) => l.key)).toEqual([
        'gross_sales',
        'discounts',
        'refunds',
        'platform_revenue',
        'net_platform_revenue',
      ]);
      // **التعريف بيترد مع الرقم** — السياسة بتقول «مع تعريف واضح لكل رقم»، ولو التعريف عاش
      // في نص الواجهة أول تعديل في الحساب كان هيخلّيه كذب.
      for (const line of snapshot.lines) {
        expect(line.label_ar.length).toBeGreaterThan(0);
        expect(line.definition_ar.length).toBeGreaterThan(20);
      }
    });

    it('أرباح الفني والمساعد سطرين منفصلين', async () => {
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));
      expect(typeof snapshot.technician_earnings_cents).toBe('number');
      expect(typeof snapshot.assistant_earnings_cents).toBe('number');
      expect(typeof snapshot.pending_settlements_cents).toBe('number');
    });

    it('`unreconciled_count` في اللقطة = العدد الكامل مش طول العيّنة', async () => {
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));
      const report = await service.reconciliationCheck();
      // **الرقم الرئيسي هو العدد الكامل** — دي البَقّة اللي الاختبار ده لقاها: العيّنة
      // مسقّفة عند ١٠٠، فلو الرقم اتحسب منها كان هيقول أقل من الحقيقة.
      expect(snapshot.unreconciled_count).toBe(report.total_issues);
      expect(report.total_issues).toBeGreaterThanOrEqual(report.issues.length);
      expect(report.issues_truncated).toBe(report.total_issues > report.issues.length);
      expect(report.is_balanced).toBe(report.total_issues === 0);
    });
  });

  describe('الدفع المزدوج — «حالة واضحة للأدمن، والاسترداد يدوي فقط»', () => {
    let orderId = '';
    const paymentIds: string[] = [];
    const seed = {
      country: '',
      city: '',
      zone: '',
      category: '',
      service: '',
      customerUser: '',
      customerProfile: '',
      address: '',
      adminUser: '',
    };

    beforeAll(async () => {
      const [country] = await q<{ id: string }[]>(
        `INSERT INTO countries (name_ar, name_en, iso_code, currency_code, phone_prefix)
         VALUES ($1,$2,$3,'EGP','+20') RETURNING id`,
        [`دولة دفع ${runId}`, `Pay Country ${runId}`, runId.slice(-2).toUpperCase()],
      );
      seed.country = country.id;
      const [city] = await q<{ id: string }[]>(
        `INSERT INTO cities (country_id, name_ar, name_en, slug) VALUES ($1,$2,$3,$4) RETURNING id`,
        [country.id, `مدينة دفع ${runId}`, `Pay City ${runId}`, `pay-city-${runId}`],
      );
      seed.city = city.id;
      const [zone] = await q<{ id: string }[]>(
        `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
        [city.id, `نطاق دفع ${runId}`, `Pay Zone ${runId}`],
      );
      seed.zone = zone.id;
      const [category] = await q<{ id: string }[]>(
        `INSERT INTO service_categories (name_ar, name_en, slug) VALUES ($1,$2,$3) RETURNING id`,
        [`فئة دفع ${runId}`, `Pay Category ${runId}`, `pay-cat-${runId}`],
      );
      seed.category = category.id;
      const [svc] = await q<{ id: string }[]>(
        `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents, commission_percentage, warranty_days)
         VALUES ($1,$2,$3,'formula',30000,20,0) RETURNING id`,
        [category.id, `خدمة دفع ${runId}`, `pay-svc-${runId}`],
      );
      seed.service = svc.id;
      const [customerUser] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'customer') RETURNING id`,
        [`+20dp${runId}`.slice(0, 15), `عميل دفع ${runId}`],
      );
      seed.customerUser = customerUser.id;
      const [profile] = await q<{ id: string }[]>(
        `INSERT INTO customer_profiles (user_id) VALUES ($1) RETURNING id`,
        [customerUser.id],
      );
      seed.customerProfile = profile.id;
      const [address] = await q<{ id: string }[]>(
        `INSERT INTO addresses (user_id, street_name, location)
         VALUES ($1,$2, ST_SetSRID(ST_MakePoint(31.25, 30.05), 4326)::geography) RETURNING id`,
        [customerUser.id, `شارع دفع ${runId}`],
      );
      seed.address = address.id;

      const [adminUser] = await q<{ id: string }[]>(
        `INSERT INTO users (phone_number, full_name, user_type) VALUES ($1,$2,'admin') RETURNING id`,
        [`+20da${runId}`.slice(0, 15), `أدمن دفع ${runId}`],
      );
      seed.adminUser = adminUser.id;

      const [order] = await q<{ id: string }[]>(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id, service_zone_id,
                             order_status, payment_status, total_amount_cents, platform_commission_cents,
                             technician_earning_cents, worker_pool_cents, calculation_algorithm_version, booking_mode, paid_at)
         VALUES (20, $1, $2, $3, $4, $5, 'completed', 'paid', 50000, 10000, 40000, 40000, 'v2', 'individual', now())
         RETURNING id`,
        [`DBLP-${runId}`.slice(0, 24), seed.customerProfile, seed.service, seed.address, seed.zone],
      );
      orderId = order.id;
    });

    afterAll(async () => {
      await q(`DELETE FROM payments WHERE id = ANY($1)`, [paymentIds]);
      await q(`DELETE FROM orders WHERE id = $1`, [orderId]);
      await q(`DELETE FROM addresses WHERE id = $1`, [seed.address]);
      await q(`DELETE FROM customer_profiles WHERE id = $1`, [seed.customerProfile]);
      await q(`DELETE FROM users WHERE id = ANY($1)`, [[seed.customerUser, seed.adminUser]]);
      await q(`DELETE FROM services WHERE id = $1`, [seed.service]);
      await q(`DELETE FROM service_categories WHERE id = $1`, [seed.category]);
      await q(`DELETE FROM service_zones WHERE id = $1`, [seed.zone]);
      await q(`DELETE FROM cities WHERE id = $1`, [seed.city]);
      await q(`DELETE FROM countries WHERE id = $1`, [seed.country]);
    });

    const addPayment = async (amount: number): Promise<string> => {
      const [payment] = await q<{ id: string }[]>(
        `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method, payment_status,
                               completed_at, idempotency_key)
         VALUES ($1, $2, $3, $4, 'card', 'succeeded', now(), $5) RETURNING id`,
        [
          `PAYD-${runId}-${paymentIds.length}`.slice(0, 24),
          orderId,
          seed.customerProfile,
          amount,
          `idem-${runId}-${paymentIds.length}`,
        ],
      );
      paymentIds.push(payment.id);
      return payment.id;
    };

    const mine = async () => (await service.detectDoublePayments()).filter((c) => c.order_id === orderId);

    it('دفعة واحدة مظبوطة: مفيش حالة', async () => {
      await addPayment(50_000);
      expect(await mine()).toEqual([]);
    });

    it('دفعتين ناجحتين على نفس الطلب: بتظهر كحالة بالزيادة بالقرش', async () => {
      await addPayment(50_000);

      const cases = await mine();
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        order_total_cents: 50_000,
        paid_cents: 100_000,
        overpaid_cents: 50_000,
        succeeded_payments: 2,
      });
    });

    it('اللقطة بتعرض الحالة والزيادة، **من غير ما تحرّك أي فلوس**', async () => {
      const beforeRefunds = await q<{ count: string }[]>(`SELECT COUNT(*) FROM refunds WHERE order_id = $1`, [orderId]);
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));

      expect(snapshot.double_payments_count).toBeGreaterThanOrEqual(1);
      expect(snapshot.double_payments.some((c) => c.order_id === orderId)).toBe(true);

      // **الضمانة اللي السياسة بتطلبها**: «ممنوع خروج أي أموال تلقائيًا بدون إجراء بشري».
      // الكشف قراءة بحتة — لو حد ضاف استرداد تلقائي هنا يومًا ما، الاختبار ده بيقع.
      const afterRefunds = await q<{ count: string }[]>(`SELECT COUNT(*) FROM refunds WHERE order_id = $1`, [orderId]);
      expect(afterRefunds[0].count).toBe(beforeRefunds[0].count);
    });

    it('بعد استرداد الزيادة **يدويًا**، الحالة بتتقفل', async () => {
      // `refunds.requested_by_user_id` عمود **NOT NULL** — يعني السياسة «ممنوع خروج أي أموال
      // تلقائيًا بدون إجراء بشري» مفروضة على مستوى القاعدة نفسها، مش بالاتفاق بس: مفيش صف
      // استرداد يقدر يتولد من غير ما يبان مين طلبه.
      const [refund] = await q<{ id: string }[]>(
        `INSERT INTO refunds (refund_number, order_id, payment_id, amount_cents, refund_type, refund_method,
                              refund_status, requested_by_user_id, completed_at)
         VALUES ($1, $2, $3, 50000, 'partial', 'original_method', 'completed', $4, now()) RETURNING id`,
        [`RFD-${runId}`.slice(0, 24), orderId, paymentIds[0], seed.adminUser],
      );

      expect(await mine()).toEqual([]);

      await q(`DELETE FROM refunds WHERE id = $1`, [refund.id]);
    });
  });
});
