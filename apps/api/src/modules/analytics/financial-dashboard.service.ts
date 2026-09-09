import { Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SETTLED_PAYMENT_STATUSES } from './metric-definitions';
import { SettingsService } from '../settings/settings.service';

/**
 * سطر مالي بتعريفه — **التعريف بيترد مع الرقم مش مكتوب في الواجهة**.
 *
 * سياسة الشركة بتقول بالحرف: «تعرض الأرقام منفصلة وواضحة… مع تعريف واضح لكل رقم». لو
 * التعريف عاش في نص الواجهة، أول تعديل في الحساب بيخلّي الشرح كذب من غير ما حد ياخد باله.
 */
export interface MoneyLine {
  key: string;
  amount_cents: number;
  label_ar: string;
  definition_ar: string;
}

export interface DoublePaymentCase {
  order_id: string;
  order_number: string;
  order_total_cents: number;
  paid_cents: number;
  /** الزيادة عن إجمالي الطلب — ده المبلغ اللي محتاج قرار بشري. */
  overpaid_cents: number;
  succeeded_payments: number;
  last_payment_at: string | null;
}

export interface MoneySnapshot {
  from: string;
  to: string;
  /**
   * السلّم المالي الخماسي اللي سياسة الشركة نصّت عليه بالاسم:
   * Gross Sales → Discounts → Refunds → Platform Revenue → Net Platform Revenue.
   */
  lines: MoneyLine[];
  technician_earnings_cents: number;
  assistant_earnings_cents: number;
  pending_settlements_cents: number;
  pending_settlements_count: number;
  failed_payments_count: number;
  failed_payments_cents: number;
  /**
   * **الدفع المزدوج** — سياسة الشركة: «يظهر للأدمن كحالة واضحة، والاسترداد يدوي فقط».
   * اللوحة بتعرضه وبس؛ مفيش أي مسار هنا بيحرّك فلوس.
   */
  double_payments_count: number;
  double_payments_overpaid_cents: number;
  double_payments: DoublePaymentCase[];
  /** **أهم سطر في اللوحة**: عدد مخالفات ثوابت دفتر القيود. لازم يفضل صفر. */
  unreconciled_count: number;
}

export type ReconciliationIssueKind = 'balance_mismatch' | 'row_arithmetic' | 'chain_break';

export interface ReconciliationIssue {
  kind: ReconciliationIssueKind;
  wallet_id: string;
  owner_user_id: string;
  /** الفرق بالقرش — مش «فيه مشكلة» مجرّدة، الرقم اللي ناقص أو زايد بالظبط. */
  difference_cents: number;
  transaction_id: string | null;
  transaction_number: string | null;
  detail: string;
}

export interface ReconciliationReport {
  checked_wallets: number;
  checked_transactions: number;
  /**
   * العدد **الحقيقي الكامل** للمخالفات — مش طول `issues`.
   *
   * الفرق ده مهم: `issues` عيّنة محدودة عشان الرد مايبقاش ضخم، ولو الرقم الرئيسي اتحسب من
   * طولها كان هيتسقّف عند حد العيّنة ويقول «١٠٠ مخالفة» مهما كان العدد الحقيقي. الرقم اللي
   * المالك بيشوفه لازم يكون الحقيقي.
   */
  total_issues: number;
  /** عيّنة من المخالفات للتشخيص — مش القايمة الكاملة لما العدد كبير. */
  issues: ReconciliationIssue[];
  issues_truncated: boolean;
  /** الثابتة الوحيدة المقبولة. */
  is_balanced: boolean;
  /** مخالفات دفتر المحافظ فقط؛ مفصولة عن حالات التشغيل المالي حتى لا تختلط على فريق المالية. */
  ledger_issues_total: number;
  /** دفعات/استردادات/طلبات تحتاج قرارًا بشريًا؛ لا يوجد أي إجراء مالي تلقائي هنا. */
  operational_issues_total: number;
  operational_issues: FinancialOperationalIssue[];
  operational_issues_truncated: boolean;
}

export type FinancialOperationalIssueKind =
  | 'stale_refund'
  | 'stale_payment'
  | 'cancelled_paid_missing_refund'
  | 'completed_unpaid';

/** حالة مالية عالقة خارج دفتر المحافظ. القراءة فقط حتى يبقى خروج المال قرارًا بشريًا صريحًا. */
export interface FinancialOperationalIssue {
  kind: FinancialOperationalIssueKind;
  order_id: string | null;
  order_number: string | null;
  related_id: string;
  amount_cents: number;
  occurred_at: string;
  detail: string;
}

