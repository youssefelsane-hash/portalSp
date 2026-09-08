import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DEFAULT_DEBT_POLICY } from '../payments/technician-debt-status';
import { SettingsService } from '../settings/settings.service';
import { DAILY_CAPACITY_MINUTES_FALLBACK } from '../technicians/technician-day-capacity.sql';
import {
  ACTIVE_ORDER_STATUSES,
  ASSIGNED_ORDER_STATUSES,
  orderWorkedMinutesSql,
  SETTLED_PAYMENT_STATUSES,
} from './metric-definitions';

/** ترتيب كشف الفنيين. القايمة مقفولة عمدًا — أي نص من الكولر بيتحوّل لعمود SQL. */
export type WorkforceSort = 'completed' | 'earnings' | 'utilization' | 'rating' | 'idle' | 'debt';

export interface TechnicianScorecard {
  technician_id: string;
  technician_code: string;
  display_name: string;
  level: string;
  kind: string;
  verification_status: string;
  company_id: string | null;
  company_name: string | null;

  completed_orders: number;
  cancelled_by_technician: number;
  worked_minutes: number;
  /** دقايق القدرة المتاحة في الفترة — الأساس اللي الاستغلال اتقسم عليه، ظاهر عشان الرقم يبقى مقروء. */
  capacity_minutes: number;
  utilization_percent: number | null;

  assignments_sent: number;
  assignments_accepted: number;
  acceptance_rate: number | null;
  median_response_seconds: number | null;

  on_time_rate: number | null;
  on_time_sample: number;
  complaints_count: number;
  rework_count: number;

  average_rating: number | null;
  ratings_count: number;

  net_earnings_cents: number;
  wallet_balance_cents: number;
  debt_cents: number;

  last_activity_at: string | null;
}

export interface WorkforceSupplySnapshot {
  from: string;
  to: string;
  company_id: string | null;

  headcount: {
    approved: number;
    in_pipeline: number;
    suspended: number;
    approved_technicians: number;
    approved_assistants: number;
    new_joiners: number;
  };
  by_level: { level: string; count: number }[];

  active_in_period: number;
  /**
   * معتمدين وماخدوش أي شغل في الفترة — طاقة موجودة وواقفة. متمّم لـ`active_in_period` بنفس
   * تعريف النشاط بالظبط، فمجموعهم = `headcount.approved` دايمًا.
   */
  idle_approved: number;
  churned: number;

  /** كل أرقام الطاقة والنشاط دي **للمعتمدين بس** — نفس مجموعة المقام والبسط. */
  capacity_minutes: number;
  booked_minutes: number;
  utilization_percent: number | null;

  debt: {
    technicians_in_debt: number;
    total_debt_cents: number;
    above_threshold: number;
    threshold_cents: number;
  };
}

export interface AreaCoverageRow {
  area_id: string;
  area_name_ar: string;
  city_name_ar: string;
  orders_placed: number;
  orders_matched: number;
  orders_unmatched: number;
  match_rate: number | null;
  technicians_home_based: number;
  /** طلبات في الفترة لكل فني ساكن في المنطقة — `null` لو مفيش أي فني (وده بالظبط اللي بيهم). */
  orders_per_technician: number | null;
}

export interface AreaCoverageReport {
  from: string;
  to: string;
  areas: AreaCoverageRow[];
  /** مناطق فيها طلب حقيقي وصفر فنيين — أول مكان تتوظّف فيه. */
  uncovered_with_demand: AreaCoverageRow[];
}

const MS_PER_DAY = 24 * 3600 * 1000;

