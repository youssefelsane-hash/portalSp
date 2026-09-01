import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UnmetRequirement } from './entities/technician-progression-status.entity';
import { TechnicianProgressionRule } from './entities/technician-progression-rule.entity';

export interface ProgressionRawMetrics {
  completedOrdersCount: number;
  acceptedOrdersCount: number;
  technicianCancelledCount: number;
  cancellationRate: number | null;
  averageRating: number | null;
  ratingsCount: number;
  platformRevenueCents: number;
  upheldComplaintsCount: number;
  daysActive: number;
  avgKpiScore: number | null;
  kpiMonthsAvailable: number;
}

export interface ProgressionEvaluation {
  isEligible: boolean;
  unmetRequirements: UnmetRequirement[];
  progress: Record<string, number>;
  needsDemotionReview: boolean;
  demotionReviewReason: string | null;
}

/**
 * محرك حساب أهلية الترقية — بيقرأ بس من جداول موجودة أصلاً (orders, ratings, complaints,
 * technician_order_cancellations, wallet_transactions عبر platform_commission_cents،
 * technician_kpi_snapshots). كل المقاييس هنا "طول العمر" (all-time) مش شهرية زي KPI —
 * المسار الوظيفي عن السجل التراكمي مش أداء شهر واحد.
 */
