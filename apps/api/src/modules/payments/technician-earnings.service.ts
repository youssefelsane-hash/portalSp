import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../common/exceptions/api.exception';

/** أقصى عدد شهور سابقة يرجّعها `listAvailableMonths` — سنتين كفاية لأي مراجعة عملية. */
const MAX_HISTORY_MONTHS = 24;

/**
 * سطر شغلانة واحدة في كشف الشهر. كل الأرقام قروش.
 *
 * الحقول مصمّمة عشان الفني يفهم الرقم **من غير ما حد يشرحله** (طلب مالك صريح): بيشوف السعر
 * الأصلي، خصم العميل، اللي العميل دفعه، ومستحقه — ويشوف صراحةً إن الخصم ما اتحمّلش عليه.
 */
export interface TechnicianStatementJob {
  orderId: string;
  orderNumber: string;
  serviceNameAr: string | null;
  closedAt: string;
  /** سعر الخدمة قبل أي خصم — الأساس اللي مستحق الفني بيتحسب منه (ADR-0038). */
  originalPriceCents: number;
  /** الزيادات المعتمدة أثناء الشغل (بنود إضافية) — جزء من الشغل، فجزء من مستحقه. */
  additionalWorkCents: number;
  /** فرق مستوى الفني (§60.3) — بيزوّد مستحقه هو. */
  levelPremiumCents: number;
  /** دور الفني في الشغلانة دي (§90.1) — قائد أو عضو فريق أو مساعد. طلب فردي = قائد دايمًا. */
  participantRole: 'leader' | 'team_member' | 'assistant';
  /**
   * لو الطلب اتسترد (كليًا أو جزئيًا)، الجزء اللي اتخصم فعليًا من محفظة الفني رجوعًا للمنصة
   * من قيود `wallet_transactions` نفسها. بيبان صراحةً عشان الكشف يطابق المحفظة تمامًا، سواء كان
   * الفني قائدًا أو عضو فريق أو مساعدًا.
   */
  refundReversalCents: number;
  /** نصيب الفني قبل مقاصة الكاش والاستردادات. */
  grossTechnicianEarningCents: number;
  /** الكاش الموجود فعليًا مع قائد الطلب؛ أعضاء الطاقم لا يستلمونه نيابة عنه. */
  cashCollectedCents: number;
  /** خصم العميل (كوبون/عمارة/حملة). */
  customerDiscountCents: number;
  /** اللي العميل دفعه فعلاً بعد الخصم. */
  customerPaidCents: number;
  /** الوعاء اللي العمولة اتطبّقت عليه. */
  commissionableBaseCents: number;
  commissionRatePercentage: number;
  platformCommissionCents: number;
  /** **دايمًا صفر** (ADR-0038) — بيتعرض صراحةً عشان يبقى واضح مين دفع الخصم. */
  discountBorneByTechnicianCents: number;
  /** صافي مستحق الفني عن الشغلانة دي. */
  netTechnicianDueCents: number;
}

export interface TechnicianMonthlyStatement {
  /** `YYYY-MM` بتوقيت القاهرة. */
  month: string;
  monthStart: string;
  monthEnd: string;
  /** true للشهر اللي إحنا فيه — يعني الرقم "حتى هذه اللحظة" ولسه ممكن يزيد. */
  isCurrentMonth: boolean;
  jobsCount: number;
  totals: {
    originalPriceCents: number;
    additionalWorkCents: number;
    levelPremiumCents: number;
    customerDiscountCents: number;
    customerPaidCents: number;
    platformCommissionCents: number;
    discountBorneByTechnicianCents: number;
    /** إجمالي اللي اتعكس من محفظة الفني بسبب استردادات مكتملة (§90.1). */
    refundReversalCents: number;
    grossTechnicianEarningCents: number;
    cashCollectedCents: number;
    /** **إجمالي مستحقات الفني للشهر** — نفس اللي بينزل محفظته بالظبط (بعد عكس الاسترداد). */
    netTechnicianDueCents: number;
  };
  jobs: TechnicianStatementJob[];
}

