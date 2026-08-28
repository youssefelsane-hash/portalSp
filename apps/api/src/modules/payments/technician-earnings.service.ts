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
   * (نفس معادلة `refundOrder()` بالحرف — `payments.service.ts`) — بيبان صراحةً هنا عشان الكشف
   * يطابق المحفظة تمامًا، مش يفاجئ الفني برقم مختلف. **بيتطبّق على القائد بس** لأن الاسترداد
   * الفعلي بيتعكس من محفظة القائد وحده (نفس سلوك المحفظة الحقيقي، مش قرار جديد هنا).
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
      const totalRefundedCents = Number(row.total_refunded_cents);
      const cashCollectedCents = Number(row.cash_collected_cents);
      const totalAmountCents = Number(row.total_amount_cents);
      const technicianEarningCents = Number(row.technician_earning_cents);
      // نفس معادلة `refundOrder()` بالحرف (`payments.service.ts:2578-2580`) — بتتطبّق بس لو
      // القائد، لأن ده اللي فعليًا بيتعكس من محفظته وقت الاسترداد. عضو الطاقم محفظته ما بتتلمسش.
      const refundReversalCents =
        row.participant_role === 'leader' && totalRefundedCents > 0 && totalAmountCents > 0
          ? Math.round((technicianEarningCents * totalRefundedCents) / totalAmountCents)
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

  private lastDayOf(month: string): string {
    const { year, monthNumber } = this.parseMonth(month);
    // اليوم صفر من الشهر اللي بعده = آخر يوم في الشهر ده (بيتعامل مع فبراير والسنة الكبيسة صح).
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${month}-${String(lastDay).padStart(2, '0')}`;
  }
}
