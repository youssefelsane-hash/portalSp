import { SettingsService } from '../settings/settings.service';

export interface CandidateQualityRankingSettings {
  workloadWeight: number;
  fairnessLookbackDays: number;
  fairnessDeclineWeight: number;
  fairnessWeight: number;
  reliabilityBaselineRating: number;
  reliabilityWeight: number;
  reliabilityMinRatingsCount: number;
}

export async function resolveCandidateQualityRankingSettings(
  settings: SettingsService,
): Promise<CandidateQualityRankingSettings> {
  const [
    workloadWeight,
    fairnessLookbackDays,
    fairnessDeclineWeight,
    fairnessWeight,
    reliabilityBaselineRating,
    reliabilityWeight,
    reliabilityMinRatingsCount,
  ] = await Promise.all([
    settings.getNumber('matching.workload_balance_weight', 2),
    settings.getNumber('matching.fairness_lookback_days', 7),
    settings.getNumber('matching.fairness_decline_weight', 0.5),
    settings.getNumber('matching.fairness_weight', 0),
    settings.getNumber('matching.reliability_baseline_rating', 4),
    settings.getNumber('matching.reliability_weight', 0),
    settings.getNumber('matching.reliability_min_ratings_count', 3),
  ]);
  return {
    workloadWeight,
    fairnessLookbackDays,
    fairnessDeclineWeight,
    fairnessWeight,
    reliabilityBaselineRating,
    reliabilityWeight,
    reliabilityMinRatingsCount,
  };
}

/** جودة المرشح دون المسافة؛ المطابقة الرئيسية والمساعدون يستخدمان المعادلة نفسها. */
export function candidateQualityScoreSql(opts: {
  workloadWeightParam: string;
  fairnessWeightParam: string;
  reliabilityBaselineParam: string;
  reliabilityWeightParam: string;
  reliabilityMinRatingsParam: string;
  technicianAlias?: string;
}): string {
  const tp = opts.technicianAlias ?? 'tp';
  return `(
    COALESCE(tlc.order_priority_weight, 0)
    - COALESCE(workload.active_count, 0) * ${opts.workloadWeightParam}::numeric
    - COALESCE(fairness.recent_effective_workload, 0) * ${opts.fairnessWeightParam}::numeric
    + CASE WHEN ${tp}.total_ratings_count >= ${opts.reliabilityMinRatingsParam}::int
        THEN (${tp}.average_rating - ${opts.reliabilityBaselineParam}::numeric)
          * ${opts.reliabilityWeightParam}::numeric
        ELSE 0
      END
  )`;
}

/**
 * حمل وعدالة المساعد يحتسبان الطلبات التي قادها والطلبات التي شارك فيها، فلا يحصل على أفضلية
 * زائفة لمجرد أن التزامه محفوظ في order_team_members بدل orders.technician_id.
 */
export function assistantCandidateRankingJoinsSql(opts: {
  activeStatusesParam: string;
  fairnessLookbackDaysParam: string;
  fairnessDeclineWeightParam: string;
  technicianAlias?: string;
}): string {
  const tp = opts.technicianAlias ?? 'tp';
  return `
    LEFT JOIN technician_level_config tlc ON tlc.level = ${tp}.current_level
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS active_count
      FROM (
        SELECT active_order.id
        FROM orders active_order
        WHERE active_order.technician_id = ${tp}.id
          AND active_order.order_status = ANY(${opts.activeStatusesParam}::order_status[])
          AND active_order.deleted_at IS NULL
        UNION
        SELECT member_order.id
        FROM order_team_members active_member
        JOIN orders member_order ON member_order.id = active_member.order_id
        WHERE active_member.technician_id = ${tp}.id
          AND member_order.order_status = ANY(${opts.activeStatusesParam}::order_status[])
          AND member_order.deleted_at IS NULL
      ) committed
    ) workload ON true
    LEFT JOIN LATERAL (
      SELECT (
        (SELECT COUNT(*) FROM (
          SELECT recent_order.id
          FROM orders recent_order
          WHERE recent_order.technician_id = ${tp}.id
            AND recent_order.assigned_at >= now() - (${opts.fairnessLookbackDaysParam} || ' days')::interval
            AND recent_order.deleted_at IS NULL
          UNION
          SELECT recent_member.order_id
          FROM order_team_members recent_member
          WHERE recent_member.technician_id = ${tp}.id
            AND recent_member.created_at >= now() - (${opts.fairnessLookbackDaysParam} || ' days')::interval
        ) recent_committed)
        + ${opts.fairnessDeclineWeightParam}::numeric * (
          (SELECT COUNT(*) FROM order_assistant_offers rejected_offer
           WHERE rejected_offer.assistant_technician_id = ${tp}.id
             AND rejected_offer.offer_status = 'rejected'
             AND rejected_offer.sent_at >= now() - (${opts.fairnessLookbackDaysParam} || ' days')::interval)
          + (SELECT COUNT(*) FROM technician_work_opportunities declined_opportunity
             WHERE declined_opportunity.technician_id = ${tp}.id
               AND declined_opportunity.status = 'declined'
               AND declined_opportunity.offered_at >= now() - (${opts.fairnessLookbackDaysParam} || ' days')::interval
               AND declined_opportunity.deleted_at IS NULL)
        )
      ) AS recent_effective_workload
    ) fairness ON true`;
}
