import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { KpiDimensionScores, KpiWeightsApplied } from './entities/technician-kpi-snapshot.entity';

export interface KpiRawMetrics {
  offeredOrdersCount: number;
  acceptedOrdersCount: number;
  completedOrdersCount: number;
  technicianCancelledCount: number;
  averageRating: number | null;
  ratingsCount: number;
  negativeRatingsCount: number;
  averageCleanlinessRating: number | null;
  complaintsCount: number;
  complaintsUpheldCount: number;
  seriousUpheldComplaint: boolean;
  revisitCount: number;
  platformRevenueCents: number;
  technicianEarningsCents: number;
  orderValueCents: number;
}

export interface KpiScoreResult {
  dimensionScores: KpiDimensionScores;
  weightsApplied: KpiWeightsApplied;
  overallScore: number | null;
  suggestedBonusCents: number | null;
  isEligible: boolean;
  ineligibilityReason: string | null;
}

/**
 * محرك حساب الـKPI الشهري — بيقرأ فقط من الجداول الحقيقية الموجودة أصلاً (orders, ratings,
 * complaints, technician_order_cancellations, order_assignments, wallet_transactions). كل
 * استعلام هنا موثّق في README الموديول ليه بالظبط اختار الفلتر ده — صفر بيانات مخترعة، مطابق
 * لطلب المالك الصريح. نفس فلسفة technicians/technician-stats.processor.ts (raw SQL منفصل عن
 * الموديولات التانية عشان قراءة تجميعية بسيطة مش محتاجة تحميل كل الموديولات).
 */
