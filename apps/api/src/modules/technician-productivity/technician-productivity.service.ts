import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { TechnicianKpiSnapshot } from '../technician-kpi/entities/technician-kpi-snapshot.entity';
import {
  DEFAULT_PRODUCTIVITY_METRICS_CONFIG,
  PRODUCTIVITY_METRIC_LABELS_AR,
  ProductivityMetricConfig,
  ProductivityMetricKey,
  ProductivityMetricsConfig,
} from './productivity-metrics-config';

export interface ProductivityMetricBreakdown {
  key: ProductivityMetricKey;
  label_ar: string;
  enabled: boolean;
  included: boolean;
  exclusion_reason: string | null;
  raw_value: number | null;
  normalized_score: number | null;
  weight_configured: number;
  weight_applied: number | null;
  sample_size: number;
}

/** الشهر اللي الـsnapshot بيمثّله + امتى اتحسب — عشان الأدمن يعرف **على إيه** التقرير مبني. */
export interface ProductivitySnapshotPeriod {
  period_year: number;
  period_month: number;
  calculated_at: string | null;
}

/**
 * **سياق التقييمات** (بلاغ مالك 2026-09-17).
 *
 * اللقطة كانت بتوري بروفايل فيه «متوسط التقييم: 4.26 (19 تقييم)»، وتحتها في نفس الصفحة تقرير
 * إنتاجية بيقول «تقييم العملاء — عينة غير كافية». الرقمين **الاتنين صح**، بس بيقيسوا حاجتين
 * مختلفتين، ومفيش في الشاشة حاجة بتقول كده — فالأدمن بيقرا تناقض.
 *
 * الفرق الحقيقي (اتأكد حيًا في `scripts/verify-kpi-rating-sample.js`):
 *   - رقم البروفايل **حيّ ومدى الحياة**: كل تقييم `customer_to_technician` منشور، بلا حد زمني.
 *   - رقم الإنتاجية **مجمّد وشهري**: بيتقرا من `technician_kpi_snapshots`، وكل snapshot بيحسب
 *     تقييمات شهره **وقت الحساب بس**.
 *
 * فأي تقييم بيوصل بعد حساب snapshot شهره يفضل **بره** التقرير لحد إعادة حساب يدوية — والـKPI
 * ملزوق بالصرف (بيتقفل على approved/paid)، فمينفعش يتحسب تلقائي. الحل إن التناقض يتشرح بالأرقام
 * مش يتخفي: الحقول دي بتخلي الأدمن يشوف الفرق ويعرف إن المطلوب إعادة حساب.
 */
export interface ProductivityRatingContext {
  /** التقييم العام للفني — حيّ من `ratings`، بنفس فلتر البروفايل بالحرف. */
  lifetime_average: number | null;
  lifetime_ratings_count: number;
  /** تقييم الفترة اللي الـKPI اعتمد عليها فعلاً (موزون بعدد تقييمات كل شهر). */
  period_average: number | null;
  /** **عدد تقييمات العملاء الفعلية** جوّه الفترة — مجموع `ratings_count` في الـsnapshots. */
  period_ratings_count: number;
  /** عدد الشهور اللي فيها تقييم — **ده اللي `sample_size` بيقيسه**، مش عدد التقييمات. */
  months_with_rating_data: number;
  /** نفس نافذة الفترة بس محسوبة **حيّة** من `ratings` — للمقارنة بالمجمّد. */
  live_ratings_in_period: number;
  /** تقييمات موجودة في الفترة ومش داخلة الـsnapshots (وصلت بعد آخر حساب). */
  ratings_missing_from_snapshots: number;
  /** `true` معناها التقرير مبني على snapshot قديم — محتاج إعادة حساب للشهور المذكورة. */
  is_stale: boolean;
}

export interface ProductivityReport {
  technician_id: string;
  evaluation_period_months: number;
  snapshots_found: number;
  /** الشهور اللي التقرير مبني عليها فعلاً — أحدث `evaluation_period_months` snapshot موجود. */
  snapshot_periods: ProductivitySnapshotPeriod[];
  /** أول وآخر لحظة في نافذة الـsnapshots المستخدمة (ISO)، `null` لو مفيش snapshots. */
  period_start: string | null;
  period_end: string | null;
  overall_score: number | null;
  explanation: string;
  rating_context: ProductivityRatingContext;
  breakdown: ProductivityMetricBreakdown[];
}

