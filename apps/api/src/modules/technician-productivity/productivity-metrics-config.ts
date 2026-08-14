// شكل الإعداد `productivity.metrics_config` (settings، value_type='json', group='productivity') —
// نظام تسجيل إنتاجية configurable بالكامل (docs/08 §14): تفعيل/تعطيل لكل مقياس، وزن، اتجاه
// (أعلى أفضل/أقل أفضل)، حجم عينة أدنى، وهدف تطبيع (للمقاييس اللي مش نسبة 0-100 أصلاً زي عدد
// الطلبات أو الإيراد). صفر أوزان/حدود دائمة مكتوبة في الكود — القيم هنا افتراضية تطويرية بس،
// الأدمن يقدر يغيّرها بالكامل من `/settings` (مجموعة `productivity`، محرر JSON العام الموجود
// بالفعل — مفيش شاشة أدمن جديدة لازمة، راجع technician-productivity/README.md).

export type ProductivityMetricDirection = 'higher_is_better' | 'lower_is_better';

export interface ProductivityMetricConfig {
  enabled: boolean;
  weight: number;
  direction: ProductivityMetricDirection;
  // أقل عدد شهور فيها بيانات فعلية للمقياس ده عشان يتحسب — لو العينة أصغر، المقياس بيتستبعد
  // من المتوسط الموزون (مش بيتحط صفر — نفس فلسفة KPI "بس لو فيه بيانات كفاية").
  minSampleSize: number;
  // للمقاييس اللي مش نسبة 0-100 خالص أصلاً (عدد طلبات، قيمة بالقرش) — التطبيع بيحصل بقسمة
  // القيمة على target وضربها في 100 (بحد أقصى 100). المقاييس اللي أصلاً نسبة (completion_rate
  // مثلاً) متحتاجش target — بتتاخد كما هي (أو 100-هي لو direction=lower_is_better).
  target?: number;
}

export type ProductivityMetricKey =
  | 'completed_orders'
  | 'completion_rate'
  | 'acceptance_rate'
  | 'cancellation_rate'
  | 'complaint_rate'
  | 'customer_rating'
  | 'revenue_delivered'
  | 'monthly_kpi_score';

export type ProductivityMetricsConfig = Record<ProductivityMetricKey, ProductivityMetricConfig>;

export const PRODUCTIVITY_METRIC_LABELS_AR: Record<ProductivityMetricKey, string> = {
  completed_orders: 'عدد الطلبات المكتملة',
  completion_rate: 'معدل الإكمال',
  acceptance_rate: 'معدل قبول العروض',
  cancellation_rate: 'معدل الإلغاء',
  complaint_rate: 'معدل الشكاوى',
  customer_rating: 'تقييم العملاء',
  revenue_delivered: 'قيمة الطلبات المنجزة',
  monthly_kpi_score: 'درجة KPI الشهرية',
};

// قيم افتراضية تطويرية معقولة — مش دائمة، الأدمن يقدر يغيّرها بالكامل من `/settings`.
export const DEFAULT_PRODUCTIVITY_METRICS_CONFIG: ProductivityMetricsConfig = {
  completed_orders: { enabled: true, weight: 20, direction: 'higher_is_better', minSampleSize: 1, target: 20 },
  completion_rate: { enabled: true, weight: 15, direction: 'higher_is_better', minSampleSize: 1 },
  acceptance_rate: { enabled: true, weight: 10, direction: 'higher_is_better', minSampleSize: 1 },
  cancellation_rate: { enabled: true, weight: 15, direction: 'lower_is_better', minSampleSize: 1 },
  complaint_rate: { enabled: true, weight: 15, direction: 'lower_is_better', minSampleSize: 1 },
  customer_rating: { enabled: true, weight: 10, direction: 'higher_is_better', minSampleSize: 1 },
  revenue_delivered: { enabled: true, weight: 10, direction: 'higher_is_better', minSampleSize: 1, target: 5000000 },
  monthly_kpi_score: { enabled: true, weight: 5, direction: 'higher_is_better', minSampleSize: 1 },
};
