import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiException, ErrorCode } from '../../../common/exceptions/api.exception';
import { AuditActorMeta, AuditLogService } from '../../audit/audit-log.service';
import { returningFirst } from '../../../common/db/returning-rows';
import {
  calculateRiskScore,
  levelFor,
  type RiskBucket,
  type RiskLevel,
  type RiskScoreResult,
  type RiskVerdict,
  type ScorableSignal,
} from './risk-score';

/**
 * **مركز المخاطر والتلاعب — القراءة والحكم** (ADR-0085).
 *
 * الدرجة **بتتحسب هنا وقت القراءة** من الإشارات المخزّنة، مش بتتقري من عمود. السبب في
 * ADR-0085 §1: الدرجة دالة في الوقت (اضمحلال)، فأي قيمة مخزّنة بتبقى غلط بعد ثانية من
 * تخزينها. الحساب رخيص لأن الإشارات قليلة بطبيعتها — الناس العادية مالهاش إشارات أصلاً.
 */

export interface RiskQueueRow {
  actorUserId: string;
  actorType: string;
  fullName: string | null;
  phoneNumber: string | null;
  score: number;
  level: RiskLevel;
  /** الـbucket صاحب أكبر مساهمة — «السبب الأساسي» في صف الطابور. */
  topBucket: RiskBucket | null;
  topReasons: string[];
  signalCount: number;
  ordersInWindow: number;
  /**
   * الفلوس المعرّضة = قيمة الطلبات اللي تحت الشكّ **لسه مش محكوم عليها بـ«مشروعة»**.
   *
   * **مش «فلوس ضايعة» ولا «فلوس اتسرقت»** — دي الفلوس اللي المراجعة البشرية لسه ماحسمتهاش،
   * والغرض الوحيد منها ترتيب الطابور: أغلى شكّ يتراجع الأول. إشارة على مستوى السلوك (نمط
   * عبر طلبات) بتخلّي كل طلبات الشخص في النافذة معرّضة، لأن النمط نفسه مش محصور في طلب.
   */
  moneyAtRiskCents: number;
  complaintsAgainst: number;
  caseId: string | null;
  caseStatus: string | null;
  lastSignalAt: string | null;
  /** اتجاه السلوك: مقارنة إشارات آخر ٣٠ يوم بالـ٣٠ اللي قبلها. */
  trend: 'up' | 'down' | 'flat';
}

/** ترتيب الطابور — المالك طلب الخمسة دول بالاسم (docs/08 §140 بند ٢). */
export const RISK_QUEUE_SORTS = ['score', 'money', 'complaints', 'frequency', 'recent'] as const;
export type RiskQueueSort = (typeof RISK_QUEUE_SORTS)[number];

const SIGNAL_SELECT = `
  SELECT s.id, s.signal_type_code, s.occurred_at, s.verdict, s.evidence, s.order_id,
         s.actor_user_id, s.actor_type,
         COALESCE(s.weight_override, t.weight) AS weight,
         t.bucket, t.label_ar
    FROM risk_signals s
    JOIN risk_signal_types t ON t.code = s.signal_type_code
   WHERE t.is_enabled = true`;

interface SignalRow {
  id: string;
  signal_type_code: string;
  occurred_at: Date;
  verdict: RiskVerdict;
  evidence: Record<string, unknown>;
  order_id: string | null;
  actor_user_id: string;
  actor_type: string;
  weight: number;
  bucket: RiskBucket;
  label_ar: string;
}

const toScorable = (row: SignalRow): ScorableSignal => ({
  id: row.id,
  signalTypeCode: row.signal_type_code,
  bucket: row.bucket,
  labelAr: row.label_ar,
  weight: Number(row.weight),
  occurredAt: new Date(row.occurred_at),
  verdict: row.verdict,
  evidence: row.evidence ?? {},
  orderId: row.order_id,
});

