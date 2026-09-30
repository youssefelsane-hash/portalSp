import { SettingsService } from '../settings/settings.service';
import { MIN_PUNCTUALITY_SAMPLE_FALLBACK, ON_TIME_GRACE_MINUTES } from '../technicians/technician-arrival-metrics';

/**
 * docs/08 §189 بند D-2 — افتراضيات الموثوقية بقت **صغيرة ومش صفر** (طلب مالك: «مش نقفز من 0 لرقم كبير»).
 * المقياس للمقارنة: فرق مستوى واحد = 10 نقط، وكل طلب نشط = 2.
 * - الالتزام: فني وصل في معاده دايمًا ⇒ +0.75، نص المرات ⇒ −1.75، أبدًا ⇒ −4.25 (أقل من نص مستوى).
 * - التقييم: 5 نجوم ⇒ +2، 3 نجوم ⇒ −2.
 */
export const PUNCTUALITY_WEIGHT_FALLBACK = 5;
export const PUNCTUALITY_BASELINE_PERCENT_FALLBACK = 85;
export const RELIABILITY_WEIGHT_FALLBACK = 2;

export interface CandidateQualityRankingSettings {
  workloadWeight: number;
  fairnessLookbackDays: number;
  fairnessDeclineWeight: number;
  fairnessWeight: number;
  reliabilityBaselineRating: number;
  reliabilityWeight: number;
  reliabilityMinRatingsCount: number;
  punctualityWeight: number;
  punctualityBaselinePercent: number;
  punctualityMinSample: number;
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
    punctualityWeight,
    punctualityBaselinePercent,
    punctualityMinSample,
  ] = await Promise.all([
    settings.getNumber('matching.workload_balance_weight', 2),
    settings.getNumber('matching.fairness_lookback_days', 7),
    settings.getNumber('matching.fairness_decline_weight', 0.5),
    settings.getNumber('matching.fairness_weight', 0),
    settings.getNumber('matching.reliability_baseline_rating', 4),
    settings.getNumber('matching.reliability_weight', RELIABILITY_WEIGHT_FALLBACK),
    settings.getNumber('matching.reliability_min_ratings_count', 3),
    settings.getNumber('matching.punctuality_weight', PUNCTUALITY_WEIGHT_FALLBACK),
    settings.getNumber('matching.punctuality_baseline_percent', PUNCTUALITY_BASELINE_PERCENT_FALLBACK),
    settings.getNumber('matching.min_punctuality_sample', MIN_PUNCTUALITY_SAMPLE_FALLBACK),
  ]);
  return {
    workloadWeight,
    fairnessLookbackDays,
    fairnessDeclineWeight,
    fairnessWeight,
    reliabilityBaselineRating,
    reliabilityWeight,
    reliabilityMinRatingsCount,
    punctualityWeight,
    punctualityBaselinePercent,
    punctualityMinSample,
  };
}

/**
 * **الالتزام بالمواعيد في الترتيب** (docs/08 §189 بند D-2) — نفس مقياس «الالتزام بالمواعيد» اللي العميل
 * بيشوفه على كارت الفني بالحرف (`technicians.service.ts`، ADR-0099): زيارات مجدولة ليها وقت وصول، ووصل
 * خلال ${ON_TIME_GRACE_MINUTES} دقيقة من الموعد. مقياس واحد للعرض وللترتيب، مش اتنين.
 *
 * **محايد تحت الحد الأدنى للعيّنة** (`matching.min_punctuality_sample` — نفس حد العرض): فني جديد أو
 * زيارتين بس مابيتعاقبش ولا بيتكافئ. ووزن صفر = الاستعلام الداخلي مابيتنفّذش أصلاً (one-time filter).
 */
export function candidatePunctualityAdjustmentSql(opts: {
  weightParam: string;
  baselinePercentParam: string;
  minSampleParam: string;
  technicianAlias?: string;
}): string {
  const tp = opts.technicianAlias ?? 'tp';
  return `COALESCE((
    SELECT CASE WHEN COUNT(*) >= GREATEST(${opts.minSampleParam}::int, 1)
      THEN (
        COUNT(*) FILTER (
          WHERE punctual.technician_arrived_at <= punctual.scheduled_at + interval '${ON_TIME_GRACE_MINUTES} minutes'
        ) * 100.0 / COUNT(*)
        - ${opts.baselinePercentParam}::numeric
      ) / 100.0 * ${opts.weightParam}::numeric
      ELSE 0 END
    FROM orders punctual
    WHERE ${opts.weightParam}::numeric <> 0
      AND punctual.technician_id = ${tp}.id
      AND punctual.scheduled_at IS NOT NULL
      AND punctual.technician_arrived_at IS NOT NULL
      AND punctual.deleted_at IS NULL
  ), 0)`;
}

/** جودة المرشح دون المسافة؛ المطابقة الرئيسية والمساعدون يستخدمان المعادلة نفسها. */
export function candidateQualityScoreSql(opts: {
  workloadWeightParam: string;
  fairnessWeightParam: string;
  reliabilityBaselineParam: string;
  reliabilityWeightParam: string;
  reliabilityMinRatingsParam: string;
  punctualityWeightParam: string;
  punctualityBaselineParam: string;
  punctualityMinSampleParam: string;
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
    + ${candidatePunctualityAdjustmentSql({
      weightParam: opts.punctualityWeightParam,
      baselinePercentParam: opts.punctualityBaselineParam,
      minSampleParam: opts.punctualityMinSampleParam,
      technicianAlias: tp,
    })}
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