/**
 * إنتاجية configurable (docs/08 §14) — طبقة تسجيل موزون ثانية فوق نفس بيانات
 * `technician_kpi_snapshots` الحقيقية الموجودة بالفعل (KPI الشهري)، **مفيش جمع بيانات جديد ولا
 * جدول جديد** (قرار Phase 1 صريح: حسابي بالكامل، مفيش تخزين/موافقة — راجع README). بتختلف عن KPI
 * في حاجتين بس: (1) تجميع عبر فترة قابلة للتحكم (شهر واحد أو أكتر، مش شهر واحد ثابت)، (2) تفعيل/
 * تعطيل + حجم عينة أدنى + اتجاه لكل مقياس على حدة (KPI عنده وزن بس، مفيش toggle/عينة/اتجاه منفصلين).
 * `monthly_kpi_score` نفسه بيتحط كمقياس من ضمن المقاييس (توجيه المالك الصريح: "يتكامل مع KPI...
 * بدل محرك أداء موازٍ جديد") — مش بيتحسب تاني، بيتاخد كما هو من الـsnapshots.
 */
@Injectable()
export class TechnicianProductivityService {
  constructor(
    @InjectRepository(TechnicianKpiSnapshot) private readonly snapshots: Repository<TechnicianKpiSnapshot>,
    private readonly settingsService: SettingsService,
    // القراءة الحيّة من `ratings` **للسياق بس** — تعريف الـKPI ما اتغيّرش، ولا المقياس بيتحسب
    // من غير الـsnapshots. الغرض إن الأدمن يشوف الفرق بين المجمّد والحيّ بدل ما يشوف تناقض.
    private readonly dataSource: DataSource,
  ) {}

  private async getConfig(): Promise<ProductivityMetricsConfig> {
    return this.settingsService.getJson<ProductivityMetricsConfig>(
      'productivity.metrics_config',
      DEFAULT_PRODUCTIVITY_METRICS_CONFIG,
    );
  }

  async computeForTechnician(technicianId: string, months?: number): Promise<ProductivityReport> {
    const evaluationPeriodMonths =
      months ?? (await this.settingsService.getNumber('productivity.default_evaluation_period_months', 1));
    const config = await this.getConfig();

    const rows = await this.snapshots.find({
      where: { technicianId },
      order: { periodYear: 'DESC', periodMonth: 'DESC' },
      take: Math.max(1, evaluationPeriodMonths),
    });

    const breakdown: ProductivityMetricBreakdown[] = [];
    let weightedSum = 0;
    let weightSum = 0;

    for (const key of Object.keys(config) as ProductivityMetricKey[]) {
      const metricConfig = config[key];
      const computed = this.computeMetric(key, metricConfig, rows);
      breakdown.push(computed);
      if (computed.included && computed.normalized_score !== null && computed.weight_applied !== null) {
        weightedSum += computed.normalized_score * computed.weight_applied;
        weightSum += computed.weight_applied;
      }
    }

    const overallScore = weightSum > 0 ? Math.round((weightedSum / weightSum) * 100) / 100 : null;
    const includedCount = breakdown.filter((b) => b.included).length;
    const { start, end } = snapshotWindow(rows);
    const ratingContext = await this.buildRatingContext(technicianId, rows, start, end);

    return {
      technician_id: technicianId,
      evaluation_period_months: evaluationPeriodMonths,
      snapshots_found: rows.length,
      snapshot_periods: rows.map((r) => ({
        period_year: r.periodYear,
        period_month: r.periodMonth,
        calculated_at: r.calculatedAt ? new Date(r.calculatedAt).toISOString() : null,
      })),
      period_start: start ? start.toISOString() : null,
      period_end: end ? end.toISOString() : null,
      overall_score: overallScore,
      explanation:
        overallScore === null
          ? 'مفيش بيانات كفاية لحساب درجة إنتاجية — كل المقاييس المفعّلة عينتها أصغر من الحد الأدنى المطلوب.'
          : `الدرجة محسوبة من ${includedCount} مقياس مفعّل وعنده بيانات كفاية، من أصل ${breakdown.filter((b) => b.enabled).length} مقياس مفعّل.`,
      rating_context: ratingContext,
      breakdown,
    };
  }

