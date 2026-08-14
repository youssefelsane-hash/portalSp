import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

export interface ProductivityReport {
  technician_id: string;
  evaluation_period_months: number;
  snapshots_found: number;
  overall_score: number | null;
  explanation: string;
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

    return {
      technician_id: technicianId,
      evaluation_period_months: evaluationPeriodMonths,
      snapshots_found: rows.length,
      overall_score: overallScore,
      explanation:
        overallScore === null
          ? 'مفيش بيانات كفاية لحساب درجة إنتاجية — كل المقاييس المفعّلة عينتها أصغر من الحد الأدنى المطلوب.'
          : `الدرجة محسوبة من ${includedCount} مقياس مفعّل وعنده بيانات كفاية، من أصل ${breakdown.filter((b) => b.enabled).length} مقياس مفعّل.`,
      breakdown,
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
        exclusion_reason: `عينة غير كافية (${sampleSize} من ${metricConfig.minSampleSize} شهر مطلوبين على الأقل)`,
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