/**
 * مطابقة رصيد المحفظة مع كشف الشهر (docs/08 §95، طلب مالك مباشر).
 *
 * **المشكلة اللي بيحلها**: الأدمن بيشوف رقمين أحمر جنب بعض في صفحة الفني —
 * "المديونية الحالية" و"مديونية الفني للمنصة من شغل الشهر" — وبيفترض إنهم لازم يتطابقوا، وهما
 * أصلاً **بيقيسوا حاجتين مختلفتين**:
 *
 * - **المديونية الحالية** = `wallets.balance_cents` — رصيد دفتر الحسابات **كل الزمن**: كل الشهور،
 *   والسدادات، والصرف (payouts)، والتسويات اليدوية، والمكافآت... إلخ.
 * - **مديونية شغل الشهر** = صافي شغل الشهر المحدد **بس** (طلبات اتقفلت في الشهر ده).
 *
 * فاختلافهم **طبيعي ومتوقع** في أي وقت فيه أي حركة برّه شغل الشهر ده. المشكلة الحقيقية كانت إن
 * الواجهة مكانتش بتقول ده، فالفرق كان بيبان كأنه خطأ حسابي.
 *
 * الدالة دي بتقفل الموضوع نهائيًا: بتفكّك الفرق لمصادره الحقيقية من دفتر الحسابات نفسه، فأي فرق
 * بيبقى **مفسَّر بالكامل** مش لغز. ولو الفرق ما اتفسرش (`monthMatchesLedger === false`) يبقى ده
 * خلل حقيقي محتاج مراجعة — وبيبان صراحةً بدل ما يفضل مستخبي.
 */
export interface TechnicianBalanceReconciliation {
  month: string;
  /** صافي شغل الشهر حسب الكشف. */
  monthNetCents: number;
  /** اللي اتحرك فعلاً في المحفظة بسبب طلبات الشهر ده. */
  monthLedgerCents: number;
  /** رصيد المحفظة الحالي (كل الزمن) — سالب = مديونية على الفني. */
  currentBalanceCents: number;
  /** الفرق الجاي من برّه شغل الشهر ده. */
  outsideMonthCents: number;
  outsideMonthBreakdown: { transactionType: string; labelAr: string; amountCents: number }[];
  /** لو false: الكشف والدفتر مش متطابقين لنفس الشهر — خلل حقيقي محتاج مراجعة. */
  monthMatchesLedger: boolean;
}

/** أسماء عربية لأنواع حركة المحفظة — عشان الأدمن يفهم مصدر الفرق من غير ما يفتح الداتابيز. */
const WALLET_TX_LABELS_AR: Record<string, string> = {
  order_earning: 'أرباح طلبات (من شهور تانية)',
  commission_deduction: 'عمولة كاش (من شهور تانية)',
  adjustment: 'تسويات وسدادات مديونية',
  topup: 'شحن رصيد',
  withdrawal: 'سحب رصيد',
  refund: 'استرداد',
  penalty: 'غرامات',
  bonus: 'مكافآت',
  referral_reward: 'مكافآت دعوة',
  installment_collection: 'تحصيل أقساط',
};

/**
 * كشف مستحقات الفني الشهري (ADR-0038، docs/08 §61.1).
 *
 * **read model خالص** — صفر جداول جديدة، صفر كتابة، صفر مهمة شهرية. كل البيانات موجودة أصلاً
 * كـsnapshot على الطلب من ساعة التسوية، فجدول تجميع شهري كان هيبقى نسخة تانية من نفس الحقيقة
 * (وعرضة لعدم الاتساق لو طلب اتعدّل بأثر رجعي).
 *
 * **الشهر "بيقفل" بحدود التاريخ مش بحالة**: مفيش عمود `is_closed` ولا إجراء إقفال — الشهر
 * السابق مقفول لأن مفيش طلبات جديدة ممكن `closed_at` بتاعها يقع فيه.
 */