  /**
   * بيجمع أرقام التقييم الأربعة اللي الأدمن محتاج يفرّق بينها.
   *
   * **نفس فلتر البروفايل بالحرف** (`customer_to_technician` + `is_published`) — الفلتر ده هو
   * اللي `technician-stats.processor.ts` بيحدّث بيه `technician_profiles.average_rating`، فلو
   * الرقمين اختلفوا يبقى السبب **الزمن** مش الفلتر. ده اللي خلّى التحقيق يستبعد "فلتر غلط"
   * و"نوع تقييم غلط" كأسباب من أول خطوة.
   */
  private async buildRatingContext(
    technicianProfileId: string,
    rows: TechnicianKpiSnapshot[],
    start: Date | null,
    end: Date | null,
  ): Promise<ProductivityRatingContext> {
    const withRatings = rows.filter((r) => r.averageRating !== null && r.ratingsCount > 0);
    const periodRatingsCount = withRatings.reduce((acc, r) => acc + r.ratingsCount, 0);
    const periodAverage =
      periodRatingsCount > 0
        ? withRatings.reduce((acc, r) => acc + Number(r.averageRating) * r.ratingsCount, 0) / periodRatingsCount
        : null;

    const [lifetime] = await this.dataSource.query<{ avg: string | null; n: string }[]>(
      `SELECT AVG(r.overall_rating) AS avg, COUNT(*) AS n
         FROM ratings r
         JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
        WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true`,
      [technicianProfileId],
    );

    let liveInPeriod = 0;
    if (start && end) {
      const [live] = await this.dataSource.query<{ n: string }[]>(
        `SELECT COUNT(*) AS n
           FROM ratings r
           JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
          WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true
            AND r.created_at >= $2 AND r.created_at < $3`,
        [technicianProfileId, start, end],
      );
      liveInPeriod = Number(live.n);
    }

    // الفرق ما بينفعش يبقى سالب: لو الـsnapshot فيه أكتر من الحيّ (تقييم اتشال/اتحجب بعد
    // الحساب) فده مش تقادم، وبيتعامل معاه كصفر بدل ما يطلع رقم سالب مربك للأدمن.
    const missing = Math.max(0, liveInPeriod - periodRatingsCount);

    return {
      lifetime_average: lifetime.avg === null ? null : Math.round(Number(lifetime.avg) * 100) / 100,
      lifetime_ratings_count: Number(lifetime.n),
      period_average: periodAverage === null ? null : Math.round(periodAverage * 100) / 100,
      period_ratings_count: periodRatingsCount,
      months_with_rating_data: withRatings.length,
      live_ratings_in_period: liveInPeriod,
      ratings_missing_from_snapshots: missing,
      is_stale: missing > 0,
    };
  }

  private computeMetric(
    key: ProductivityMetricKey,
    metricConfig: ProductivityMetricConfig,
    rows: TechnicianKpiSnapshot[],
  ): ProductivityMetricBreakdown {
    const base = {
      key,
      label_ar: PRODUCTIVITY_METRIC_LABELS_AR[key],
      enabled: metricConfig.enabled,
      weight_configured: metricConfig.weight,
    };

    if (!metricConfig.enabled) {
      return { ...base, included: false, exclusion_reason: 'المقياس ده معطّل من الإعدادات', raw_value: null, normalized_score: null, weight_applied: null, sample_size: 0 };
    }

    const { rawValue, sampleSize } = this.aggregateRawValue(key, rows);
    if (rawValue === null || sampleSize < metricConfig.minSampleSize) {
      return {
        ...base,
        included: false,
        // **الوحدة شهور مش تقييمات** (بلاغ مالك 2026-09-17): الصيغة القديمة «عينة غير كافية (0
        // من 1 شهر مطلوبين)» كان الأدمن بيقراها كإنكار لوجود تقييمات — وهو شايف ١٩ تقييم فوقها
        // في نفس الصفحة. `sample_size` هنا بيعدّ **الشهور اللي فيها بيانات للمقياس ده**، فالجملة
        // بقت بتقول كده صراحة.
        exclusion_reason:
          sampleSize === 0
            ? `مفيش ولا شهر فيه بيانات للمقياس ده جوّه الفترة المحسوبة (المطلوب ${metricConfig.minSampleSize} شهر على الأقل)`
            : `شهور فيها بيانات: ${sampleSize} من ${metricConfig.minSampleSize} شهر مطلوبين على الأقل`,
        raw_value: rawValue,
        normalized_score: null,
        weight_applied: null,
        sample_size: sampleSize,
      };
    }

    const normalizedScore = this.normalize(key, rawValue, metricConfig);
    return {
      ...base,
      included: true,
      exclusion_reason: null,
      raw_value: rawValue,
      normalized_score: normalizedScore,
      weight_applied: metricConfig.weight,
      sample_size: sampleSize,
    };
  }