/**
 * إحصائيات القوى العاملة (ADR-0081، إحصائيات-٤).
 *
 * نفس قاعدة كل الموديول: **كل رقم بيتحسب من الجداول التشغيلية وقت الطلب**، ولا واحد منهم
 * بيتقرا من العدّادات المخزّنة على `technician_profiles` (`completed_orders_count`،
 * `acceptance_rate`، `on_time_rate`…). السبب مباشر: تلات بَقّات موثّقة في المشروع كانت
 * بالظبط عدّادات على الجدول ده اتجمّدت على أصفار لما مسار جديد نسي يزوّدها (مهام ٢٠/٢١/٢٢).
 * اللوحة اللي بتقيس أداء الناس ماينفعش تبني على المصدر ده.
 *
 * **المشاركة = قيادة أو طاقم.** الفني اللي دخل الشغلانة كعضو طاقم شغّال فعلاً؛ قراءة
 * `orders.technician_id` لوحدها كانت هتخلّي كل المساعدين بصفر شغل — نفس التوحيد اللي
 * `technician-day-capacity.sql.ts` عامله للجدولة.
 */
@Injectable()
export class WorkforceAnalyticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /**
   * المشاركة الموحّدة (قائد ∪ عضو طاقم) كـCTE. `UNION` مش `UNION ALL` عن قصد: الفني اللي هو
   * قائد الطلب **و** مسجّل في `order_team_members` لنفس الطلب لازم يتعدّ مرة واحدة، وإلا شغله
   * بيتحسب مرتين في كل رقم تحت.
   */
  private participationCte(): string {
    return `participation AS (
      SELECT o.id AS order_id, o.technician_id
        FROM orders o
       WHERE o.deleted_at IS NULL AND o.technician_id IS NOT NULL
      UNION
      SELECT o.id AS order_id, otm.technician_id
        FROM orders o
        JOIN order_team_members otm ON otm.order_id = o.id
       WHERE o.deleted_at IS NULL
    )`;
  }

  private async dailyCapacityMinutes(): Promise<number> {
    return this.settings.getNumber('matching.daily_capacity_minutes', DAILY_CAPACITY_MINUTES_FALLBACK);
  }

  private periodDays(from: Date, to: Date): number {
    return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY));
  }

  /**
   * لقطة العرض ككل: كام حد عندنا، على أي مستوى، مشغولين قد إيه، وكام واحد فيهم مديون.
   *
   * `companyId` بيقصر اللقطة على شركة واحدة — نفس الخدمة بتخدم لوحة الأدمن (كل حاجة) ولوحة
   * مالك الشركة (شركته بس) من غير نسخة تانية من نفس الحسابات.
   */
  async supplySnapshot(from: Date, to: Date, companyId: string | null = null): Promise<WorkforceSupplySnapshot> {
    const capacityPerDay = await this.dailyCapacityMinutes();
    const debtThreshold = await this.settings.getNumber(
      'technician_debt.alert_threshold_cents',
      DEFAULT_DEBT_POLICY.alertThresholdCents,
    );
    const days = this.periodDays(from, to);

    const [head] = await this.dataSource.query<
      {
        approved: string;
        in_pipeline: string;
        suspended: string;
        approved_technicians: string;
        approved_assistants: string;
        new_joiners: string;
      }[]
    >(
      `SELECT
         COUNT(*) FILTER (WHERE verification_status = 'approved') AS approved,
         COUNT(*) FILTER (WHERE verification_status NOT IN ('approved', 'rejected', 'suspended')) AS in_pipeline,
         COUNT(*) FILTER (WHERE verification_status = 'suspended') AS suspended,
         COUNT(*) FILTER (WHERE verification_status = 'approved' AND technician_kind = 'technician') AS approved_technicians,
         COUNT(*) FILTER (WHERE verification_status = 'approved' AND technician_kind = 'assistant') AS approved_assistants,
         COUNT(*) FILTER (WHERE approved_at >= $1 AND approved_at < $2) AS new_joiners
       FROM technician_profiles
       WHERE deleted_at IS NULL AND ($3::uuid IS NULL OR company_id = $3::uuid)`,
      [from, to, companyId],
    );

    const levels = await this.dataSource.query<{ level: string; count: string }[]>(
      `SELECT current_level::text AS level, COUNT(*) AS count
         FROM technician_profiles
        WHERE deleted_at IS NULL AND verification_status = 'approved'
          AND ($1::uuid IS NULL OR company_id = $1::uuid)
        GROUP BY current_level
        ORDER BY COUNT(*) DESC`,
      [companyId],
    );

    const [activity] = await this.dataSource.query<
      { booked_minutes: string; active_in_period: string; churned: string }[]
    >(
      `WITH ${this.participationCte()},
       -- **المعتمدون بس.** القدرة في المقام بتتحسب على المعتمدين، فلو البسط (الدقايق
       -- المحجوزة والنشطين) شمل غير المعتمدين كمان، الاستغلال بيطلع أعلى من الحقيقة
       -- و«نشط + واقف» ماكانش بيساوي عدد المعتمدين. اتلقط بصريًا: ١٠ + ١٨٥ ≠ ١٩١.
       scoped AS (
         SELECT tp.id FROM technician_profiles tp
          WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved'
            AND ($4::uuid IS NULL OR tp.company_id = $4::uuid)
       ),
       -- الشغل اللي **اتحجز فعلاً** في الفترة: أي طلب حالته بتثبت إن فيه فني ملتزم بيه.
       -- الأساس الزمني هنا placed_at لأن السؤال «الطاقة اتحجزت امتى» مش «الشغل خلص امتى».
       booked AS (
         SELECT p.technician_id, ${orderWorkedMinutesSql('o')} AS minutes, o.placed_at
           FROM participation p
           JOIN orders o ON o.id = p.order_id
           JOIN scoped s ON s.id = p.technician_id
          WHERE o.order_status = ANY($3::order_status[])
            AND o.placed_at >= $1 AND o.placed_at < $2
       )
       SELECT
         COALESCE((SELECT SUM(minutes) FROM booked), 0) AS booked_minutes,
         (SELECT COUNT(DISTINCT technician_id) FROM booked) AS active_in_period,
         -- التسرّب: كان بيشتغل في الفترة اللي قبل دي بنفس طولها، ووقف خالص في الحالية.
         (SELECT COUNT(*) FROM (
            SELECT p.technician_id
              FROM participation p
              JOIN orders o ON o.id = p.order_id
              JOIN scoped s ON s.id = p.technician_id
             WHERE o.placed_at >= $1 - ($2 - $1) AND o.placed_at < $1
             GROUP BY p.technician_id
            EXCEPT
            SELECT technician_id FROM booked
          ) gone) AS churned`,
      [from, to, [...ASSIGNED_ORDER_STATUSES], companyId],
    );

    const [idle] = await this.dataSource.query<{ idle_approved: string }[]>(
      // **نفس تعريف النشاط بالظبط** اللي `active_in_period` بيستخدمه (طلب محجوز في الفترة)،
      // مش «شغل خلص». لو الاتنين اتقاسوا بمسطرتين، الفني اللي ماسك شغلانة لسه ما خلصتش كان
      // بيتعدّ **نشط وواقف في نفس الوقت** — واللوحة بتقول ١٠ اشتغلوا و١٩١ واقفين من ١٩١
      // معتمد. اتلقطت في المراجعة البصرية الحية. دلوقتي: نشط + واقف = المعتمدون، دايمًا.
      `WITH ${this.participationCte()}
       SELECT COUNT(*) AS idle_approved
         FROM technician_profiles tp
        WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved'
          AND ($4::uuid IS NULL OR tp.company_id = $4::uuid)
          AND NOT EXISTS (
            SELECT 1 FROM participation p
              JOIN orders o ON o.id = p.order_id
             WHERE p.technician_id = tp.id
               AND o.order_status = ANY($3::order_status[])
               AND o.placed_at >= $1 AND o.placed_at < $2)`,
      [from, to, [...ASSIGNED_ORDER_STATUSES], companyId],
    );

    const [debt] = await this.dataSource.query<
      { technicians_in_debt: string; total_debt_cents: string; above_threshold: string }[]
    >(
      // الدَّين مش مخزّن في أي عمود — هو رصيد محفظة سالب (technician-debt-status.ts). بنقراه
      // من نفس المصدر بالظبط اللي شاشة المديونيات بتقراه منه، مش من حساب تاني.
      `SELECT
         COUNT(*) AS technicians_in_debt,
         COALESCE(SUM(-w.balance_cents), 0) AS total_debt_cents,
         COUNT(*) FILTER (WHERE -w.balance_cents > $1) AS above_threshold
       FROM wallets w
       JOIN technician_profiles tp ON tp.user_id = w.owner_user_id AND tp.deleted_at IS NULL
      WHERE w.deleted_at IS NULL AND w.owner_type = 'technician' AND w.balance_cents < 0
        AND ($2::uuid IS NULL OR tp.company_id = $2::uuid)`,
      [debtThreshold, companyId],
    );

    const approved = Number(head?.approved ?? 0);
    const capacityMinutes = approved * capacityPerDay * days;
    const bookedMinutes = Number(activity?.booked_minutes ?? 0);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      company_id: companyId,
      headcount: {
        approved,
        in_pipeline: Number(head?.in_pipeline ?? 0),
        suspended: Number(head?.suspended ?? 0),
        approved_technicians: Number(head?.approved_technicians ?? 0),
        approved_assistants: Number(head?.approved_assistants ?? 0),
        new_joiners: Number(head?.new_joiners ?? 0),
      },
      by_level: levels.map((l) => ({ level: l.level, count: Number(l.count) })),
      active_in_period: Number(activity?.active_in_period ?? 0),
      idle_approved: Number(idle?.idle_approved ?? 0),
      churned: Number(activity?.churned ?? 0),
      capacity_minutes: capacityMinutes,
      booked_minutes: bookedMinutes,
      utilization_percent: capacityMinutes > 0 ? Number(((bookedMinutes / capacityMinutes) * 100).toFixed(2)) : null,
      debt: {
        technicians_in_debt: Number(debt?.technicians_in_debt ?? 0),
        total_debt_cents: Number(debt?.total_debt_cents ?? 0),
        above_threshold: Number(debt?.above_threshold ?? 0),
        threshold_cents: debtThreshold,
      },
    };
  }

  /**
   * كشف أداء لكل فني — الصف الواحد فيه كل الأرقام اللي تخلّي الأدمن يقرر: يرقّيه، يدرّبه،
   * يحاسبه، ولا يشيله.
   *
   * **القدرة بتتناسب مع تاريخ الاعتماد** (`GREATEST(from, approved_at)`): الفني اللي اتعمد
   * نص الفترة استغلاله بيتقسم على نص الفترة، مش على الفترة كلها. من غير كده كل فني جديد بيبان
   * «فاضي ٩٠٪» ودي إجابة غلط على سؤال حقيقي.
   */
  async technicianScorecards(
    from: Date,
    to: Date,
    opts: { companyId?: string | null; sort?: WorkforceSort; limit?: number } = {},
  ): Promise<{ from: string; to: string; capacity_minutes_per_day: number; technicians: TechnicianScorecard[] }> {
    const capacityPerDay = await this.dailyCapacityMinutes();
    const companyId = opts.companyId ?? null;
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const orderBy = this.sortExpression(opts.sort ?? 'completed');

    const rows = await this.dataSource.query<Record<string, string | null>[]>(
      `WITH ${this.participationCte()},
       scoped AS (
         SELECT tp.id, tp.user_id, tp.technician_code, tp.current_level::text AS level,
                tp.technician_kind::text AS kind, tp.verification_status::text AS verification_status,
                tp.company_id, tp.approved_at, u.full_name, tc.name AS company_name,
                -- أيام القدرة الفعلية للفني في الفترة: من أكبر (بداية الفترة، تاريخ اعتماده).
                GREATEST(
                  CEIL(EXTRACT(EPOCH FROM ($2::timestamptz - GREATEST($1::timestamptz, COALESCE(tp.approved_at, $1::timestamptz)))) / 86400.0),
                  0
                )::int AS capacity_days
           FROM technician_profiles tp
           JOIN users u ON u.id = tp.user_id
           LEFT JOIN technician_companies tc ON tc.id = tp.company_id
          WHERE tp.deleted_at IS NULL
            AND ($3::uuid IS NULL OR tp.company_id = $3::uuid)
       ),
       work AS (
         SELECT p.technician_id,
                COUNT(*) FILTER (
                  WHERE o.order_status = 'completed' AND o.work_completed_at >= $1 AND o.work_completed_at < $2
                ) AS completed_orders,
                COALESCE(SUM(${orderWorkedMinutesSql('o')}) FILTER (
                  WHERE o.order_status = ANY($4::order_status[]) AND o.placed_at >= $1 AND o.placed_at < $2
                ), 0) AS worked_minutes,
                COUNT(*) FILTER (
                  WHERE o.order_status = 'completed' AND o.was_on_time IS TRUE
                    AND o.work_completed_at >= $1 AND o.work_completed_at < $2
                ) AS on_time,
                COUNT(*) FILTER (
                  WHERE o.order_status = 'completed' AND o.was_on_time IS NOT NULL
                    AND o.work_completed_at >= $1 AND o.work_completed_at < $2
                ) AS on_time_sample,
                -- إعادة الشغل بتتنسب لصاحب **الشغل الأصلي**، مش للّي راح يصلّح. الفلتر بيسأل:
                -- شغلانة خلّصها في الفترة واتفتح ليها بعد كده طلب إعادة زيارة (parent_order_id).
                -- العكس (عدّ الطلبات اللي هو راح فيها كإعادة زيارة) كان هيعاقب اللي بيصلّح
                -- ويسيب اللي غلط نضيف.
                COUNT(*) FILTER (
                  WHERE o.order_status = 'completed' AND o.work_completed_at >= $1 AND o.work_completed_at < $2
                    AND EXISTS (SELECT 1 FROM orders child
                                 WHERE child.parent_order_id = o.id AND child.deleted_at IS NULL)
                ) AS rework_count,
                MAX(GREATEST(o.work_completed_at, o.placed_at)) AS last_activity_at
           FROM participation p
           JOIN orders o ON o.id = p.order_id
          GROUP BY p.technician_id
       ),
       dispatch AS (
         SELECT oa.technician_id,
                COUNT(*) AS assignments_sent,
                COUNT(*) FILTER (WHERE oa.assignment_status = 'accepted') AS assignments_accepted,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (oa.responded_at - oa.sent_at)))
                  FILTER (WHERE oa.responded_at IS NOT NULL) AS median_response_seconds
           FROM order_assignments oa
          WHERE oa.sent_at >= $1 AND oa.sent_at < $2
          GROUP BY oa.technician_id
       ),
       cancels AS (
         SELECT toc.technician_id, COUNT(*) AS cancelled
           FROM technician_order_cancellations toc
          WHERE toc.cancelled_at >= $1 AND toc.cancelled_at < $2
          GROUP BY toc.technician_id
       ),
       -- صافي الأرباح = حصص المشاركة في الطلبات المدفوعة **ناقص** اللي اترجع منها فعليًا في
       -- الاستردادات. الطرح على مستوى الفني مش على مستوى الطلب لأن
       -- العمود refund_settlement_reversals.technician_id موجود، فمفيش داعي نوزّع تقديريًا.
       earnings AS (
         SELECT oes.technician_id,
                SUM(oes.share_cents) - COALESCE(SUM((
                  SELECT COALESCE(SUM(rsr.reversal_cents), 0)
                    FROM refund_settlement_reversals rsr
                   WHERE rsr.order_id = oes.order_id
                     AND rsr.bucket_type = 'participant'
                     AND rsr.technician_id = oes.technician_id
                )), 0) AS net_earnings_cents
           FROM order_earning_shares oes
           JOIN orders o ON o.id = oes.order_id
          WHERE oes.deleted_at IS NULL
            AND o.payment_status = ANY($5::order_payment_status[])
            AND o.paid_at >= $1 AND o.paid_at < $2
          GROUP BY oes.technician_id
       ),
       feedback AS (
         SELECT r.rated_user_id AS user_id,
                AVG(r.overall_rating)::numeric(4,2) AS average_rating,
                COUNT(*) AS ratings_count
           FROM ratings r
          WHERE r.rating_type = 'customer_to_technician'
            AND r.created_at >= $1 AND r.created_at < $2
          GROUP BY r.rated_user_id
       ),
       grievances AS (
         SELECT c.against_user_id AS user_id, COUNT(*) AS complaints_count
           FROM complaints c
          WHERE c.against_user_id IS NOT NULL AND c.created_at >= $1 AND c.created_at < $2
          GROUP BY c.against_user_id
       )
       SELECT s.id AS technician_id, s.technician_code, s.full_name AS display_name, s.level, s.kind,
              s.verification_status, s.company_id, s.company_name,
              (s.capacity_days * $6::int) AS capacity_minutes,
              COALESCE(w.completed_orders, 0) AS completed_orders,
              COALESCE(w.worked_minutes, 0) AS worked_minutes,
              COALESCE(w.on_time, 0) AS on_time,
              COALESCE(w.on_time_sample, 0) AS on_time_sample,
              COALESCE(w.rework_count, 0) AS rework_count,
              w.last_activity_at,
              COALESCE(d.assignments_sent, 0) AS assignments_sent,
              COALESCE(d.assignments_accepted, 0) AS assignments_accepted,
              d.median_response_seconds,
              COALESCE(cn.cancelled, 0) AS cancelled_by_technician,
              COALESCE(e.net_earnings_cents, 0) AS net_earnings_cents,
              f.average_rating,
              COALESCE(f.ratings_count, 0) AS ratings_count,
              COALESCE(g.complaints_count, 0) AS complaints_count,
              COALESCE(wa.balance_cents, 0) AS wallet_balance_cents
         FROM scoped s
         LEFT JOIN work w ON w.technician_id = s.id
         LEFT JOIN dispatch d ON d.technician_id = s.id
         LEFT JOIN cancels cn ON cn.technician_id = s.id
         LEFT JOIN earnings e ON e.technician_id = s.id
         LEFT JOIN feedback f ON f.user_id = s.user_id
         LEFT JOIN grievances g ON g.user_id = s.user_id
         LEFT JOIN wallets wa ON wa.owner_user_id = s.user_id AND wa.owner_type = 'technician' AND wa.deleted_at IS NULL
        ORDER BY ${orderBy}, s.technician_code ASC
        LIMIT $7`,
      [from, to, companyId, [...ASSIGNED_ORDER_STATUSES], [...SETTLED_PAYMENT_STATUSES], capacityPerDay, limit],
    );

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      capacity_minutes_per_day: capacityPerDay,
      technicians: rows.map((r) => this.toScorecard(r)),
    };
  }

  private toScorecard(r: Record<string, string | null>): TechnicianScorecard {
    const capacityMinutes = Number(r.capacity_minutes ?? 0);
    const workedMinutes = Number(r.worked_minutes ?? 0);
    const assignmentsSent = Number(r.assignments_sent ?? 0);
    const onTimeSample = Number(r.on_time_sample ?? 0);
    const balance = Number(r.wallet_balance_cents ?? 0);

    return {
      technician_id: String(r.technician_id),
      technician_code: String(r.technician_code),
      display_name: String(r.display_name),
      level: String(r.level),
      kind: String(r.kind),
      verification_status: String(r.verification_status),
      company_id: r.company_id ?? null,
      company_name: r.company_name ?? null,

      completed_orders: Number(r.completed_orders ?? 0),
      cancelled_by_technician: Number(r.cancelled_by_technician ?? 0),
      worked_minutes: workedMinutes,
      capacity_minutes: capacityMinutes,
      utilization_percent: capacityMinutes > 0 ? Number(((workedMinutes / capacityMinutes) * 100).toFixed(2)) : null,

      assignments_sent: assignmentsSent,
      assignments_accepted: Number(r.assignments_accepted ?? 0),
      acceptance_rate:
        assignmentsSent > 0
          ? Number(((Number(r.assignments_accepted ?? 0) / assignmentsSent) * 100).toFixed(2))
          : null,
      median_response_seconds:
        r.median_response_seconds === null || r.median_response_seconds === undefined
          ? null
          : Math.round(Number(r.median_response_seconds)),

      on_time_rate: onTimeSample > 0 ? Number(((Number(r.on_time ?? 0) / onTimeSample) * 100).toFixed(2)) : null,
      on_time_sample: onTimeSample,
      complaints_count: Number(r.complaints_count ?? 0),
      rework_count: Number(r.rework_count ?? 0),

      average_rating: r.average_rating === null || r.average_rating === undefined ? null : Number(r.average_rating),
      ratings_count: Number(r.ratings_count ?? 0),

      net_earnings_cents: Number(r.net_earnings_cents ?? 0),
      wallet_balance_cents: balance,
      debt_cents: balance < 0 ? -balance : 0,

      last_activity_at: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
    };
  }

  /** ترتيب مقفول — النص من الكولر مابيوصلش الـSQL أبدًا، بيتحوّل من جدول ثابت. */
  private sortExpression(sort: WorkforceSort): string {
    switch (sort) {
      case 'earnings':
        return 'COALESCE(e.net_earnings_cents, 0) DESC';
      case 'utilization':
        return 'COALESCE(w.worked_minutes, 0)::numeric / GREATEST(s.capacity_days, 1) DESC';
      case 'rating':
        return 'f.average_rating DESC NULLS LAST';
      case 'idle':
        return 'COALESCE(w.completed_orders, 0) ASC, w.last_activity_at ASC NULLS FIRST';
      case 'debt':
        return 'COALESCE(wa.balance_cents, 0) ASC';
      case 'completed':
      default:
        return 'COALESCE(w.completed_orders, 0) DESC';
    }
  }

  /**
   * تغطية جغرافية: فين الطلب موجود وفين الناس موجودة — والفجوة بينهم.
   *
   * العرض بيتقاس بـ`home_area_id` (منطقة سكن الفني) مش بمناطق الخدمة، وده اختيار متعمّد:
   * `technician_zones` بتقول «مستعد يروح فين» واللي بيهم هنا «فين الناس أصلاً ساكنة»، لأن
   * المنطقة اللي فيها طلب وصفر ساكنين هي اللي محتاجة توظيف.
   */
  async areaCoverage(from: Date, to: Date, limit = 50): Promise<AreaCoverageReport> {
    const rows = await this.dataSource.query<
      {
        area_id: string;
        area_name_ar: string;
        city_name_ar: string;
        orders_placed: string;
        orders_matched: string;
        technicians_home_based: string;
      }[]
    >(
      `SELECT a.id AS area_id, a.name_ar AS area_name_ar, c.name_ar AS city_name_ar,
              COALESCE(od.orders_placed, 0) AS orders_placed,
              COALESCE(od.orders_matched, 0) AS orders_matched,
              COALESCE(sp.technicians_home_based, 0) AS technicians_home_based
         FROM areas a
         JOIN cities c ON c.id = a.city_id
         LEFT JOIN (
           SELECT ad.area_id,
                  COUNT(*) AS orders_placed,
                  COUNT(*) FILTER (WHERE o.order_status = ANY($3::order_status[])) AS orders_matched
             FROM orders o
             JOIN addresses ad ON ad.id = o.address_id
            WHERE o.deleted_at IS NULL AND ad.area_id IS NOT NULL
              AND o.placed_at >= $1 AND o.placed_at < $2
            GROUP BY ad.area_id
         ) od ON od.area_id = a.id
         LEFT JOIN (
           SELECT tp.home_area_id, COUNT(*) AS technicians_home_based
             FROM technician_profiles tp
            WHERE tp.deleted_at IS NULL AND tp.verification_status = 'approved'
              AND tp.home_area_id IS NOT NULL
            GROUP BY tp.home_area_id
         ) sp ON sp.home_area_id = a.id
        WHERE a.deleted_at IS NULL AND a.is_active
          AND (COALESCE(od.orders_placed, 0) > 0 OR COALESCE(sp.technicians_home_based, 0) > 0)
        ORDER BY COALESCE(od.orders_placed, 0) DESC, a.name_ar ASC
        LIMIT $4`,
      [from, to, [...ASSIGNED_ORDER_STATUSES], Math.min(Math.max(limit, 1), 200)],
    );

    const areas: AreaCoverageRow[] = rows.map((r) => {
      const placed = Number(r.orders_placed);
      const matched = Number(r.orders_matched);
      const technicians = Number(r.technicians_home_based);
      return {
        area_id: r.area_id,
        area_name_ar: r.area_name_ar,
        city_name_ar: r.city_name_ar,
        orders_placed: placed,
        orders_matched: matched,
        orders_unmatched: placed - matched,
        match_rate: placed > 0 ? Number(((matched / placed) * 100).toFixed(2)) : null,
        technicians_home_based: technicians,
        orders_per_technician: technicians > 0 ? Number((placed / technicians).toFixed(2)) : null,
      };
    });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      areas,
      uncovered_with_demand: areas.filter((a) => a.technicians_home_based === 0 && a.orders_placed > 0),
    };
  }

  /**
   * الحمل اللحظي: كام شغلانة شغّالة دلوقتي وعند مين. مش تاريخ — دي حالة اللحظة، وبتتقرا من
   * نفس قايمة الحالات النشطة اللي باقي النظام بيستخدمها.
   */
  async liveLoad(companyId: string | null = null): Promise<{
    active_orders: number;
    technicians_busy: number;
    unassigned_active_orders: number;
    busiest: { technician_id: string; technician_code: string; display_name: string; active_orders: number }[];
  }> {
    const [totals] = await this.dataSource.query<
      { active_orders: string; technicians_busy: string; unassigned_active_orders: string }[]
    >(
      `WITH ${this.participationCte()}
       SELECT
         (SELECT COUNT(*) FROM orders o
           WHERE o.deleted_at IS NULL AND o.order_status = ANY($1::order_status[])) AS active_orders,
         (SELECT COUNT(DISTINCT p.technician_id)
            FROM participation p
            JOIN orders o ON o.id = p.order_id
            JOIN technician_profiles tp ON tp.id = p.technician_id AND tp.deleted_at IS NULL
           WHERE o.order_status = ANY($1::order_status[])
             AND ($2::uuid IS NULL OR tp.company_id = $2::uuid)) AS technicians_busy,
         (SELECT COUNT(*) FROM orders o
           WHERE o.deleted_at IS NULL AND o.order_status = ANY($1::order_status[])
             AND o.technician_id IS NULL) AS unassigned_active_orders`,
      [[...ACTIVE_ORDER_STATUSES], companyId],
    );

    const busiest = await this.dataSource.query<
      { technician_id: string; technician_code: string; display_name: string; active_orders: string }[]
    >(
      `WITH ${this.participationCte()}
       SELECT tp.id AS technician_id, tp.technician_code, u.full_name AS display_name,
              COUNT(*) AS active_orders
         FROM participation p
         JOIN orders o ON o.id = p.order_id
         JOIN technician_profiles tp ON tp.id = p.technician_id AND tp.deleted_at IS NULL
         JOIN users u ON u.id = tp.user_id
        WHERE o.order_status = ANY($1::order_status[])
          AND ($2::uuid IS NULL OR tp.company_id = $2::uuid)
        GROUP BY tp.id, tp.technician_code, u.full_name
        ORDER BY COUNT(*) DESC, tp.technician_code ASC
        LIMIT 10`,
      [[...ACTIVE_ORDER_STATUSES], companyId],
    );

    return {
      active_orders: Number(totals?.active_orders ?? 0),
      technicians_busy: Number(totals?.technicians_busy ?? 0),
      unassigned_active_orders: Number(totals?.unassigned_active_orders ?? 0),
      busiest: busiest.map((b) => ({
        technician_id: b.technician_id,
        technician_code: b.technician_code,
        display_name: b.display_name,
        active_orders: Number(b.active_orders),
      })),
    };
  }
}