@Injectable()
export class RiskCenterService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditLog: AuditLogService,
  ) {}

  /** درجة فاعل واحد مع تفسيرها الكامل. */
  async scoreActor(actorUserId: string, now: Date = new Date()): Promise<RiskScoreResult> {
    const rows = await this.dataSource.query<SignalRow[]>(
      `${SIGNAL_SELECT} AND s.actor_user_id = $1`,
      [actorUserId],
    );
    return calculateRiskScore(rows.map(toScorable), now);
  }

  /**
   * طابور المراجعة: **صف لكل شخص**، مش لكل حدث — ده كل الفرق عن مركز المراجعة (ADR-0084).
   *
   * بنجيب كل إشارات كل الفاعلين في نداء واحد وبنجمّعها في الذاكرة بدل نداء لكل فاعل: عدد
   * الفاعلين اللي عندهم إشارات صغير بطبيعته (اللي ملوش إشارة مش في الطابور أصلاً)، والحلقة
   * على الداتابيز كانت هتبقى N+1 بلا أي فايدة.
   */
  async listQueue(filters: {
    minScore?: number;
    actorType?: string;
    bucket?: string;
    caseStatus?: string;
    sort?: RiskQueueSort;
    limit?: number;
  } = {}): Promise<RiskQueueRow[]> {
    const now = new Date();
    const rows = await this.dataSource.query<SignalRow[]>(`${SIGNAL_SELECT}`);
    if (rows.length === 0) return [];

    const byActor = new Map<string, SignalRow[]>();
    for (const row of rows) {
      const list = byActor.get(row.actor_user_id) ?? [];
      list.push(row);
      byActor.set(row.actor_user_id, list);
    }

    const actorIds = [...byActor.keys()];
    const [profiles, cases, orderCounts, moneyAtRisk, complaintCounts] = await Promise.all([
      this.dataSource.query<{ id: string; full_name: string; phone_number: string }[]>(
        `SELECT id, full_name, phone_number FROM users WHERE id = ANY($1::uuid[])`, [actorIds]),
      this.dataSource.query<{ id: string; actor_user_id: string; status: string }[]>(
        `SELECT id, actor_user_id, status FROM risk_cases
          WHERE actor_user_id = ANY($1::uuid[]) AND closed_at IS NULL`, [actorIds]),
      this.dataSource.query<{ actor_user_id: string; orders: string }[]>(
        `SELECT u.id AS actor_user_id, COUNT(DISTINCT o.id)::text AS orders
           FROM users u
           LEFT JOIN technician_profiles tp ON tp.user_id = u.id
           LEFT JOIN customer_profiles cp ON cp.user_id = u.id
           LEFT JOIN orders o ON (o.technician_id = tp.id OR o.customer_id = cp.id)
                             AND o.created_at > now() - interval '30 days' AND o.deleted_at IS NULL
          WHERE u.id = ANY($1::uuid[])
          GROUP BY 1`, [actorIds]),
      // الفلوس المعرّضة = **اتحاد** مجموعتين، بـUNION عشان الطلب مايتجمعش مرتين:
      //   ١. الطلبات اللي عليها إشارة بعينها (`order_id` مش فاضي).
      //   ٢. لو الشخص عنده إشارة على مستوى **السلوك** (نمط عبر طلبات، `order_id` فاضي) —
      //      النمط ده بيغطّي كل طلباته في نافذة التحليل، مش طلب واحد.
      // الفني بيتربط بالطلب كمنفّذ أو كعضو طاقم (المساعد مابيظهرش في `orders.technician_id`
      // خالص، فالاكتفاء بيه كان هيدّي المساعدين صفر دايمًا).
      this.dataSource.query<{ actor_user_id: string; cents: string }[]>(
        `WITH open_signals AS (
           SELECT actor_user_id, order_id FROM risk_signals
            WHERE actor_user_id = ANY($1::uuid[]) AND verdict <> 'legitimate'
         ),
         pattern_actors AS (
           SELECT DISTINCT actor_user_id FROM open_signals WHERE order_id IS NULL
         ),
         actor_orders AS (
           SELECT pa.actor_user_id, o.id AS order_id
             FROM pattern_actors pa
             LEFT JOIN technician_profiles tp ON tp.user_id = pa.actor_user_id
             LEFT JOIN customer_profiles cp ON cp.user_id = pa.actor_user_id
             JOIN orders o
               ON (o.technician_id = tp.id
                OR o.customer_id = cp.id
                OR EXISTS (SELECT 1 FROM order_team_members m
                            WHERE m.order_id = o.id AND m.technician_id = tp.id))
            WHERE o.deleted_at IS NULL AND o.created_at > now() - interval '90 days'
         ),
         exposed AS (
           SELECT actor_user_id, order_id FROM open_signals WHERE order_id IS NOT NULL
           UNION
           SELECT actor_user_id, order_id FROM actor_orders
         )
         SELECT e.actor_user_id, COALESCE(SUM(o.total_amount_cents), 0)::text AS cents
           FROM exposed e JOIN orders o ON o.id = e.order_id AND o.deleted_at IS NULL
          GROUP BY 1`, [actorIds]),
      this.dataSource.query<{ actor_user_id: string; complaints: string }[]>(
        `SELECT against_user_id AS actor_user_id, COUNT(*)::text AS complaints
           FROM complaints
          WHERE against_user_id = ANY($1::uuid[])
            AND created_at > now() - interval '90 days'
          GROUP BY 1`, [actorIds]),
    ]);

    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const caseByActor = new Map(cases.map((c) => [c.actor_user_id, c]));
    const ordersByActor = new Map(orderCounts.map((o) => [o.actor_user_id, Number(o.orders)]));
    const moneyByActor = new Map(moneyAtRisk.map((m) => [m.actor_user_id, Number(m.cents)]));
    const complaintsByActor = new Map(complaintCounts.map((c) => [c.actor_user_id, Number(c.complaints)]));

    const queue: RiskQueueRow[] = [];
    for (const [actorUserId, signals] of byActor) {
      const result = calculateRiskScore(signals.map(toScorable), now);
      // إشارات كلها محكوم عليها بـ«مشروعة» = درجة صفر = الشخص ده مش في الطابور.
      if (result.score === 0) continue;

      const topBucketEntry = (Object.entries(result.bucketTotals) as [RiskBucket, number][])
        .filter(([, total]) => total > 0)
        .sort((left, right) => right[1] - left[1])[0];

      const profile = profileById.get(actorUserId);
      const openCase = caseByActor.get(actorUserId);
      const lastSignal = signals
        .map((s) => new Date(s.occurred_at).getTime())
        .sort((a, b) => b - a)[0];

      queue.push({
        actorUserId,
        actorType: signals[0].actor_type,
        fullName: profile?.full_name ?? null,
        phoneNumber: profile?.phone_number ?? null,
        score: result.score,
        level: result.level,
        topBucket: topBucketEntry?.[0] ?? null,
        topReasons: result.lines.filter((l) => l.contribution > 0).slice(0, 3).map((l) => l.labelAr),
        signalCount: result.signalCount,
        ordersInWindow: ordersByActor.get(actorUserId) ?? 0,
        moneyAtRiskCents: moneyByActor.get(actorUserId) ?? 0,
        complaintsAgainst: complaintsByActor.get(actorUserId) ?? 0,
        caseId: openCase?.id ?? null,
        caseStatus: openCase?.status ?? null,
        lastSignalAt: lastSignal ? new Date(lastSignal).toISOString() : null,
        trend: this.trendFor(signals, now),
      });
    }

    const filtered = queue.filter((row) => {
      if (filters.minScore !== undefined && row.score < filters.minScore) return false;
      if (filters.actorType && row.actorType !== filters.actorType) return false;
      if (filters.bucket && row.topBucket !== filters.bucket) return false;
      if (filters.caseStatus && row.caseStatus !== filters.caseStatus) return false;
      return true;
    });

    // الدرجة هي كاسر التعادل دايمًا: ترتيب بالفلوس مثلاً بيخلّي صفّين بنفس المبلغ يترتبوا
    // بالأخطر، مش بترتيب عشوائي من الداتابيز.
    const byScore = (left: RiskQueueRow, right: RiskQueueRow) => right.score - left.score;
    const comparators: Record<RiskQueueSort, (l: RiskQueueRow, r: RiskQueueRow) => number> = {
      score: byScore,
      money: (l, r) => r.moneyAtRiskCents - l.moneyAtRiskCents || byScore(l, r),
      complaints: (l, r) => r.complaintsAgainst - l.complaintsAgainst || byScore(l, r),
      frequency: (l, r) => r.signalCount - l.signalCount || byScore(l, r),
      recent: (l, r) =>
        (r.lastSignalAt ? Date.parse(r.lastSignalAt) : 0) -
          (l.lastSignalAt ? Date.parse(l.lastSignalAt) : 0) || byScore(l, r),
    };

    return filtered
      .sort(comparators[filters.sort ?? 'score'])
      .slice(0, filters.limit ?? 100);
  }

  /** اتجاه السلوك: إشارات آخر ٣٠ يوم مقابل الـ٣٠ اللي قبلها — «بيتدهور ولا بيتحسّن؟». */
  private trendFor(signals: SignalRow[], now: Date): 'up' | 'down' | 'flat' {
    const day = 86_400_000;
    let recent = 0;
    let previous = 0;
    for (const signal of signals) {
      if (signal.verdict === 'legitimate') continue;
      const age = (now.getTime() - new Date(signal.occurred_at).getTime()) / day;
      if (age <= 30) recent += 1;
      else if (age <= 60) previous += 1;
    }
    if (recent > previous) return 'up';
    if (recent < previous) return 'down';
    return 'flat';
  }

  /** الملخّص التنفيذي أعلى الصفحة + منحنى الحالات اليومي. */
  async overview(): Promise<Record<string, unknown>> {
    const queue = await this.listQueue({ limit: 10_000 });
    const [counters] = await this.dataSource.query<{
      pending_signals: string; open_cases: string; confirmed_this_month: string; false_positives: string;
    }[]>(
      `SELECT
         (SELECT COUNT(*) FROM risk_signals WHERE verdict = 'pending')::text AS pending_signals,
         (SELECT COUNT(*) FROM risk_cases WHERE closed_at IS NULL)::text AS open_cases,
         (SELECT COUNT(*) FROM risk_cases
           WHERE status = 'confirmed_manipulation'
             AND date_trunc('month', COALESCE(closed_at, updated_at)) = date_trunc('month', now()))::text AS confirmed_this_month,
         (SELECT COUNT(*) FROM risk_signals WHERE verdict = 'legitimate')::text AS false_positives`,
    );

    const byBucket = await this.dataSource.query<{ bucket: string; signals: string }[]>(
      `SELECT t.bucket, COUNT(*)::text AS signals
         FROM risk_signals s JOIN risk_signal_types t ON t.code = s.signal_type_code
        WHERE s.verdict <> 'legitimate'
          AND s.occurred_at > now() - interval '30 days'
        GROUP BY 1 ORDER BY 2 DESC`,
    );

    const trend = await this.dataSource.query<{ day: string; signals: string }[]>(
      `SELECT to_char(date_trunc('day', s.occurred_at), 'YYYY-MM-DD') AS day, COUNT(*)::text AS signals
         FROM risk_signals s
        WHERE s.occurred_at > now() - interval '30 days' AND s.verdict <> 'legitimate'
        GROUP BY 1 ORDER BY 1`,
    );

    return {
      high_risk_actors: queue.filter((row) => row.score >= 70).length,
      critical_actors: queue.filter((row) => row.score >= 85).length,
      actors_with_signals: queue.length,
      cases_waiting_review: Number(counters.open_cases),
      pending_signals: Number(counters.pending_signals),
      confirmed_manipulation_this_month: Number(counters.confirmed_this_month),
      false_positives: Number(counters.false_positives),
      by_bucket: byBucket.map((row) => ({ bucket: row.bucket, signals: Number(row.signals) })),
      daily_trend: trend.map((row) => ({ day: row.day, signals: Number(row.signals) })),
    };
  }

  /**
   * ملف المخاطر الكامل للشخص — الدرجة مفسَّرة + إحصاءاته + **مقارنته بأقرانه** + تاريخه.
   *
   * المقارنة بالأقران هي جوهر الشاشة: «زوّد السعر في ٦١٪» مش رقم، «وأقرانه ٩٪» هو الرقم.
   */
  async actorProfile(actorUserId: string): Promise<Record<string, unknown>> {
    const [user] = await this.dataSource.query<{
      id: string; full_name: string; phone_number: string; user_type: string; is_blocked: boolean; created_at: Date;
    }[]>(
      `SELECT id, full_name, phone_number, user_type::text, is_blocked, created_at
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [actorUserId],
    );
    if (!user) throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);

    const score = await this.scoreActor(actorUserId);
    const [openCase] = await this.dataSource.query<{ id: string; status: string; assigned_to_user_id: string | null }[]>(
      `SELECT id, status, assigned_to_user_id FROM risk_cases WHERE actor_user_id = $1 AND closed_at IS NULL`,
      [actorUserId],
    );

    const [stats] = await this.dataSource.query<Record<string, string>[]>(
      `WITH tp AS (SELECT id FROM technician_profiles WHERE user_id = $1),
            cp AS (SELECT id FROM customer_profiles WHERE user_id = $1),
            scoped AS (
              SELECT o.* FROM orders o
               WHERE o.deleted_at IS NULL
                 AND o.created_at > now() - interval '90 days'
                 AND (o.technician_id IN (SELECT id FROM tp) OR o.customer_id IN (SELECT id FROM cp))
            )
       SELECT COUNT(*)::text AS orders_90d,
              COUNT(*) FILTER (WHERE order_status = 'completed')::text AS completed,
              -- **مفيش حالة اسمها cancelled** — فيه تلاتة: بالعميل، بالفني، بالنظام. جمعهم
              -- واحد واحد بدل LIKE عشان أي حالة جديدة تتضاف للـenum تفضل ظاهرة هنا بالاسم
              -- بدل ما تتبلع في نمط نصي. (بلا backticks: دي جوّه template literal.)
              COUNT(*) FILTER (WHERE order_status IN
                ('cancelled_by_customer','cancelled_by_technician','cancelled_by_system'))::text AS cancelled,
              COALESCE(SUM(total_amount_cents), 0)::text AS gross_cents,
              (SELECT COUNT(*)::text FROM technician_order_cancellations c
                WHERE c.technician_user_id = $1 AND c.cancelled_at > now() - interval '90 days') AS tech_cancellations,
              (SELECT COUNT(*)::text FROM complaints WHERE against_user_id = $1
                 AND created_at > now() - interval '90 days') AS complaints_against,
              (SELECT COUNT(*)::text FROM complaints WHERE filed_by_user_id = $1
                 AND created_at > now() - interval '90 days') AS complaints_filed,
              -- التقييم بتاع الشخص = اللي الناس *إدّته له*، مش تقييمات طلباته بشكل عام.
              -- جدول ratings فيه صفّين لنفس الطلب (كل طرف بيقيّم التاني)، فالربط بالطلب
              -- لوحده كان هيخلط تقييم العميل بتقييم الفني في رقم واحد.
              (SELECT COALESCE(ROUND(AVG(r.overall_rating)::numeric, 2), 0)::text FROM ratings r
                WHERE r.rated_user_id = $1 AND r.created_at > now() - interval '90 days') AS avg_rating,
              (SELECT COUNT(*)::text FROM refunds rf JOIN scoped s3 ON s3.id = rf.order_id) AS refunds
         FROM scoped`,
      [actorUserId],
    );

    const timeline = await this.dataSource.query<{ month: string; bucket: string; signals: string }[]>(
      `SELECT to_char(date_trunc('month', s.occurred_at), 'YYYY-MM') AS month,
              t.bucket, COUNT(*)::text AS signals
         FROM risk_signals s JOIN risk_signal_types t ON t.code = s.signal_type_code
        WHERE s.actor_user_id = $1 AND s.verdict <> 'legitimate'
        GROUP BY 1, 2 ORDER BY 1`,
      [actorUserId],
    );

    const reviewHistory = await this.dataSource.query(
      `SELECT s.id, s.signal_type_code, t.label_ar, s.verdict, s.verdict_at, s.verdict_notes,
              u.full_name AS reviewer_name
         FROM risk_signals s
         JOIN risk_signal_types t ON t.code = s.signal_type_code
         LEFT JOIN users u ON u.id = s.verdict_by_user_id
        WHERE s.actor_user_id = $1 AND s.verdict <> 'pending'
        ORDER BY s.verdict_at DESC NULLS LAST LIMIT 50`,
      [actorUserId],
    );

    const actions = await this.dataSource.query(
      `SELECT a.id, a.action_type, a.reason, a.score_at_action, a.expires_at, a.reverted_at,
              a.created_at, u.full_name AS performed_by_name
         FROM risk_actions a
         LEFT JOIN users u ON u.id = a.performed_by_user_id
        WHERE a.actor_user_id = $1
        ORDER BY a.created_at DESC LIMIT 50`,
      [actorUserId],
    );

    return {
      actor: {
        user_id: user.id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        user_type: user.user_type,
        is_blocked: user.is_blocked,
        member_since: user.created_at,
      },
      score: score.score,
      level: score.level,
      // **التفسير مش اختياري** — نفس القاعدة في ADR-0085 §2.
      score_breakdown: score.lines,
      bucket_totals: score.bucketTotals,
      signal_count: score.signalCount,
      dismissed_count: score.dismissedCount,
      open_case: openCase ?? null,
      stats: {
        orders_90d: Number(stats?.orders_90d ?? 0),
        completed: Number(stats?.completed ?? 0),
        cancelled: Number(stats?.cancelled ?? 0),
        gross_cents: Number(stats?.gross_cents ?? 0),
        technician_cancellations: Number(stats?.tech_cancellations ?? 0),
        complaints_against: Number(stats?.complaints_against ?? 0),
        complaints_filed: Number(stats?.complaints_filed ?? 0),
        avg_rating: Number(stats?.avg_rating ?? 0),
        refunds: Number(stats?.refunds ?? 0),
      },
      timeline: timeline.map((row) => ({ month: row.month, bucket: row.bucket, signals: Number(row.signals) })),
      review_history: reviewHistory,
      actions,
    };
  }

  /** إشارات الشخص كاملة بالنص والدليل — تبويب «الإشارات» في الملف. */
  async actorSignals(actorUserId: string): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT s.id, s.signal_type_code, t.label_ar, t.description_ar, t.bucket,
              COALESCE(s.weight_override, t.weight) AS weight,
              s.occurred_at, s.verdict, s.verdict_notes, s.verdict_at, s.evidence,
              s.order_id, o.order_number,
              u.full_name AS reviewer_name
         FROM risk_signals s
         JOIN risk_signal_types t ON t.code = s.signal_type_code
         LEFT JOIN orders o ON o.id = s.order_id
         LEFT JOIN users u ON u.id = s.verdict_by_user_id
        WHERE s.actor_user_id = $1
        ORDER BY s.occurred_at DESC`,
      [actorUserId],
    );
  }

  /**
   * حكم المراجع على إشارة — ده المكان اللي «الـengine بيتعلم من البشر» فيه (ADR-0085 §4).
   *
   * الحكم بيغيّر الدرجة **فورًا** لأنها بتتحسب وقت القراءة: مفيش job ولا انتظار.
   */
  async recordVerdict(
    adminUserId: string,
    signalId: string,
    verdict: RiskVerdict,
    notes: string | null,
    meta?: AuditActorMeta,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const [existing] = await manager.query<{ id: string; actor_user_id: string; verdict: string }[]>(
        `SELECT id, actor_user_id, verdict FROM risk_signals WHERE id = $1 FOR UPDATE`,
        [signalId],
      );
      if (!existing) throw new ApiException(ErrorCode.VAL_001, 'الإشارة غير موجودة', HttpStatus.NOT_FOUND);

      const updated = returningFirst<Record<string, unknown>>(
        await manager.query(
          `UPDATE risk_signals
              SET verdict = $2, verdict_by_user_id = $3, verdict_at = now(), verdict_notes = $4
            WHERE id = $1
           RETURNING *`,
          [signalId, verdict, adminUserId, notes],
        ),
      );

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: 'risk_center.signal_verdict_recorded',
          entityType: 'risk_signal',
          entityId: signalId,
          oldValues: { verdict: existing.verdict },
          newValues: { verdict, notes },
          meta,
        },
        manager,
      );
      return updated ?? {};
    });
  }

  /** فتح/تحديث حالة للفاعل — وحدة الشغل البشري. */
  async upsertCase(
    adminUserId: string,
    actorUserId: string,
    body: { status?: string; assigned_to_user_id?: string | null; notes?: string | null },
    meta?: AuditActorMeta,
  ): Promise<Record<string, unknown>> {
    const score = await this.scoreActor(actorUserId);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`risk-case:${actorUserId}`]);

      const [actorType] = await manager.query<{ user_type: string }[]>(
        `SELECT user_type::text FROM users WHERE id = $1`, [actorUserId]);
      if (!actorType) throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);

      const [open] = await manager.query<{ id: string; status: string }[]>(
        `SELECT id, status FROM risk_cases WHERE actor_user_id = $1 AND closed_at IS NULL FOR UPDATE`,
        [actorUserId],
      );

      const closing = body.status === 'cleared' || body.status === 'confirmed_manipulation';
      let row: Record<string, unknown> | undefined;
      if (open) {
        row = returningFirst<Record<string, unknown>>(
          await manager.query(
            `UPDATE risk_cases
                SET status = COALESCE($2, status),
                    assigned_to_user_id = COALESCE($3, assigned_to_user_id),
                    resolution_notes = COALESCE($4, resolution_notes),
                    last_score = $5, last_scored_at = now(),
                    closed_at = CASE WHEN $6 THEN now() ELSE closed_at END,
                    closed_by_user_id = CASE WHEN $6 THEN $7::uuid ELSE closed_by_user_id END
              WHERE id = $1
             RETURNING *`,
            [open.id, body.status ?? null, body.assigned_to_user_id ?? null, body.notes ?? null,
             score.score, closing, adminUserId],
          ),
        );
      } else {
        [row] = await manager.query<Record<string, unknown>[]>(
          `INSERT INTO risk_cases
             (actor_user_id, actor_type, status, score_at_open, last_score, last_scored_at,
              assigned_to_user_id, opened_reason)
           VALUES ($1,$2,$3,$4,$4,now(),$5,$6)
           RETURNING *`,
          [actorUserId, actorType.user_type, body.status ?? 'needs_review', score.score,
           body.assigned_to_user_id ?? null, body.notes ?? null],
        );
      }

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: open ? 'risk_center.case_updated' : 'risk_center.case_opened',
          entityType: 'risk_case',
          entityId: String(row?.id ?? ''),
          oldValues: open ? { status: open.status } : null,
          newValues: { ...body, score_at_decision: score.score },
          meta,
        },
        manager,
      );
      return row ?? {};
    });
  }

  /**
   * تنفيذ إجراء متدرّج على الفاعل.
   *
   * **مفيش إجراء آلي هنا** (ADR-0085 §5): الدالة دي بتتنادى من ضغطة إنسان بصلاحية وstep-up
   * بس. النظام بيقترح المستوى المناسب في `suggestedAction`، والتنفيذ قرار بشري — لأن إشارة
   * غلط واحدة ممكن توقف رزق إنسان، وتكلفة الخطأ هنا غير متماثلة تمامًا.
   */
  async recordAction(
    adminUserId: string,
    actorUserId: string,
    body: { action_type: string; reason: string; expires_at?: string | null },
    meta?: AuditActorMeta,
  ): Promise<Record<string, unknown>> {
    const score = await this.scoreActor(actorUserId);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`risk-case:${actorUserId}`]);

      const [user] = await manager.query<{ id: string; is_blocked: boolean }[]>(
        `SELECT id, is_blocked FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [actorUserId]);
      if (!user) throw new ApiException(ErrorCode.VAL_001, 'المستخدم غير موجود', HttpStatus.NOT_FOUND);

      let [riskCase] = await manager.query<{ id: string }[]>(
        `SELECT id FROM risk_cases WHERE actor_user_id = $1 AND closed_at IS NULL FOR UPDATE`, [actorUserId]);
      if (!riskCase) {
        const [actorType] = await manager.query<{ user_type: string }[]>(
          `SELECT user_type::text FROM users WHERE id = $1`, [actorUserId]);
        [riskCase] = await manager.query<{ id: string }[]>(
          `INSERT INTO risk_cases (actor_user_id, actor_type, status, score_at_open, last_score, last_scored_at)
           VALUES ($1,$2,'investigating',$3,$3,now()) RETURNING id`,
          [actorUserId, actorType.user_type, score.score],
        );
      }

      const previousState = { is_blocked: user.is_blocked };
      let newState: Record<string, unknown> = previousState;

      // **الحظر هو الإجراء الوحيد اللي بيلمس حالة الحساب فعلاً.** الباقي تسجيل وتوجيه للمراجعة
      // — عمدًا: خفض الأولوية والتعليق المؤقت محتاجين ربط بمحرك التوزيع، وده تغيير في سلوك
      // قايم. ADR-0085 §الأثر بيقول «مفيش أي تغيير في سلوك قايم»، فبنسجّل القرار ونسيب
      // التنفيذ لمرحلة تانية موثّقة بدل ما نلمس التوزيع من غير تصميم.
      if (body.action_type === 'suspend_account' && !user.is_blocked) {
        await manager.query(`UPDATE users SET is_blocked = true WHERE id = $1`, [actorUserId]);
        newState = { is_blocked: true };
      } else if (body.action_type === 'restore_account' && user.is_blocked) {
        await manager.query(`UPDATE users SET is_blocked = false WHERE id = $1`, [actorUserId]);
        newState = { is_blocked: false };
      }

      const [action] = await manager.query<Record<string, unknown>[]>(
        `INSERT INTO risk_actions
           (case_id, actor_user_id, action_type, reason, evidence_snapshot, score_at_action,
            previous_state, new_state, expires_at, performed_by_user_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::timestamptz,$10)
         RETURNING *`,
        [riskCase.id, actorUserId, body.action_type, body.reason,
         // **لقطة الدليل وقت القرار**: الإشارات بتضمحل والبيانات بتتغيّر؛ المراجعة بعد شهور
         // لازم تشوف اللي المنفّذ شافه، مش الحالة النهاردة.
         JSON.stringify({ score: score.score, level: score.level, lines: score.lines.slice(0, 10) }),
         score.score, JSON.stringify(previousState), JSON.stringify(newState),
         body.expires_at ?? null, adminUserId],
      );

      await this.auditLog.record(
        {
          actorUserId: adminUserId,
          actorRole: 'admin',
          action: `risk_center.action_${body.action_type}`,
          entityType: 'risk_action',
          entityId: String(action.id),
          oldValues: previousState,
          newValues: { ...newState, reason: body.reason, score_at_action: score.score },
          meta,
        },
        manager,
      );
      return action;
    });
  }

  /** كتالوج أنواع الإشارات — الواجهة بتشرح بيه «إيه اللي النظام بيراقبه». */
  async listSignalTypes(): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT t.code, t.bucket, t.label_ar, t.description_ar, t.weight, t.applies_to, t.is_enabled,
              (SELECT COUNT(*) FROM risk_signals s
                WHERE s.signal_type_code = t.code AND s.occurred_at > now() - interval '30 days')::int AS signals_30d,
              (SELECT COUNT(*) FROM risk_signals s
                WHERE s.signal_type_code = t.code AND s.verdict = 'legitimate')::int AS dismissed_total
         FROM risk_signal_types t
        ORDER BY t.bucket, t.weight DESC`,
    );
  }

  /**
   * طلبات الشخص في النافذة — تبويب «الطلبات» في الملف.
   *
   * بيرجّع الأرقام اللي المراجع بيدوّر عليها: الإجمالي، وقيمة البنود اللي الفني ضافها بنفسه،
   * وهل فيه إيصال، وهل فيه شكوى. عمود «إجمالي الطلب» لوحده مابيقولش مين زوّده.
   */
  async actorOrders(actorUserId: string, limit = 100): Promise<unknown[]> {
    return this.dataSource.query(
      `WITH tp AS (SELECT id FROM technician_profiles WHERE user_id = $1),
            cp AS (SELECT id FROM customer_profiles WHERE user_id = $1)
       SELECT o.id, o.order_number, o.order_status::text, o.payment_status::text,
              o.total_amount_cents, o.created_at,
              s.name_ar AS service_name,
              COALESCE((SELECT SUM(oi.total_price_cents) FROM order_items oi
                         WHERE oi.order_id = o.id AND oi.added_by_user_id = $1), 0) AS added_by_actor_cents,
              (SELECT COUNT(*) FROM order_items oi
                WHERE oi.order_id = o.id AND oi.added_by_user_id = $1
                  AND oi.item_type = 'spare_part' AND oi.receipt_photo_url IS NULL)::int AS parts_without_receipt,
              EXISTS (SELECT 1 FROM complaints c WHERE c.order_id = o.id) AS has_complaint,
              EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id) AS has_refund
         FROM orders o
         JOIN services s ON s.id = o.service_id
        WHERE o.deleted_at IS NULL
          AND (o.technician_id IN (SELECT id FROM tp) OR o.customer_id IN (SELECT id FROM cp))
        ORDER BY o.created_at DESC
        LIMIT $2`,
      [actorUserId, limit],
    );
  }

  /**
   * الأطراف المقابلة — تبويب «العملاء» في الملف.
   *
   * لكل طرف: كام طلب، كام إلغاء، **وهل العميل استمر يحجز بعد آخر تعامل**. العمود الأخير ده
   * هو مؤشر التسريب: عميل وقف يحجز خالص بعد إلغاء الفني ليه سؤال يستاهل يتسأل.
   */
  async actorCounterparties(actorUserId: string, limit = 100): Promise<unknown[]> {
    return this.dataSource.query(
      `WITH tp AS (SELECT id FROM technician_profiles WHERE user_id = $1),
            pairs AS (
              SELECT cu.user_id AS counterparty_user_id, u.full_name,
                     COUNT(*)::int AS orders,
                     MAX(o.created_at) AS last_order_at,
                     COUNT(*) FILTER (WHERE o.order_status IN
                       ('cancelled_by_customer','cancelled_by_technician','cancelled_by_system'))::int AS cancelled
                FROM orders o
                JOIN customer_profiles cu ON cu.id = o.customer_id
                JOIN users u ON u.id = cu.user_id
               WHERE o.technician_id IN (SELECT id FROM tp) AND o.deleted_at IS NULL
               GROUP BY 1, 2
            )
       SELECT p.*,
              (SELECT COUNT(*) FROM technician_order_cancellations c
                JOIN orders o2 ON o2.id = c.order_id
                JOIN customer_profiles cu2 ON cu2.id = o2.customer_id
               WHERE c.technician_user_id = $1 AND cu2.user_id = p.counterparty_user_id)::int AS technician_cancellations,
              NOT EXISTS (
                SELECT 1 FROM orders o3
                  JOIN customer_profiles cu3 ON cu3.id = o3.customer_id
                 WHERE cu3.user_id = p.counterparty_user_id
                   AND o3.created_at > p.last_order_at
                   AND o3.deleted_at IS NULL
              ) AS stopped_booking_after
         FROM pairs p
        ORDER BY p.orders DESC
        LIMIT $2`,
      [actorUserId, limit],
    );
  }

  /** الإجراء اللي النظام **بيقترحه** عند درجة معيّنة — اقتراح مش تنفيذ (ADR-0085 §5). */
  static suggestedAction(score: number): { level: RiskLevel; suggested: string; automatic: false } {
    const level = levelFor(score);
    const suggested =
      level === 'critical' ? 'matching_hold'
        : level === 'high' ? 'reduce_matching_priority'
          : level === 'medium' ? 'manual_review'
            : level === 'watch' ? 'monitor'
              : 'clear_no_action';
    return { level, suggested, automatic: false };
  }
}