@Injectable()
export class TechnicianEarningsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** `YYYY-MM` بتوقيت القاهرة. بيرمي على أي شكل تاني بدل ما يبني SQL بقيمة مش متحقّق منها. */
  private parseMonth(month: string): { year: number; monthNumber: number } {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) {
      throw new ApiException(ErrorCode.VAL_001, 'صيغة الشهر لازم تكون YYYY-MM', HttpStatus.BAD_REQUEST);
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) {
      throw new ApiException(ErrorCode.VAL_001, 'رقم الشهر لازم يكون بين 01 و12', HttpStatus.BAD_REQUEST);
    }
    return { year, monthNumber };
  }

  /** الشهر الحالي بتوقيت القاهرة — مش UTC. طلب اتقفل 1 صباحًا يوم 1 لازم يقع في الشهر الجديد. */
  static currentMonthCairo(now: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(now);
    const year = parts.find((p) => p.type === 'year')!.value;
    const month = parts.find((p) => p.type === 'month')!.value;
    return `${year}-${month}`;
  }

  /**
   * الشهور اللي فيها شغل مقفول فعلاً للفني ده، من الأحدث للأقدم. الشهر الحالي بيتحط دايمًا
   * حتى لو لسه فاضي — الفني لازم يشوف "الشهر ده: صفر" مش قايمة فاضية تخليه يفتكر إن فيه عطل.
   */
  async listAvailableMonths(technicianProfileId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ month: string }[]>(
      `SELECT DISTINCT to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') AS month
       FROM orders o
       WHERE (
           EXISTS (
             SELECT 1 FROM order_earning_shares oes
             WHERE oes.order_id = o.id AND oes.technician_id = $1 AND oes.deleted_at IS NULL
           )
           OR (
             o.technician_id = $1 AND NOT EXISTS (
               SELECT 1 FROM order_earning_shares any_share
               WHERE any_share.order_id = o.id AND any_share.deleted_at IS NULL
             )
           )
         )
         AND o.closed_at IS NOT NULL AND o.deleted_at IS NULL
       ORDER BY month DESC
       LIMIT $2`,
      [technicianProfileId, MAX_HISTORY_MONTHS],
    );
    const months = rows.map((r) => r.month);
    const current = TechnicianEarningsService.currentMonthCairo();
    return months.includes(current) ? months : [current, ...months];
  }

  async getMonthlyStatement(technicianProfileId: string, month: string): Promise<TechnicianMonthlyStatement> {
    this.parseMonth(month);
    const currentMonth = TechnicianEarningsService.currentMonthCairo();

    // ملحوظة على الحدود: بنقارن على `to_char(...)` بدل BETWEEN بتاريخين عشان نتجنّب أخطاء
    // الحدود عند آخر يوم في الشهر ووقت تغيير التوقيت الصيفي. الفهرس على technician_id بيقلّل
    // الصفوف المفحوصة لطلبات الفني ده بس، فالتحويل النصي مش على الجدول كله.
    //
    // §90.1 (طلب مالك — تطابق "مستحقاتي" مع "محفظتي"): قبل كده الاستعلام كان بيفلتر على
    // `o.technician_id = $1` بس، يعني عضو الطاقم (مش القائد) ما كانش بيشوف شغلانات اشتغل فيها
    // خالص، والقائد كان بيشوف وعاء الطاقم كله كأنه نصيبه هو — بينما اللي بينزل محفظة كل واحد فعلاً
    // هو حصته من `order_earning_shares` (نفس الجدول اللي `settleAndComplete()` بيكتب منه حركات
    // المحفظة، `payments.service.ts:640-697`). `LEFT JOIN` بدل `INNER` عمدًا: طلبات اتقفلت قبل
    // ADR-0040 (أو تستات بتدخل صف `orders` مباشرة بلا `order_earning_shares`) معندهاش صف حصة
    // خالص — بيترجعوا لافتراض "قائد فردي" زي السلوك القديم (`o.technician_id = $1`).
    const jobs = await this.dataSource.query<
      {
        order_id: string;
        order_number: string;
        service_name_ar: string | null;
        closed_at: Date;
        total_amount_cents: number;
        discount_amount_cents: number;
        level_premium_cents: number;
        commissionable_base_cents: number | null;
        commission_rate_applied: string | null;
        platform_commission_cents: number;
        technician_earning_cents: number;
        participant_role: 'leader' | 'team_member' | 'assistant';
        my_share_cents: number;
        refund_reversal_cents: string;
        total_refunded_cents: string;
        cash_collected_cents: string;
        additional_work_cents: string;
      }[]
    >(
      `SELECT o.id AS order_id, o.order_number, s.name_ar AS service_name_ar, o.closed_at,
              o.total_amount_cents, o.discount_amount_cents, o.level_premium_cents,
              o.commissionable_base_cents, o.commission_rate_applied,
              o.platform_commission_cents, o.technician_earning_cents,
              COALESCE(oes.participant_role, 'leader') AS participant_role,
              COALESCE(oes.share_cents, CASE WHEN o.technician_id = $1 THEN o.technician_earning_cents ELSE 0 END) AS my_share_cents,
              COALESCE((
                SELECT SUM(wt.amount_cents)
                FROM refunds r
                JOIN wallet_transactions wt
                  ON wt.reference_type = 'refund' AND wt.reference_id = r.id
                 AND wt.transaction_type = 'refund' AND wt.direction = 'debit'
                JOIN wallets refund_wallet ON refund_wallet.id = wt.wallet_id
                JOIN technician_profiles refund_tech ON refund_tech.user_id = refund_wallet.owner_user_id
                WHERE r.order_id = o.id AND r.refund_status = 'completed' AND refund_tech.id = $1
              ), 0)::text AS refund_reversal_cents,
              COALESCE((
                SELECT SUM(r.amount_cents) FROM refunds r
                WHERE r.order_id = o.id AND r.refund_status = 'completed'
              ), 0)::text AS total_refunded_cents,
              CASE WHEN COALESCE(oes.participant_role, 'leader') = 'leader' THEN COALESCE((
                SELECT SUM(p.amount_cents) FROM payments p
                WHERE p.order_id = o.id AND p.payment_method = 'cash'
                  AND p.payment_status IN ('succeeded','partially_refunded','refunded')
              ), 0) ELSE 0 END::text AS cash_collected_cents,
              COALESCE((
                SELECT SUM(oi.total_price_cents) FROM order_items oi
                WHERE oi.order_id = o.id
                  AND oi.item_type IN ('spare_part','extra_labor')
                  AND oi.is_customer_approved = true
              ), 0)::text AS additional_work_cents
       FROM orders o
       LEFT JOIN order_earning_shares oes
         ON oes.order_id = o.id AND oes.technician_id = $1 AND oes.deleted_at IS NULL
       LEFT JOIN services s ON s.id = o.service_id
       WHERE (oes.technician_id = $1 OR (oes.id IS NULL AND o.technician_id = $1))
         AND o.closed_at IS NOT NULL
         AND o.deleted_at IS NULL
         AND to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') = $2
       ORDER BY o.closed_at ASC`,
      [technicianProfileId, month],
    );

    const mapped: TechnicianStatementJob[] = jobs.map((row) => {
      const customerPaidCents = Number(row.total_amount_cents);
      const customerDiscountCents = Number(row.discount_amount_cents);
      const additionalWorkCents = Number(row.additional_work_cents);
      const levelPremiumCents = Number(row.level_premium_cents);
      const myShareCents = Number(row.my_share_cents);
      const actualRefundReversalCents = Number(row.refund_reversal_cents);
      const totalRefundedCents = Number(row.total_refunded_cents);
      const cashCollectedCents = Number(row.cash_collected_cents);
      const totalAmountCents = Number(row.total_amount_cents);
      // الطلبات القديمة وبعض fixtures سبقت ربط عكس الاسترداد بقيود كل فرد. نفضّل دفتر
      // المحفظة دائمًا؛ ولو مفيش قيد تاريخي خالص، نستخدم معادلة القائد القديمة فقط حتى لا يختفي
      // دين معروف من كشف قديم. أعضاء الطاقم لا يُخترع لهم خصم بلا قيد فعلي.
      const refundReversalCents =
        actualRefundReversalCents > 0
          ? actualRefundReversalCents
          : row.participant_role === 'leader' && totalRefundedCents > 0 && totalAmountCents > 0
            ? Math.round((Number(row.technician_earning_cents) * totalRefundedCents) / totalAmountCents)
            : 0;
      return {
        orderId: row.order_id,
        orderNumber: row.order_number,
        serviceNameAr: row.service_name_ar,
        closedAt: row.closed_at.toISOString(),
        // السعر الأصلي = اللي العميل دفعه + الخصم اللي المنصة تحمّلته.
        originalPriceCents: customerPaidCents + customerDiscountCents,
        additionalWorkCents,
        levelPremiumCents,
        participantRole: row.participant_role,
        refundReversalCents,
        grossTechnicianEarningCents: myShareCents,
        cashCollectedCents,
        customerDiscountCents,
        customerPaidCents,
        commissionableBaseCents: Number(row.commissionable_base_cents ?? customerPaidCents),
        commissionRatePercentage: Number(row.commission_rate_applied ?? 0),
        platformCommissionCents: Number(row.platform_commission_cents),
        // ADR-0038 — دايمًا صفر. بيتعرض صراحةً مش بيتشال، عشان الفني يشوف بعينه إن الكوبون
        // ما اتخصمش منه.
        discountBorneByTechnicianCents: 0,
        // نفس المقاصة في settleAndComplete(): نصيب القائد ناقص الكاش الموجود في يده. بذلك
        // يكون الرقم هو أثر الطلب على المحفظة فعلًا (وقد يكون سالبًا = مديونية للمنصة).
        netTechnicianDueCents: myShareCents - cashCollectedCents - refundReversalCents,
      };
    });

    const sum = (pick: (job: TechnicianStatementJob) => number) => mapped.reduce((acc, job) => acc + pick(job), 0);

    return {
      month,
      monthStart: `${month}-01`,
      monthEnd: this.lastDayOf(month),
      isCurrentMonth: month === currentMonth,
      jobsCount: mapped.length,
      totals: {
        originalPriceCents: sum((j) => j.originalPriceCents),
        additionalWorkCents: sum((j) => j.additionalWorkCents),
        levelPremiumCents: sum((j) => j.levelPremiumCents),
        customerDiscountCents: sum((j) => j.customerDiscountCents),
        customerPaidCents: sum((j) => j.customerPaidCents),
        platformCommissionCents: sum((j) => j.platformCommissionCents),
        discountBorneByTechnicianCents: 0,
        refundReversalCents: sum((j) => j.refundReversalCents),
        grossTechnicianEarningCents: sum((j) => j.grossTechnicianEarningCents),
        cashCollectedCents: sum((j) => j.cashCollectedCents),
        netTechnicianDueCents: sum((j) => j.netTechnicianDueCents),
      },
      jobs: mapped,
    };
  }

  /**
   * بتفكّك الفرق بين رصيد المحفظة (كل الزمن) وصافي شغل شهر معيّن (docs/08 §95).
   *
   * كله بيتقرا من **دفتر الحسابات نفسه** (`wallet_transactions`، دفتر غير قابل للتعديل بقيد
   * مزدوج) — مفيش أي رقم بيتحسب من مكان تاني، فالمطابقة دايمًا صادقة.
   */
  async getBalanceReconciliation(technicianProfileId: string, month: string): Promise<TechnicianBalanceReconciliation> {
    this.parseMonth(month);
    const statement = await this.getMonthlyStatement(technicianProfileId, month);

    const [totals] = await this.dataSource.query<
      { current_balance_cents: string | null; month_ledger_cents: string | null }[]
    >(
      `WITH tech AS (
         SELECT tp.id AS technician_id, tp.user_id FROM technician_profiles tp WHERE tp.id = $1
       ),
       w AS (
         SELECT wl.id, wl.balance_cents FROM wallets wl
         JOIN tech ON tech.user_id = wl.owner_user_id
         WHERE wl.owner_type = 'technician'
       ),
       month_orders AS (
         SELECT o.id FROM orders o
         LEFT JOIN order_earning_shares oes
           ON oes.order_id = o.id AND oes.technician_id = (SELECT technician_id FROM tech) AND oes.deleted_at IS NULL
         WHERE (oes.technician_id IS NOT NULL OR (oes.id IS NULL AND o.technician_id = (SELECT technician_id FROM tech)))
           AND o.closed_at IS NOT NULL AND o.deleted_at IS NULL
           AND to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') = $2
       ),
       month_refunds AS (
         SELECT r.id FROM refunds r
         JOIN month_orders mo ON mo.id = r.order_id
         WHERE r.refund_status = 'completed'
       )
       SELECT
         (SELECT balance_cents FROM w)::text AS current_balance_cents,
         COALESCE((
           SELECT SUM(CASE WHEN wt.direction = 'credit' THEN wt.amount_cents ELSE -wt.amount_cents END)
           FROM wallet_transactions wt
           WHERE wt.wallet_id = (SELECT id FROM w)
             AND (
               (wt.reference_type = 'order' AND wt.reference_id IN (SELECT id FROM month_orders))
               OR
               (wt.reference_type = 'refund' AND wt.reference_id IN (SELECT id FROM month_refunds))
             )
         ), 0)::text AS month_ledger_cents`,
      [technicianProfileId, month],
    );

    const breakdownRows = await this.dataSource.query<{ transaction_type: string; amount_cents: string }[]>(
      `WITH tech AS (
         SELECT tp.id AS technician_id, tp.user_id FROM technician_profiles tp WHERE tp.id = $1
       ),
       w AS (
         SELECT wl.id FROM wallets wl JOIN tech ON tech.user_id = wl.owner_user_id
         WHERE wl.owner_type = 'technician'
       ),
       month_orders AS (
         SELECT o.id FROM orders o
         LEFT JOIN order_earning_shares oes
           ON oes.order_id = o.id AND oes.technician_id = (SELECT technician_id FROM tech) AND oes.deleted_at IS NULL
         WHERE (oes.technician_id IS NOT NULL OR (oes.id IS NULL AND o.technician_id = (SELECT technician_id FROM tech)))
           AND o.closed_at IS NOT NULL AND o.deleted_at IS NULL
           AND to_char((o.closed_at AT TIME ZONE 'Africa/Cairo'), 'YYYY-MM') = $2
       ),
       month_refunds AS (
         SELECT r.id FROM refunds r
         JOIN month_orders mo ON mo.id = r.order_id
         WHERE r.refund_status = 'completed'
       )
       SELECT wt.transaction_type,
              SUM(CASE WHEN wt.direction = 'credit' THEN wt.amount_cents ELSE -wt.amount_cents END)::text AS amount_cents
       FROM wallet_transactions wt
       WHERE wt.wallet_id = (SELECT id FROM w)
         -- IS NOT TRUE مش NOT (...): أغلب الحركات اللي بندوّر عليها هنا (تسوية، سداد مديونية،
         -- مكافأة) عمود reference_type بتاعها NULL، و NOT (NULL = 'order' AND ...) بيتقيّم لـNULL
         -- في SQL فالصف بيتشال من النتيجة بصمت. البَقّة دي اتلقطت باختبار حي.
         AND (
           (wt.reference_type = 'order' AND wt.reference_id IN (SELECT id FROM month_orders))
           OR
           (wt.reference_type = 'refund' AND wt.reference_id IN (SELECT id FROM month_refunds))
         ) IS NOT TRUE
       GROUP BY wt.transaction_type
       HAVING SUM(CASE WHEN wt.direction = 'credit' THEN wt.amount_cents ELSE -wt.amount_cents END) <> 0
       ORDER BY 2 DESC`,
      [technicianProfileId, month],
    );

    const currentBalanceCents = Number(totals?.current_balance_cents ?? 0);
    const monthLedgerCents = Number(totals?.month_ledger_cents ?? 0);

    return {
      month,
      monthNetCents: statement.totals.netTechnicianDueCents,
      monthLedgerCents,
      currentBalanceCents,
      outsideMonthCents: currentBalanceCents - monthLedgerCents,
      outsideMonthBreakdown: breakdownRows.map((row) => ({
        transactionType: row.transaction_type,
        labelAr: WALLET_TX_LABELS_AR[row.transaction_type] ?? row.transaction_type,
        amountCents: Number(row.amount_cents),
      })),
      // الكشف بيحسب صافي الشهر من snapshot الطلبات، والدفتر بيحسبه من حركات المحفظة الفعلية.
      // لو الاتنين مختلفين يبقى فيه خلل حقيقي (تسوية ناقصة أو حركة يدوية على طلب) — بيتعرض صراحةً.
      monthMatchesLedger: statement.totals.netTechnicianDueCents === monthLedgerCents,
    };
  }

  private lastDayOf(month: string): string {
    const { year, monthNumber } = this.parseMonth(month);
    // اليوم صفر من الشهر اللي بعده = آخر يوم في الشهر ده (بيتعامل مع فبراير والسنة الكبيسة صح).
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(lastDay).padStart(2, '0')}`;
  }
}