@Injectable()
export class TechnicianKpiCalculationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  monthBounds(periodYear: number, periodMonth: number): { start: Date; end: Date } {
    const start = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
    const end = new Date(Date.UTC(periodYear, periodMonth, 1));
    return { start, end };
  }

  /** كل الفنيين اللي عندهم أي نشاط حقيقي الشهر ده (طلب مكتمل أو عرض إسناد) — دول بس المرشّحين للحساب. */
  async listActiveTechnicianIds(periodYear: number, periodMonth: number): Promise<string[]> {
    const { start, end } = this.monthBounds(periodYear, periodMonth);
    const rows: Array<{ technician_id: string }> = await this.dataSource.query(
      `
      SELECT DISTINCT technician_id FROM (
        SELECT technician_id FROM orders WHERE technician_id IS NOT NULL AND work_completed_at >= $1 AND work_completed_at < $2 AND deleted_at IS NULL
        UNION
        SELECT oes.technician_id
          FROM order_earning_shares oes
          JOIN orders o ON o.id = oes.order_id
         WHERE o.work_completed_at >= $1 AND o.work_completed_at < $2
           AND o.order_status = 'completed' AND o.deleted_at IS NULL AND oes.deleted_at IS NULL
        UNION
        SELECT technician_id FROM order_assignments WHERE sent_at >= $1 AND sent_at < $2
      ) t
      `,
      [start, end],
    );
    return rows.map((r) => r.technician_id);
  }

  async getRawMetrics(
    technicianProfileId: string,
    technicianUserId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<KpiRawMetrics> {
    const { start, end } = this.monthBounds(periodYear, periodMonth);
    const negativeThreshold = await this.settings.getNumber('kpi.negative_rating_threshold', 2);

    const [ordersRow] = await this.dataSource.query(
      `
      WITH participation AS (
        SELECT o.id, o.order_status,
               o.platform_commission_cents - COALESCE((
                 SELECT SUM(rsr.reversal_cents)
                   FROM refund_settlement_reversals rsr
                  WHERE rsr.order_id = o.id AND rsr.bucket_type = 'platform'
               ), 0) AS net_platform_commission_cents,
               o.technician_earning_cents,
               o.total_amount_cents, COALESCE(oes.share_cents, o.technician_earning_cents) AS my_share_cents
          FROM orders o
          LEFT JOIN order_earning_shares oes
            ON oes.order_id = o.id AND oes.technician_id = $1 AND oes.deleted_at IS NULL
         WHERE o.work_completed_at >= $2 AND o.work_completed_at < $3 AND o.deleted_at IS NULL
           AND (oes.technician_id = $1 OR (
             o.technician_id = $1 AND NOT EXISTS (
               SELECT 1 FROM order_earning_shares any_share
                WHERE any_share.order_id = o.id AND any_share.deleted_at IS NULL
             )
           ))
      )
      SELECT
        COUNT(*) FILTER (WHERE order_status = 'completed') AS completed_orders_count,
        -- **مفيش GREATEST هنا — وده مقصود، مش سهو.** الترقية بتقصّ الطلب الخسران على صفر
        -- (technician-progression-calculation.service.ts) لأن سؤالها «الفني استحقّ إيه؟»،
        -- والفني مايترجّعش لورا بسبب خصم المنصّة موّلته. أما الرقم ده فسؤاله مختلف: «المنصّة
        -- كسبت كام فعلًا من الفني ده؟» — وده رقم **تقريري** بيتعرض زي ما هو، فطرح الطلب
        -- الخسران منه هو **الحقيقة** مش عقوبة. ومابيدخلش في حساب أي درجة: بُعد الإيراد في
        -- الـKPI بيتحسب من technicianEarningsCents ومقصوص على [0,100].
        COALESCE(SUM(CASE WHEN order_status = 'completed' AND technician_earning_cents > 0
          THEN ROUND(net_platform_commission_cents::numeric * my_share_cents / technician_earning_cents)
          ELSE 0 END), 0) AS platform_revenue_cents,
        COALESCE(SUM(CASE WHEN order_status = 'completed' AND technician_earning_cents > 0
          THEN ROUND(total_amount_cents::numeric * my_share_cents / technician_earning_cents)
          ELSE 0 END), 0) AS order_value_cents
      FROM participation
      `,
      [technicianProfileId, start, end],
    );

    const [assignmentsRow] = await this.dataSource.query(
      `
      WITH assignment_activity AS (
        SELECT order_id, assignment_status::text AS assignment_status
          FROM order_assignments
         WHERE technician_id = $1 AND sent_at >= $2 AND sent_at < $3
      ), crew_activity AS (
        SELECT oes.order_id, 'accepted'::text AS assignment_status
          FROM order_earning_shares oes
          JOIN orders o ON o.id = oes.order_id
         WHERE oes.technician_id = $1 AND oes.deleted_at IS NULL
           AND o.work_completed_at >= $2 AND o.work_completed_at < $3
           AND NOT EXISTS (SELECT 1 FROM assignment_activity aa WHERE aa.order_id = oes.order_id)
      ), activity AS (
        SELECT * FROM assignment_activity UNION ALL SELECT * FROM crew_activity
      )
      SELECT
        COUNT(*) FILTER (WHERE assignment_status IN ('accepted', 'rejected', 'timeout', 'cancelled')) AS offered_orders_count,
        COUNT(*) FILTER (WHERE assignment_status = 'accepted') AS accepted_orders_count
      FROM activity
      `,
      [technicianProfileId, start, end],
    );

    const [cancellationsRow] = await this.dataSource.query(
      `SELECT COUNT(*) AS technician_cancelled_count FROM technician_order_cancellations
       WHERE technician_id = $1 AND cancelled_at >= $2 AND cancelled_at < $3`,
      [technicianProfileId, start, end],
    );

    const [ratingsRow] = await this.dataSource.query(
      `
      SELECT
        AVG(r.overall_rating)::numeric(4,2) AS average_rating,
        COUNT(*) AS ratings_count,
        COUNT(*) FILTER (WHERE r.overall_rating::numeric <= $4::numeric) AS negative_ratings_count,
        AVG(r.cleanliness_rating)::numeric(4,2) AS average_cleanliness_rating
      FROM ratings r
      JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
      WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true
        AND r.created_at >= $2 AND r.created_at < $3
      `,
      [technicianProfileId, start, end, negativeThreshold],
    );

    const [complaintsRow] = await this.dataSource.query(
      `
      SELECT
        COUNT(*) AS complaints_count,
        COUNT(*) FILTER (
          WHERE c.complaint_status IN ('resolved', 'closed') AND c.resolution_type IS NOT NULL AND c.resolution_type != 'no_action'
        ) AS complaints_upheld_count,
        BOOL_OR(
          c.severity = 'critical' AND c.complaint_status IN ('resolved', 'closed')
          AND c.resolution_type IS NOT NULL AND c.resolution_type != 'no_action'
        ) AS serious_upheld_complaint
      FROM complaints c
      JOIN technician_profiles tp ON tp.user_id = c.against_user_id
      WHERE tp.id = $1 AND c.created_at >= $2 AND c.created_at < $3
      `,
      [technicianProfileId, start, end],
    );

    const [revisitRow] = await this.dataSource.query(
      `
      SELECT COUNT(*) AS revisit_count
      FROM orders revisit
      JOIN orders original ON original.id = revisit.parent_order_id
      WHERE revisit.order_type = 'revisit' AND original.technician_id = $1
        AND revisit.created_at >= $2 AND revisit.created_at < $3 AND revisit.deleted_at IS NULL
      `,
      [technicianProfileId, start, end],
    );

    // الدخل هنا هو نصيب الشخص المسجل في `order_earning_shares` ناقص عكس الاسترداد الذي خرج
    // فعليًا من محفظته. الاعتماد على ORDER_EARNING credits وحدها كان يسقط شغل الكاش بالكامل
    // (القائد ماسك مستحقه خارج المحفظة) ويسقط أعضاء الطاقم من رقم الطلب الأصلي.
    const [earningsRow] = await this.dataSource.query(
      `
      WITH month_orders AS (
        SELECT o.id, o.technician_earning_cents,
               COALESCE(oes.share_cents, CASE WHEN o.technician_id = $1 THEN o.technician_earning_cents ELSE 0 END) AS my_share_cents
        FROM orders o
        LEFT JOIN order_earning_shares oes
          ON oes.order_id = o.id AND oes.technician_id = $1 AND oes.deleted_at IS NULL
        WHERE (oes.technician_id = $1 OR (
                 o.technician_id = $1 AND NOT EXISTS (
                   SELECT 1 FROM order_earning_shares any_share
                   WHERE any_share.order_id = o.id AND any_share.deleted_at IS NULL
                 )
               ))
          AND o.order_status = 'completed' AND o.work_completed_at >= $3 AND o.work_completed_at < $4
          AND o.deleted_at IS NULL
      )
      SELECT
        GREATEST(0,
          COALESCE((SELECT SUM(my_share_cents) FROM month_orders), 0)
          - COALESCE((
              SELECT SUM(wt.amount_cents)
              FROM refunds r
              JOIN month_orders mo ON mo.id = r.order_id
              JOIN wallet_transactions wt
                ON wt.reference_type = 'refund' AND wt.reference_id = r.id
               AND wt.transaction_type = 'refund' AND wt.direction = 'debit'
              JOIN wallets w ON w.id = wt.wallet_id
              WHERE r.refund_status = 'completed' AND w.owner_user_id = $2
            ), 0)
        ) AS technician_earnings_cents
      `,
      [technicianProfileId, technicianUserId, start, end],
    );

    return {
      offeredOrdersCount: Number(assignmentsRow.offered_orders_count),
      acceptedOrdersCount: Number(assignmentsRow.accepted_orders_count),
      completedOrdersCount: Number(ordersRow.completed_orders_count),
      technicianCancelledCount: Number(cancellationsRow.technician_cancelled_count),
      averageRating: ratingsRow.average_rating === null ? null : Number(ratingsRow.average_rating),
      ratingsCount: Number(ratingsRow.ratings_count),
      negativeRatingsCount: Number(ratingsRow.negative_ratings_count),
      averageCleanlinessRating:
        ratingsRow.average_cleanliness_rating === null ? null : Number(ratingsRow.average_cleanliness_rating),
      complaintsCount: Number(complaintsRow.complaints_count),
      complaintsUpheldCount: Number(complaintsRow.complaints_upheld_count),
      seriousUpheldComplaint: Boolean(complaintsRow.serious_upheld_complaint),
      revisitCount: Number(revisitRow.revisit_count),
      platformRevenueCents: Number(ordersRow.platform_revenue_cents),
      technicianEarningsCents: Number(earningsRow.technician_earnings_cents),
      orderValueCents: Number(ordersRow.order_value_cents),
    };
  }

  /** متوسط أرباح كل الفنيين النشطين الشهر ده — أساس بُعد "الإيراد النسبي" (مش رقم مطلق مكتوب في الكود). */
  async getPlatformAverageEarningsCents(periodYear: number, periodMonth: number): Promise<number> {
    const { start, end } = this.monthBounds(periodYear, periodMonth);
    const [row] = await this.dataSource.query(
      `
      WITH month_orders AS (
        SELECT o.id, o.technician_id, o.technician_earning_cents
        FROM orders o
        WHERE o.order_status = 'completed' AND o.work_completed_at >= $1 AND o.work_completed_at < $2
          AND o.deleted_at IS NULL
      ),
      gross AS (
        SELECT oes.technician_id, SUM(oes.share_cents)::bigint AS gross_cents
        FROM month_orders mo
        JOIN order_earning_shares oes ON oes.order_id = mo.id AND oes.deleted_at IS NULL
        GROUP BY oes.technician_id
        UNION ALL
        SELECT mo.technician_id, SUM(mo.technician_earning_cents)::bigint
        FROM month_orders mo
        WHERE mo.technician_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM order_earning_shares oes WHERE oes.order_id = mo.id AND oes.deleted_at IS NULL
          )
        GROUP BY mo.technician_id
      ),
      gross_by_tech AS (
        SELECT technician_id, SUM(gross_cents)::bigint AS gross_cents FROM gross GROUP BY technician_id
      ),
      reversals AS (
        SELECT tp.id AS technician_id, SUM(wt.amount_cents)::bigint AS reversal_cents
        FROM month_orders mo
        JOIN refunds r ON r.order_id = mo.id AND r.refund_status = 'completed'
        JOIN wallet_transactions wt
          ON wt.reference_type = 'refund' AND wt.reference_id = r.id
         AND wt.transaction_type = 'refund' AND wt.direction = 'debit'
        JOIN wallets w ON w.id = wt.wallet_id
        JOIN technician_profiles tp ON tp.user_id = w.owner_user_id
        GROUP BY tp.id
      )
      SELECT COALESCE(AVG(GREATEST(0, gross_by_tech.gross_cents - COALESCE(reversals.reversal_cents, 0))), 0) AS avg_earnings
      FROM gross_by_tech
      LEFT JOIN reversals ON reversals.technician_id = gross_by_tech.technician_id
      `,
      [start, end],
    );
    return Number(row.avg_earnings);
  }

  async score(metrics: KpiRawMetrics, platformAverageEarningsCents: number): Promise<KpiScoreResult> {
    const [
      weightRating,
      weightCancellation,
      weightComplaints,
      weightAcceptance,
      weightCompletion,
      weightRevenue,
      penaltyPerUpheldComplaint,
      seriousComplaintZeroScore,
      minCompletedJobs,
      monthlyMaxBonusCents,
    ] = await Promise.all([
      this.settings.getNumber('kpi.weight_rating', 30),
      this.settings.getNumber('kpi.weight_cancellation', 15),
      this.settings.getNumber('kpi.weight_complaints', 15),
      this.settings.getNumber('kpi.weight_acceptance', 15),
      this.settings.getNumber('kpi.weight_completion', 15),
      this.settings.getNumber('kpi.weight_revenue', 10),
      this.settings.getNumber('kpi.penalty_points_per_upheld_complaint', 20),
      this.settings.getBoolean('kpi.serious_complaint_zero_score', true),
      this.settings.getNumber('kpi.min_completed_jobs_for_eligibility', 3),
      this.settings.getNumber('kpi.monthly_max_bonus_cents', 500000),
    ]);

    const weightsApplied: KpiWeightsApplied = {
      rating: weightRating,
      cancellation: weightCancellation,
      complaints: weightComplaints,
      acceptance: weightAcceptance,
      completion: weightCompletion,
      revenue: weightRevenue,
    };

    const dimensionScores: KpiDimensionScores = {};

    if (metrics.ratingsCount > 0 && metrics.averageRating !== null) {
      dimensionScores.rating = this.clamp(((metrics.averageRating - 1) / 4) * 100);
    }

    if (metrics.acceptedOrdersCount > 0) {
      const cancellationRate = metrics.technicianCancelledCount / metrics.acceptedOrdersCount;
      dimensionScores.cancellation = this.clamp(100 - cancellationRate * 100);
    }

    if (metrics.completedOrdersCount > 0) {
      dimensionScores.complaints = this.clamp(100 - metrics.complaintsUpheldCount * penaltyPerUpheldComplaint);
    }

    if (metrics.offeredOrdersCount > 0) {
      dimensionScores.acceptance = this.clamp((metrics.acceptedOrdersCount / metrics.offeredOrdersCount) * 100);
    }

    if (metrics.acceptedOrdersCount > 0) {
      dimensionScores.completion = this.clamp((metrics.completedOrdersCount / metrics.acceptedOrdersCount) * 100);
    }

    if (platformAverageEarningsCents > 0 && metrics.completedOrdersCount > 0) {
      dimensionScores.revenue = this.clamp((metrics.technicianEarningsCents / platformAverageEarningsCents) * 100);
    }

    const dimensionKeys = Object.keys(dimensionScores) as Array<keyof KpiDimensionScores>;
    let overallScore: number | null = null;
    if (dimensionKeys.length > 0) {
      const totalWeight = dimensionKeys.reduce((sum, key) => sum + weightsApplied[key], 0);
      if (totalWeight > 0) {
        overallScore = this.clamp(
          dimensionKeys.reduce((sum, key) => sum + (dimensionScores[key] as number) * weightsApplied[key], 0) /
            totalWeight,
        );
      }
    }

    // شكوى حرجة مثبتة تصفّر الدرجة بالكامل لو الإعداد مفعّل — "serious events force zero KPI".
    if (seriousComplaintZeroScore && metrics.seriousUpheldComplaint) {
      overallScore = 0;
    }

    const isEligible = metrics.completedOrdersCount >= minCompletedJobs;
    const ineligibilityReason = isEligible
      ? null
      : `أقل من الحد الأدنى للطلبات المكتملة الشهر ده (${metrics.completedOrdersCount}/${minCompletedJobs})`;

    const suggestedBonusCents =
      isEligible && overallScore !== null ? Math.round((monthlyMaxBonusCents * overallScore) / 100) : null;

    return { dimensionScores, weightsApplied, overallScore, suggestedBonusCents, isEligible, ineligibilityReason };
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
  }
}