/** حد العيّنة المرجّعة. الرقم الإجمالي بيتحسب منفصل ومابيتسقّفش. */
const ISSUE_SAMPLE_LIMIT = 100;

@Injectable()
export class FinancialDashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly settingsService?: SettingsService,
  ) {}

  /**
   * لوحة المال (ADR-0081 §5 + سياسة الشركة).
   *
   * السياسة نصّت على السلّم الخماسي بالاسم: **Gross Sales، Discounts، Refunds،
   * Platform Revenue، Net Platform Revenue** — «منفصلة وواضحة، مع تعريف واضح لكل رقم».
   * التعريف بيترد **مع** الرقم عشان مايعيشش في نص الواجهة وينفصل عن الحساب.
   *
   * الأرقام كلها بتتنسب لـ`paid_at` — «فلوس إيه دخلت الفترة دي؟» سؤال عن التحصيل مش عن وقت
   * الحجز. التسويات المعلّقة والدفع المزدوج بيتحسبوا كحالة حالية مش كرقم فترة.
   */
  async moneySnapshot(from: Date, to: Date): Promise<MoneySnapshot> {
    const [row] = await this.dataSource.query<
      {
        gross_sales: string;
        discounts: string;
        refunds: string;
        platform_revenue: string;
        commission_reversed: string;
        compensations: string;
        technician_earnings: string;
        assistant_earnings: string;
        pending_settlements: string;
        pending_settlements_count: string;
        failed_payments_count: string;
        failed_payments_cents: string;
      }[]
    >(
      `WITH settled AS (
         SELECT o.id, o.total_amount_cents, o.discount_amount_cents, o.platform_commission_cents,
                COALESCE((SELECT SUM(rsr.reversal_cents) FROM refund_settlement_reversals rsr
                           WHERE rsr.order_id = o.id AND rsr.bucket_type = 'platform'), 0) AS commission_reversed
           FROM orders o
          WHERE o.deleted_at IS NULL
            AND o.payment_status = ANY($3::order_payment_status[])
            AND o.paid_at >= $1 AND o.paid_at < $2
       )
       SELECT
         -- Gross Sales = قيمة الشغل **قبل** الخصم. العمود total_amount_cents متخزَّن بعد الخصم
         -- (OrdersService بيطرحه منه)، فبنرجّعه عشان السطر الأول يبقى إجمالي حقيقي والخصم
         -- يبان كسطر مستقل تحته — من غير كده الخصم كان هيتخصم مرتين بصريًا.
         COALESCE((SELECT SUM(total_amount_cents + discount_amount_cents) FROM settled), 0) AS gross_sales,
         COALESCE((SELECT SUM(discount_amount_cents) FROM settled), 0) AS discounts,
         COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                   WHERE r.refund_status = 'completed'
                     AND r.completed_at >= $1 AND r.completed_at < $2), 0) AS refunds,
         COALESCE((SELECT SUM(platform_commission_cents) FROM settled), 0) AS platform_revenue,
         COALESCE((SELECT SUM(commission_reversed) FROM settled), 0) AS commission_reversed,
         COALESCE((SELECT SUM(c.compensation_cents) FROM complaints c
                   WHERE c.compensation_cents IS NOT NULL
                     AND c.resolved_at >= $1 AND c.resolved_at < $2), 0) AS compensations,
         -- أرباح الفني والمساعد **منفصلين** — المالك طلب السطرين صراحةً. المصدر
         -- order_earning_shares مش عمود مجمّع على الطلب، عشان التقسيم يبقى حقيقي.
         COALESCE((SELECT SUM(s.share_cents) FROM order_earning_shares s
                    WHERE s.deleted_at IS NULL AND s.order_id IN (SELECT id FROM settled)
                      AND COALESCE(s.earning_role, 'technician') <> 'assistant'), 0) AS technician_earnings,
         COALESCE((SELECT SUM(s.share_cents) FROM order_earning_shares s
                    WHERE s.deleted_at IS NULL AND s.order_id IN (SELECT id FROM settled)
                      AND s.earning_role = 'assistant'), 0) AS assistant_earnings,
         -- التسويات المعلّقة = فلوس المنصة مدينة بيها للفنيين ولسه ما خرجتش. حالة حالية.
         COALESCE((SELECT SUM(p.amount_cents) FROM payouts p
                   WHERE p.payout_status IN ('requested', 'under_review', 'approved', 'processing')), 0) AS pending_settlements,
         (SELECT COUNT(*) FROM payouts p
           WHERE p.payout_status IN ('requested', 'under_review', 'approved', 'processing')) AS pending_settlements_count,
         (SELECT COUNT(*) FROM payments pay
           WHERE pay.payment_status = 'failed' AND pay.failed_at >= $1 AND pay.failed_at < $2) AS failed_payments_count,
         COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay
                   WHERE pay.payment_status = 'failed' AND pay.failed_at >= $1 AND pay.failed_at < $2), 0) AS failed_payments_cents`,
      [from, to, [...SETTLED_PAYMENT_STATUSES]],
    );

    const grossSales = Number(row?.gross_sales ?? 0);
    const discounts = Number(row?.discounts ?? 0);
    const refunds = Number(row?.refunds ?? 0);
    const platformRevenue = Number(row?.platform_revenue ?? 0);
    const commissionReversed = Number(row?.commission_reversed ?? 0);
    const compensations = Number(row?.compensations ?? 0);

    const [reconciliation, doublePayments] = await Promise.all([
      this.reconciliationCheck(),
      this.detectDoublePayments(),
    ]);

    const lines: MoneyLine[] = [
      {
        key: 'gross_sales',
        amount_cents: grossSales,
        label_ar: 'إجمالي المبيعات',
        definition_ar: 'قيمة كل الطلبات المدفوعة في الفترة **قبل** أي خصم. ده حجم الشغل اللي عدّى على المنصة، مش دخل الشركة.',
      },
      {
        key: 'discounts',
        amount_cents: discounts,
        label_ar: 'الخصومات',
        definition_ar: 'أكواد الخصم والعروض على نفس الطلبات. تكلفة ترويج بتتحملها المنصة بالكامل (migration 0287)، مش خصم من مستحق الفني.',
      },
      {
        key: 'refunds',
        amount_cents: refunds,
        label_ar: 'الاستردادات',
        definition_ar: 'المبالغ اللي رجعت للعملاء فعليًا (استرداد مكتمل) في الفترة، بتاريخ تنفيذها مش بتاريخ الطلب الأصلي.',
      },
      {
        key: 'platform_revenue',
        amount_cents: platformRevenue,
        label_ar: 'إيراد المنصة',
        definition_ar: 'عمولة المنصة المسجّلة على الطلبات المدفوعة — **قبل** خصم أي استرداد أو تكلفة. ده الدخل الخام للشركة.',
      },
      {
        key: 'net_platform_revenue',
        amount_cents: platformRevenue - commissionReversed - discounts - compensations,
        label_ar: 'صافي إيراد المنصة',
        definition_ar:
          'إيراد المنصة ناقص: الجزء اللي رجع من العمولة في الاستردادات، والخصومات، وتعويضات الشكاوى. ده الرقم اللي بيقول الشركة كسبت كام فعلاً.',
      },
    ];

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      lines,
      technician_earnings_cents: Number(row?.technician_earnings ?? 0),
      assistant_earnings_cents: Number(row?.assistant_earnings ?? 0),
      pending_settlements_cents: Number(row?.pending_settlements ?? 0),
      pending_settlements_count: Number(row?.pending_settlements_count ?? 0),
      failed_payments_count: Number(row?.failed_payments_count ?? 0),
      failed_payments_cents: Number(row?.failed_payments_cents ?? 0),
      double_payments_count: doublePayments.length,
      double_payments_overpaid_cents: doublePayments.reduce((sum, c) => sum + c.overpaid_cents, 0),
      double_payments: doublePayments,
      unreconciled_count: reconciliation.total_issues,
    };
  }

  /**
   * **الدفع المزدوج** — سياسة الشركة: «يظهر للأدمن كحالة واضحة، والاسترداد يتم يدويًا فقط.
   * ممنوع خروج أي أموال تلقائيًا بدون إجراء بشري».
   *
   * الدالة دي **قراءة بحتة**: بتكشف الطلبات اللي اتدفعت أكتر من إجماليها وبتقول الزيادة
   * بالقرش، وبس. مفيش أي `INSERT` ولا `UPDATE` هنا ولا في أي مسار بيناديها — الاسترداد
   * بيفضل بقرار أدمن من شاشة الاستردادات. `financial-dashboard.service.spec.ts` بيثبت إن
   * الكشف مابيولّدش أي صف استرداد.
   *
   * بتشوف الحالة **الحالية** مش فترة: طلب اتدفع مرتين الشهر اللي فات ولسه ما اتصرفش فيه
   * لازم يفضل ظاهر النهارده.
   */
  async detectDoublePayments(limit = 50): Promise<DoublePaymentCase[]> {
    const rows = await this.dataSource.query<
      {
        order_id: string;
        order_number: string;
        order_total_cents: number;
        paid_cents: string;
        succeeded_payments: string;
        last_payment_at: Date | null;
      }[]
    >(
      `SELECT o.id AS order_id,
              o.order_number,
              o.total_amount_cents AS order_total_cents,
              SUM(p.amount_cents) AS paid_cents,
              COUNT(*) AS succeeded_payments,
              MAX(p.completed_at) AS last_payment_at
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.deleted_at IS NULL
        WHERE p.payment_status = 'succeeded'
        GROUP BY o.id
       HAVING COUNT(*) > 1 AND SUM(p.amount_cents) > o.total_amount_cents
          -- الاسترداد اللي اتنفّذ فعلاً بيقفل الحالة: المبلغ الزايد رجع بقرار بشري.
          AND SUM(p.amount_cents) - o.total_amount_cents >
              COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                         WHERE r.order_id = o.id AND r.refund_status = 'completed'), 0)
        ORDER BY SUM(p.amount_cents) - o.total_amount_cents DESC
        LIMIT $1`,
      [limit],
    );

    return rows.map((r) => {
      const paid = Number(r.paid_cents);
      const total = Number(r.order_total_cents);
      return {
        order_id: r.order_id,
        order_number: r.order_number,
        order_total_cents: total,
        paid_cents: paid,
        overpaid_cents: paid - total,
        succeeded_payments: Number(r.succeeded_payments),
        last_payment_at: r.last_payment_at ? new Date(r.last_payment_at).toISOString() : null,
      };
    });
  }

  /**
   * **«Unreconciled money = 0»** — أهم سطر في اللوحة حسب طلب المالك (ADR-0081 §5).
   *
   * ده **فحص ثوابت على دفتر القيود**، مش رقم بيتخزّن أو بيتحسب من عمود. تلات ثوابت، وأي
   * مخالفة بترجع باسم المحفظة والفرق بالقرش:
   *
   * 1. **رصيد الدفتر = مجموع حركاتها** (المتاح + المحجوز = دائن − مدين، بلا المعكوسة).
   * 2. **حساب الصف**: `balance_after = balance_before ± amount`.
   * 3. **سلسلة متصلة**: `balance_before` لأي حركة = `balance_after` للحركة اللي قبلها على
   *    نفس المحفظة.
   *
   * الثابتة ١ لوحدها مش كفاية: ممكن الرصيد يطلع مظبوط بالصدفة والسلسلة نفسها مكسورة (حركة
   * اتكتبت بأرقام غلط وحركة تانية عوّضتها) — وده بيخلّي كشف حساب الفني كذب رغم إن الإجمالي
   * صح. عشان كده التلاتة مع بعض.
   *
   * مفيش تقريب ولا تسامح: أي فرق بقرش واحد مخالفة.
   */
  async reconciliationCheck(walletId?: string): Promise<ReconciliationReport> {
    // فلتر اختياري بمحفظة واحدة — بيخدم تشخيص الأدمن لفني بعينه، وبيخلّي الفحص قابل
    // للاختبار بمعزل عن أي بيانات تانية في القاعدة.
    const walletFilter = walletId ? 'AND w.id = $1::uuid' : '';
    const txWalletFilter = walletId ? 'AND t.wallet_id = $1::uuid' : '';
    const params = walletId ? [walletId] : [];
    const [counts] = await this.dataSource.query<
      { wallets: string; transactions: string; balance_issues: string; arithmetic_issues: string; chain_issues: string }[]
    >(
      // العدّ الكامل **منفصل عن العيّنة** — الرقم اللي المالك بيشوفه لازم يكون الحقيقي مش
      // مسقّف عند حد العيّنة (بَقّة اتلقطت في اختبار حي: مخالفات محفظة بعينها اختفت من
      // العيّنة وسط مخالفات بيانات اختبار قديمة، فالرقم كان هيقول أقل من الحقيقة).
      `WITH balance_mismatch AS (
         SELECT w.id
           FROM wallets w
           LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
          WHERE w.deleted_at IS NULL ${walletFilter}
          GROUP BY w.id
         HAVING w.balance_cents + w.reserved_balance_cents <> COALESCE(SUM(
                  CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
                ) FILTER (WHERE t.is_reversed = false), 0)
       ), chain AS (
         SELECT o.id
           FROM (
             SELECT t.id, t.wallet_id, t.balance_before_cents,
                    LAG(t.balance_after_cents) OVER (PARTITION BY t.wallet_id ORDER BY t.created_at, t.id) AS previous_after
               FROM wallet_transactions t
              WHERE true ${txWalletFilter}
           ) o
          WHERE o.previous_after IS NOT NULL AND o.balance_before_cents <> o.previous_after
       )
       SELECT (SELECT COUNT(*) FROM wallets WHERE deleted_at IS NULL) AS wallets,
              (SELECT COUNT(*) FROM wallet_transactions) AS transactions,
              (SELECT COUNT(*) FROM balance_mismatch) AS balance_issues,
              (SELECT COUNT(*) FROM wallet_transactions t
                WHERE t.balance_after_cents <> t.balance_before_cents +
                      CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
                      ${txWalletFilter}) AS arithmetic_issues,
              (SELECT COUNT(*) FROM chain) AS chain_issues`,
      params,
    );
    const ledgerIssuesTotal =
      Number(counts?.balance_issues ?? 0) + Number(counts?.arithmetic_issues ?? 0) + Number(counts?.chain_issues ?? 0);

    const balanceIssues = await this.dataSource.query<
      { wallet_id: string; owner_user_id: string; difference: string; expected: string; actual: string }[]
    >(
      `SELECT w.id AS wallet_id,
              w.owner_user_id,
              (w.balance_cents + w.reserved_balance_cents - COALESCE(SUM(
                 CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
               ) FILTER (WHERE t.is_reversed = false), 0)) AS difference,
              COALESCE(SUM(
                 CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
               ) FILTER (WHERE t.is_reversed = false), 0) AS expected,
              w.balance_cents + w.reserved_balance_cents AS actual
         FROM wallets w
         LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
        WHERE w.deleted_at IS NULL ${walletFilter}
        GROUP BY w.id
       HAVING w.balance_cents + w.reserved_balance_cents <> COALESCE(SUM(
                CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
              ) FILTER (WHERE t.is_reversed = false), 0)
        ORDER BY ABS(w.balance_cents + w.reserved_balance_cents - COALESCE(SUM(
                CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
              ) FILTER (WHERE t.is_reversed = false), 0)) DESC
        LIMIT ${ISSUE_SAMPLE_LIMIT}`,
      params,
    );

    const arithmeticIssues = await this.dataSource.query<
      { wallet_id: string; owner_user_id: string; id: string; transaction_number: string; difference: string }[]
    >(
      `SELECT t.wallet_id, w.owner_user_id, t.id, t.transaction_number,
              (t.balance_after_cents - (t.balance_before_cents +
                 CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END)) AS difference
         FROM wallet_transactions t
         JOIN wallets w ON w.id = t.wallet_id
        WHERE t.balance_after_cents <> t.balance_before_cents +
              CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END
              ${txWalletFilter}
        ORDER BY t.created_at DESC
        LIMIT ${ISSUE_SAMPLE_LIMIT}`,
      params,
    );

    const chainIssues = await this.dataSource.query<
      { wallet_id: string; owner_user_id: string; id: string; transaction_number: string; difference: string }[]
    >(
      `WITH ordered AS (
         SELECT t.id, t.wallet_id, t.transaction_number, t.balance_before_cents, t.balance_after_cents,
                LAG(t.balance_after_cents) OVER (PARTITION BY t.wallet_id ORDER BY t.created_at, t.id) AS previous_after
           FROM wallet_transactions t
          WHERE true ${txWalletFilter}
       )
       SELECT o.wallet_id, w.owner_user_id, o.id, o.transaction_number,
              (o.balance_before_cents - o.previous_after) AS difference
         FROM ordered o
         JOIN wallets w ON w.id = o.wallet_id
        WHERE o.previous_after IS NOT NULL AND o.balance_before_cents <> o.previous_after
        LIMIT ${ISSUE_SAMPLE_LIMIT}`,
      params,
    );

    const issues: ReconciliationIssue[] = [
      ...balanceIssues.map((r) => ({
        kind: 'balance_mismatch' as const,
        wallet_id: r.wallet_id,
        owner_user_id: r.owner_user_id,
        difference_cents: Number(r.difference),
        transaction_id: null,
        transaction_number: null,
        detail: `رصيد الدفتر ${r.actual} (المتاح والمحجوز) والمفروض ${r.expected} حسب مجموع حركاتها`,
      })),
      ...arithmeticIssues.map((r) => ({
        kind: 'row_arithmetic' as const,
        wallet_id: r.wallet_id,
        owner_user_id: r.owner_user_id,
        difference_cents: Number(r.difference),
        transaction_id: r.id,
        transaction_number: r.transaction_number,
        detail: 'الرصيد بعد الحركة مش بيساوي الرصيد قبلها ± المبلغ',
      })),
      ...chainIssues.map((r) => ({
        kind: 'chain_break' as const,
        wallet_id: r.wallet_id,
        owner_user_id: r.owner_user_id,
        difference_cents: Number(r.difference),
        transaction_id: r.id,
        transaction_number: r.transaction_number,
        detail: 'الرصيد قبل الحركة مش بيساوي الرصيد بعد الحركة اللي قبلها — السلسلة مكسورة',
      })),
    ];

    // **المخالفات التشغيلية على مستوى النظام كله** (استرداد عالق، دفعة معلّقة، طلب مقفول بلا
    // تسوية) ومالهاش علاقة بمحفظة بعينها. لما الأدمن (أو اختبار) يسأل عن **محفظة واحدة**،
    // ضمّها في `total_issues` بيخلّي `is_balanced` تقول «مش متزنة» بسبب بيانات مالهاش أي علاقة
    // بالفني ده — نفس السطر اللي بيوعد فوق إن الفلتر «بيخلّي الفحص بمعزل عن أي بيانات تانية».
    const operational = walletId ? { total: 0, items: [] as FinancialOperationalIssue[] } : await this.findOperationalIssues();
    const totalIssues = ledgerIssuesTotal + operational.total;

    return {
      checked_wallets: Number(counts?.wallets ?? 0),
      checked_transactions: Number(counts?.transactions ?? 0),
      total_issues: totalIssues,
      issues,
      // التوافق مع عقد endpoint القديم: هذا الحقل يخص عينة دفتر القيود فقط. عينة التشغيل لها
      // حقلها الصريح حتى لا تفسر الواجهة العدد الإجمالي كمجرد truncation للدفتر.
      issues_truncated: ledgerIssuesTotal > issues.length,
      is_balanced: totalIssues === 0,
      ledger_issues_total: ledgerIssuesTotal,
      operational_issues_total: operational.total,
      operational_issues: operational.items,
      operational_issues_truncated: operational.total > operational.items.length,
    };
  }

  /**
   * فحص المسارات المالية المفتوحة التي لا تظهر في دفتر المحفظة. لا يغيّر صفًا واحدًا: الاسترداد
   * أو تصحيح الدفع لا يزالان قرار Finance/Admin موثقًا، خصوصًا للنتيجة غير المؤكدة عند البوابة.
   */
  private async findOperationalIssues(): Promise<{ total: number; items: FinancialOperationalIssue[] }> {
    const readHours = async (key: string, fallback: number) => {
      const value = this.settingsService ? await this.settingsService.getNumber(key, fallback) : fallback;
      return Math.max(1, Math.floor(value));
    };
    const [refundHours, paymentHours] = await Promise.all([
      readHours('payments.stale_refund_hours', 24),
      readHours('payments.stale_payment_hours', 24),
    ]);

    const rows = await this.dataSource.query<
      {
        kind: FinancialOperationalIssueKind;
        order_id: string | null;
        order_number: string | null;
        related_id: string;
        amount_cents: string;
        occurred_at: string;
        total_count: string;
      }[]
    >(
      `WITH operational_issues AS (
         -- الاسترداد PROCESSING بعد نافذة المراجعة: لا نعيد إرساله ولا نحرره آليًا، فقط نظهره
         -- لموظف Finance ليقفل نفس الصف بدليل من المزود.
         SELECT 'stale_refund'::text AS kind, o.id AS order_id, o.order_number,
                r.id AS related_id, r.amount_cents, r.requested_at AS occurred_at
           FROM refunds r
           LEFT JOIN orders o ON o.id = r.order_id
          WHERE r.refund_status = 'processing'
            AND r.requested_at <= now() - make_interval(hours => $1::int)

         UNION ALL

         -- pending/processing/manual_review لا تعني فشلًا. ظهورها هنا مراجعة فقط حتى لا ينشئ
         -- النظام محاولة تحصيل ثانية بينما نتيجة المزود الأصلية قد تكون وصلت متأخرة.
         SELECT 'stale_payment'::text, o.id, o.order_number,
                p.id, p.amount_cents, p.initiated_at
           FROM payments p
           LEFT JOIN orders o ON o.id = p.order_id
          WHERE p.payment_status IN ('pending', 'processing', 'manual_review')
            AND p.initiated_at <= now() - make_interval(hours => $2::int)

         UNION ALL

         -- إلغاء مدفوع: المتبقي بعد الاستردادات المكتملة ورسوم الإلغاء يستحق قرارًا بشريًا.
         -- لا نفترض أن كل إلغاء يستحق كامل المبلغ؛ رسوم الإلغاء الصحيحة تظل مستحقة للمنصة.
         SELECT 'cancelled_paid_missing_refund'::text, o.id, o.order_number,
                o.id,
                GREATEST(0,
                  COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                            WHERE p.order_id = o.id AND p.payment_status = 'succeeded'), 0)
                  - COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                              WHERE r.order_id = o.id AND r.refund_status = 'completed'), 0)
                  - COALESCE(o.cancellation_fee_cents, 0)
                ) AS amount_cents,
                COALESCE(o.cancelled_at, o.updated_at) AS occurred_at
           FROM orders o
          WHERE o.deleted_at IS NULL
            AND o.order_status IN ('cancelled_by_customer', 'cancelled_by_system')
            AND o.payment_status IN ('paid', 'partially_refunded')
            AND COALESCE((SELECT SUM(p.amount_cents) FROM payments p
                          WHERE p.order_id = o.id AND p.payment_status = 'succeeded'), 0)
                > COALESCE((SELECT SUM(r.amount_cents) FROM refunds r
                            WHERE r.order_id = o.id AND r.refund_status = 'completed'), 0)
                  + COALESCE(o.cancellation_fee_cents, 0)

         UNION ALL

         -- completed + unpaid لا يمكن أن يكون نجاح تحصيل سليمًا، بما في ذلك أي مسار كاش نسي
         -- تأكيد التحصيل. لا نصحح الحالة هنا حتى لا نخترع دخلًا بلا دليل.
         SELECT 'completed_unpaid'::text, o.id, o.order_number,
                o.id, o.total_amount_cents, COALESCE(o.work_completed_at, o.updated_at)
           FROM orders o
          WHERE o.deleted_at IS NULL
            AND o.order_status = 'completed'
            AND o.payment_status = 'unpaid'
       )
       SELECT kind, order_id, order_number, related_id, amount_cents, occurred_at,
              COUNT(*) OVER() AS total_count
       FROM operational_issues
       ORDER BY occurred_at ASC, related_id
       LIMIT $3`,
      [refundHours, paymentHours, ISSUE_SAMPLE_LIMIT],
    );

    const detail: Record<FinancialOperationalIssueKind, string> = {
      stale_refund: 'استرداد عند البوابة متوقف للمراجعة؛ راجع المزود ثم اقفل نفس الاسترداد بدليل، ولا تنشئ استردادًا جديدًا.',
      stale_payment: 'دفعة نتيجتها غير محسومة أو متوقفة؛ راجع المزود أو التحويل اليدوي قبل أي محاولة تحصيل أخرى.',
      cancelled_paid_missing_refund: 'طلب ملغي ما زال به مبلغ مدفوع متبقٍ بعد رسوم الإلغاء والاستردادات المكتملة؛ يحتاج قرار Finance يدوي.',
      completed_unpaid: 'طلب مكتمل بلا تحصيل مسجل؛ راجع الكاش أو بوابة الدفع قبل اعتماد أي مستحقات أو إيراد.',
    };
    return {
      total: rows.length > 0 ? Number(rows[0].total_count) : 0,
      items: rows.map((row) => ({
        kind: row.kind,
        order_id: row.order_id,
        order_number: row.order_number,
        related_id: row.related_id,
        amount_cents: Number(row.amount_cents),
        occurred_at: new Date(row.occurred_at).toISOString(),
        detail: detail[row.kind],
      })),
    };
  }
}