@Injectable()
export class TechnicianProgressionCalculationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getRawMetrics(
    technicianProfileId: string,
    technicianUserId: string,
    approvedAt: Date | null,
    createdAt: Date,
    minKpiMonthsCount: number,
  ): Promise<ProgressionRawMetrics> {
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
               COALESCE(oes.share_cents, o.technician_earning_cents) AS my_share_cents
        FROM orders o
        LEFT JOIN order_earning_shares oes
          ON oes.order_id = o.id AND oes.technician_id = $1 AND oes.deleted_at IS NULL
        WHERE o.deleted_at IS NULL
          AND (oes.technician_id = $1 OR (
            o.technician_id = $1 AND NOT EXISTS (
              SELECT 1 FROM order_earning_shares any_share
              WHERE any_share.order_id = o.id AND any_share.deleted_at IS NULL
            )
          ))
      )
      SELECT
        COUNT(*) FILTER (WHERE order_status = 'completed') AS completed_orders_count,
        COALESCE(SUM(
          CASE WHEN order_status = 'completed' AND technician_earning_cents > 0
            THEN ROUND(net_platform_commission_cents::numeric * my_share_cents / technician_earning_cents)
            ELSE 0 END
        ), 0) AS platform_revenue_cents
      FROM participation
      `,
      [technicianProfileId],
    );

    const [acceptedRow] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT order_id) AS accepted_orders_count
         FROM (
           SELECT order_id FROM order_assignments WHERE technician_id = $1 AND assignment_status = 'accepted'
           UNION
           SELECT order_id FROM order_earning_shares WHERE technician_id = $1 AND deleted_at IS NULL
         ) accepted_participation`,
      [technicianProfileId],
    );

    const [cancellationsRow] = await this.dataSource.query(
      `SELECT COUNT(*) AS technician_cancelled_count FROM technician_order_cancellations WHERE technician_id = $1`,
      [technicianProfileId],
    );

    const [ratingsRow] = await this.dataSource.query(
      `
      SELECT AVG(r.overall_rating)::numeric(4,2) AS average_rating, COUNT(*) AS ratings_count
      FROM ratings r
      JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
      WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true
      `,
      [technicianProfileId],
    );

    const [complaintsRow] = await this.dataSource.query(
      `
      SELECT COUNT(*) AS upheld_complaints_count
      FROM complaints c
      JOIN technician_profiles tp ON tp.user_id = c.against_user_id
      WHERE tp.id = $1 AND c.complaint_status IN ('resolved', 'closed')
        AND c.resolution_type IS NOT NULL AND c.resolution_type != 'no_action'
      `,
      [technicianProfileId],
    );

    const kpiRows: Array<{ overall_score: string | null }> = await this.dataSource.query(
      `
      SELECT overall_score FROM technician_kpi_snapshots
      WHERE technician_id = $1 AND status IN ('approved', 'paid') AND overall_score IS NOT NULL
      ORDER BY period_year DESC, period_month DESC
      LIMIT $2
      `,
      [technicianProfileId, minKpiMonthsCount],
    );

    const acceptedOrdersCount = Number(acceptedRow.accepted_orders_count);
    const technicianCancelledCount = Number(cancellationsRow.technician_cancelled_count);
    const kpiScores = kpiRows.map((r) => Number(r.overall_score));
    const referenceDate = approvedAt ?? createdAt;
    const daysActive = Math.max(0, Math.floor((Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      completedOrdersCount: Number(ordersRow.completed_orders_count),
      acceptedOrdersCount,
      technicianCancelledCount,
      cancellationRate: acceptedOrdersCount > 0 ? (technicianCancelledCount / acceptedOrdersCount) * 100 : null,
      averageRating: ratingsRow.average_rating === null ? null : Number(ratingsRow.average_rating),
      ratingsCount: Number(ratingsRow.ratings_count),
      platformRevenueCents: Number(ordersRow.platform_revenue_cents),
      upheldComplaintsCount: Number(complaintsRow.upheld_complaints_count),
      daysActive,
      avgKpiScore: kpiScores.length > 0 ? kpiScores.reduce((a, b) => a + b, 0) / kpiScores.length : null,
      kpiMonthsAvailable: kpiScores.length,
    };
  }

  evaluate(metrics: ProgressionRawMetrics, rule: TechnicianProgressionRule | null): ProgressionEvaluation {
    if (!rule || !rule.enabled) {
      return { isEligible: false, unmetRequirements: [], progress: {}, needsDemotionReview: false, demotionReviewReason: null };
    }

    const unmet: UnmetRequirement[] = [];
    const progress: Record<string, number> = {};

    const checkGte = (key: string, labelAr: string, current: number | null, required: number) => {
      progress[key] = required > 0 ? Math.min(100, Math.round(((current ?? 0) / required) * 100)) : 100;
      if (current === null || current < required) {
        unmet.push({ key, labelAr, currentValue: current, requiredValue: required, comparator: 'gte' });
      }
    };
    const checkLte = (key: string, labelAr: string, current: number | null, required: number) => {
      progress[key] = current === null ? 100 : current <= required ? 100 : Math.max(0, Math.round((required / current) * 100));
      if (current !== null && current > required) {
        unmet.push({ key, labelAr, currentValue: current, requiredValue: required, comparator: 'lte' });
      }
    };

    checkGte('completed_orders', 'عدد الطلبات المكتملة', metrics.completedOrdersCount, rule.minCompletedOrders);
    checkGte('platform_revenue_cents', 'الإيراد المُحقّق للمنصة', metrics.platformRevenueCents, Number(rule.minPlatformRevenueCents));
    checkGte('days_active', 'أيام النشاط على المنصة', metrics.daysActive, rule.minDaysActive);

    if (rule.minAvgRating !== null) {
      checkGte('average_rating', 'متوسط التقييم', metrics.averageRating, Number(rule.minAvgRating));
    }
    if (rule.maxCancellationRate !== null) {
      checkLte('cancellation_rate', 'معدل الإلغاء', metrics.cancellationRate, Number(rule.maxCancellationRate));
    }
    if (rule.maxUpheldComplaints !== null) {
      checkLte('upheld_complaints', 'الشكاوى المثبتة', metrics.upheldComplaintsCount, rule.maxUpheldComplaints);
    }
    if (rule.minAvgKpiScore !== null) {
      const hasEnoughHistory = metrics.kpiMonthsAvailable >= rule.minKpiMonthsCount;
      checkGte(
        'avg_kpi_score',
        `متوسط درجة الـKPI (آخر ${rule.minKpiMonthsCount} شهر)`,
        hasEnoughHistory ? metrics.avgKpiScore : null,
        Number(rule.minAvgKpiScore),
      );
    }

    let needsDemotionReview = false;
    let demotionReviewReason: string | null = null;
    if (rule.enableDemotionReview) {
      const reasons: string[] = [];
      if (
        rule.demotionReviewMaxCancellationRate !== null &&
        metrics.cancellationRate !== null &&
        metrics.cancellationRate > Number(rule.demotionReviewMaxCancellationRate)
      ) {
        reasons.push(`معدل الإلغاء (${metrics.cancellationRate.toFixed(1)}%) تخطّى الحد (${rule.demotionReviewMaxCancellationRate}%)`);
      }
      if (
        rule.demotionReviewMinAvgRating !== null &&
        metrics.averageRating !== null &&
        metrics.averageRating < Number(rule.demotionReviewMinAvgRating)
      ) {
        reasons.push(`متوسط التقييم (${metrics.averageRating}) أقل من الحد (${rule.demotionReviewMinAvgRating})`);
      }
      if (
        rule.demotionReviewMaxUpheldComplaints !== null &&
        metrics.upheldComplaintsCount > rule.demotionReviewMaxUpheldComplaints
      ) {
        reasons.push(`الشكاوى المثبتة (${metrics.upheldComplaintsCount}) تخطّت الحد (${rule.demotionReviewMaxUpheldComplaints})`);
      }
      if (reasons.length > 0) {
        needsDemotionReview = true;
        demotionReviewReason = reasons.join('؛ ');
      }
    }

    return { isEligible: unmet.length === 0, unmetRequirements: unmet, progress, needsDemotionReview, demotionReviewReason };
  }
}
