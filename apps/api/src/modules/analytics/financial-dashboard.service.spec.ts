import { DataSource } from 'typeorm';
import { FinancialDashboardService } from './financial-dashboard.service';

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
    await q(`DELETE FROM wallet_transactions WHERE wallet_id = $1`, [ids.wallet]);
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

      await q(`DELETE FROM wallet_transactions WHERE id = $1`, [tx.id]);
      expect(await myIssues()).toEqual([]);
    });
  });

  describe('لقطة المال', () => {
    it('بترجّع كل السطور اللي المالك طلبها', async () => {
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));
      expect(snapshot).toMatchObject({
        gmv_cents: 0,
        platform_revenue_cents: 0,
        technician_earnings_cents: 0,
        assistant_earnings_cents: 0,
        discounts_cents: 0,
        refunds_cents: 0,
        failed_payments_count: 0,
      });
      expect(typeof snapshot.pending_settlements_cents).toBe('number');
    });

    it('`unreconciled_count` في اللقطة = نفس عدد مخالفات الفحص التفصيلي', async () => {
      const snapshot = await service.moneySnapshot(new Date('2031-04-01T00:00:00Z'), new Date('2031-04-02T00:00:00Z'));
      const report = await service.reconciliationCheck();
      // **الرقم الرئيسي هو العدد الكامل مش طول العيّنة** — دي البَقّة اللي الاختبار ده
      // لقاها: العيّنة مسقّفة عند ١٠٠، فلو الرقم اتحسب منها كان هيقول أقل من الحقيقة.
      expect(snapshot.unreconciled_count).toBe(report.total_issues);
      expect(report.total_issues).toBeGreaterThanOrEqual(report.issues.length);
      expect(report.issues_truncated).toBe(report.total_issues > report.issues.length);
      expect(report.is_balanced).toBe(report.total_issues === 0);
    });
  });
});