  /** بيرجّع القيمة الخام المجمّعة عبر الفترة + عدد الشهور اللي فعلاً ساهمت فيها (مش بس طول المصفوفة). */
  private aggregateRawValue(key: ProductivityMetricKey, rows: TechnicianKpiSnapshot[]): { rawValue: number | null; sampleSize: number } {
    switch (key) {
      case 'completed_orders': {
        const sum = rows.reduce((acc, r) => acc + r.completedOrdersCount, 0);
        return { rawValue: sum, sampleSize: rows.length };
      }
      case 'completion_rate': {
        const values = rows.filter((r) => r.completionRate !== null).map((r) => Number(r.completionRate));
        return { rawValue: average(values), sampleSize: values.length };
      }
      case 'acceptance_rate': {
        const values = rows.filter((r) => r.acceptanceRate !== null).map((r) => Number(r.acceptanceRate));
        return { rawValue: average(values), sampleSize: values.length };
      }
      case 'cancellation_rate': {
        const values = rows.filter((r) => r.cancellationRate !== null).map((r) => Number(r.cancellationRate));
        return { rawValue: average(values), sampleSize: values.length };
      }
      case 'complaint_rate': {
        const withOrders = rows.filter((r) => r.completedOrdersCount > 0);
        if (withOrders.length === 0) return { rawValue: null, sampleSize: 0 };
        const totalComplaints = withOrders.reduce((acc, r) => acc + r.complaintsCount, 0);
        const totalCompleted = withOrders.reduce((acc, r) => acc + r.completedOrdersCount, 0);
        return { rawValue: (totalComplaints / totalCompleted) * 100, sampleSize: withOrders.length };
      }
      case 'customer_rating': {
        const withRatings = rows.filter((r) => r.averageRating !== null && r.ratingsCount > 0);
        if (withRatings.length === 0) return { rawValue: null, sampleSize: 0 };
        const totalWeighted = withRatings.reduce((acc, r) => acc + Number(r.averageRating) * r.ratingsCount, 0);
        const totalCount = withRatings.reduce((acc, r) => acc + r.ratingsCount, 0);
        return { rawValue: totalWeighted / totalCount, sampleSize: withRatings.length };
      }
      case 'revenue_delivered': {
        const sum = rows.reduce((acc, r) => acc + Number(r.orderValueCents), 0);
        return { rawValue: sum, sampleSize: rows.length };
      }
      case 'monthly_kpi_score': {
        const values = rows.filter((r) => r.overallScore !== null).map((r) => Number(r.overallScore));
        return { rawValue: average(values), sampleSize: values.length };
      }
    }
  }

  /**
   * بيطبّع القيمة الخام لـ0-100 — القرار بيتحدد من نوع المقياس نفسه (`key`) صراحة، مش من نطاق
   * القيمة (تخمين نطاق كان هيبقى غلط: أي نسبة تانية ممكن تقع بالصدفة في مدى 1-5 في شهر سيء).
   */
  private normalize(key: ProductivityMetricKey, rawValue: number, metricConfig: ProductivityMetricConfig): number {
    let scaled: number;
    if (key === 'customer_rating') {
      // تقييم 1-5 → 0-100
      scaled = ((rawValue - 1) / 4) * 100;
    } else if (metricConfig.target) {
      // مقاييس بلا سقف طبيعي (عدد طلبات، قيمة بالقرش) — تطبيع نسبةً لهدف قابل للتحكم
      scaled = (rawValue / metricConfig.target) * 100;
    } else {
      // نسب مخزّنة أصلاً 0-100 (completion_rate/acceptance_rate/cancellation_rate/complaint_rate/monthly_kpi_score)
      scaled = rawValue;
    }
    const clamped = Math.max(0, Math.min(100, scaled));
    return metricConfig.direction === 'lower_is_better' ? Math.round((100 - clamped) * 100) / 100 : Math.round(clamped * 100) / 100;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * نافذة الـsnapshots المستخدمة بالفعل — من أول لحظة في أقدم شهر لأول لحظة في الشهر اللي بعد
 * أحدث شهر (نصف مفتوح، نفس اتفاقية `monthBounds` في محرك الـKPI بالظبط).
 *
 * **مش** «آخر N شهر من اليوم»: الخدمة بتاخد أحدث N snapshot **موجود**، فلو الفني آخر snapshot
 * له من يناير والدنيا سبتمبر، النافذة يناير — والأدمن لازم يشوف كده صريح.
 */
function snapshotWindow(rows: TechnicianKpiSnapshot[]): { start: Date | null; end: Date | null } {
  if (rows.length === 0) return { start: null, end: null };
  const keys = rows.map((r) => r.periodYear * 12 + (r.periodMonth - 1));
  const minKey = Math.min(...keys);
  const maxKey = Math.max(...keys);
  return {
    start: new Date(Date.UTC(Math.floor(minKey / 12), minKey % 12, 1)),
    end: new Date(Date.UTC(Math.floor((maxKey + 1) / 12), (maxKey + 1) % 12, 1)),
  };
}
