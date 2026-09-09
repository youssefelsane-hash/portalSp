/**
 * عقد لوحة التحليلات (ADR-0081) — الشكل اللي `apps/api/src/modules/analytics` بيرجّعه
 * و`apps/admin` بيقراه. مصدر واحد للاتنين عشان مايبقاش فيه نسختين بتفرقوا في صمت.
 */

/** وحدة القيمة — بتحدد إزاي تتعرض (نسبة؟ قرش؟ ثواني؟)، مش بس شكلها. */
export type KpiUnit = 'count' | 'cents' | 'percent' | 'seconds';

export interface KpiValue {
  key: string;
  /**
   * `null` معناها **المقياس مالوش معنى في الفترة دي** (مقام صفر، أو بيانات مدخلة ناقصة)،
   * مش صفر. الفرق ده هو الفرق بين «مفيش إلغاءات» و«مفيش طلبات أصلاً».
   */
  value: number | null;
  unit: KpiUnit;
  /** المقام اللي النسبة اتحسبت عليه — «٥٠٪» على طلبين غير «٥٠٪» على ألفين. */
  sample_size: number | null;
  unavailable_reason?: string;
}

export interface ExecutiveKpis {
  from: string;
  to: string;
  kpis: KpiValue[];
}

// ═══ الفنل ═══

export type FunnelTrust = 'server' | 'client' | 'derived' | 'mixed';

export interface FunnelStageRow {
  stage: string;
  count: number;
  /** محاولات فشلت — المنتج منع العميل يكمّل، مش إنه غيّر رأيه. الفرق ده هو أهم حاجة في الفنل. */
  failed_count: number;
  pct_of_entry: number | null;
  dropped_from_previous: number | null;
  drop_rate_from_previous: number | null;
  trust: FunnelTrust;
}

export interface FunnelFailureRow {
  stage: string;
  failure_reason: string;
  count: number;
}

export interface FunnelReport {
  from: string;
  to: string;
  stages: FunnelStageRow[];
  top_failures: FunnelFailureRow[];
  /** أوحش نقطة تسريب — الرد المباشر على «الفلو بيتكسر فين؟». */
  worst_drop: { stage: string; dropped: number; drop_rate: number } | null;
  sessions_tracked: number;
  sessions_untracked: number;
}

export interface FunnelServiceRow {
  service_id: string;
  name_ar: string;
  started: number;
  placed: number;
  failed: number;
  conversion_pct: number;
}

/** أسماء مراحل الفنل بالعربي — الترتيب بيجي من الـAPI، ده بس بيسمّي. */
export const FUNNEL_STAGE_LABELS_AR: Record<string, string> = {
  service_viewed: 'شاف الخدمة',
  booking_started: 'بدأ الحجز',
  price_previewed: 'شاف السعر',
  providers_viewed: 'شاف الفنيين',
  order_placed: 'أكّد الطلب',
  technician_assigned: 'اتعيّن فني',
  technician_arrived: 'الفني وصل',
  order_completed: 'الشغل خلص',
};

/**
 * سبب الفشل بالعربي — بلاغ مالك (2026-09-09): «السبب مكتوب `BAL_001`، مش حاجة مفهومة».
 *
 * **القاعدة بتخزّن الكود الخام عن قصد ومش هيتغيّر**: العمود بيتجمّع بـ`GROUP BY`، ورسالة نصية
 * فيها اسم خدمة أو مبلغ كانت هتخلّي كل صف فريد فالتجميع بلا معنى (`funnel-request.util.ts`).
 * الترجمة مكانها **العرض** — هنا — عشان تغيير الصياغة مايحتاجش migration، والتقارير القديمة
 * تتقرا بنفس الأسماء الجديدة.
 *
 * أي كود مش في القايمة بيرجع بشكله الخام مع تنبيه، **مش نص مضلّل**: عرض «خطأ غير معروف» على
 * كود ليه معنى بيخفي المشكلة بدل ما يوضّحها.
 */
export const FUNNEL_FAILURE_LABELS_AR: Record<string, string> = {
  // مصادقة — العميل وصل للخطوة وهو مش مسجّل/توكنه خلص
  AUTH_001: 'الجلسة مش صالحة — محتاج يسجّل دخول تاني',
  AUTH_002: 'الجلسة انتهت أثناء الحجز',
  AUTH_003: 'كود التحقق غلط',
  AUTH_004: 'تجاوز عدد محاولات التحقق',
  AUTH_005: 'محتاج تحقق إضافي (MFA)',
  AUTH_006: 'محتاج تأكيد هوية حديث للعملية',
  // الطلب — دي أهم فئة: كلها أسباب المنتج منع بيها حجز حقيقي
  ORDR_001: 'الخدمة مش متاحة في منطقة العميل',
  ORDR_002: 'مفيش فنيين متاحين في الوقت المطلوب',
  ORDR_003: 'حالة الطلب مابتسمحش بالخطوة دي',
  ORDR_004: 'مهلة الإلغاء المجاني خلصت',
  ORDR_005: 'صورة ما بعد التنفيذ ناقصة',
  ORDR_006: 'وصل للحد الأقصى لتأجيل الشغل ليوم تاني',
  // الدفع
  PAY_001: 'عملية الدفع فشلت',
  PAY_002: 'رصيد المحفظة مش كفاية',
  PAY_003: 'عملية مكررة (اتبعتت مرتين)',
  // الفني
  TECH_001: 'حساب الفني لسه مش معتمد',
  TECH_002: 'الفني وصل لسقف طلبات اليوم',
  TECH_003: 'الرقم القومي مسجّل لحساب تاني',
  TECH_004: 'الرقم القومي مش بيتغيّر بعد الاعتماد',
  // مدخلات وحدود
  VAL_001: 'بيانات الحجز ناقصة أو غلط',
  RATE_001: 'تجاوز عدد الطلبات المسموح (throttle)',
  SYS_001: 'عطل مؤقت في النظام',
  SYS_002: 'الخدمة موقوفة مؤقتًا بقرار إداري',
  // مش كود أخطاء — بيتولّد في `describeFunnelFailure` لما الاستثناء مش `ApiException`
  internal_error: 'عطل غير متوقع في السيرفر',
};

/** ترجمة رمز فشل واحد للعرض. بيفهم كمان `http_<كود>` اللي بيتولّد لأي `HttpException` بلا كود. */
export function funnelFailureLabelAr(reason: string): string {
  const known = FUNNEL_FAILURE_LABELS_AR[reason];
  if (known) return known;
  const httpMatch = /^http_(\d{3})$/.exec(reason);
  if (httpMatch) {
    const status = Number(httpMatch[1]);
    if (status === 401 || status === 403) return 'الخطوة اتمنعت (مش مصرّح)';
    if (status === 404) return 'حاجة في الطلب مش موجودة';
    if (status === 409) return 'تعارض — الحالة اتغيّرت أثناء الحجز';
    if (status === 429) return 'تجاوز عدد الطلبات المسموح (throttle)';
    if (status >= 500) return 'عطل في السيرفر';
    return 'الطلب اترفض للتحقق من البيانات';
  }
  return `سبب غير معروف (${reason})`;
}

export const FUNNEL_TRUST_LABELS_AR: Record<FunnelTrust, string> = {
  server: 'مسجّل على السيرفر',
  client: 'مسجّل من التطبيق',
  derived: 'محسوب من حالة الطلب',
  mixed: 'مصادر مختلطة',
};

// ═══ المال ═══

export interface MoneyLine {
  key: string;
  amount_cents: number;
  label_ar: string;
  /** تعريف السطر جاي مع الرقم نفسه — عشان محدش يفسّره غلط. */
  definition_ar: string;
}

export interface DoublePaymentCase {
  order_id: string;
  order_number: string;
  order_total_cents: number;
  paid_cents: number;
  overpaid_cents: number;
  succeeded_payments: number;
  last_payment_at: string | null;
}

export interface MoneySnapshot {
  from: string;
  to: string;
  lines: MoneyLine[];
  technician_earnings_cents: number;
  assistant_earnings_cents: number;
  pending_settlements_cents: number;
  pending_settlements_count: number;
  failed_payments_count: number;
  failed_payments_cents: number;
  double_payments_count: number;
  double_payments_overpaid_cents: number;
  double_payments: DoublePaymentCase[];
  /** **أهم رقم في اللوحة**: أي قيمة غير الصفر معناها الدفتر مش متسوّي. */
  unreconciled_count: number;
}

export interface ReconciliationIssue {
  kind: string;
  wallet_id: string;
  owner_user_id: string;
  /** الفرق بالقرش — مش «فيه مشكلة» مجرّدة، الرقم اللي ناقص أو زايد بالظبط. */
  difference_cents: number;
  transaction_id: string | null;
  transaction_number: string | null;
  detail: string;
}

export interface ReconciliationReport {
  checked_wallets: number;
  checked_transactions: number;
  total_issues: number;
  issues: ReconciliationIssue[];
  issues_truncated: boolean;
  is_balanced: boolean;
  ledger_issues_total: number;
  operational_issues_total: number;
  operational_issues: FinancialOperationalIssue[];
  operational_issues_truncated: boolean;
}

export type FinancialOperationalIssueKind =
  | 'stale_refund'
  | 'stale_payment'
  | 'cancelled_paid_missing_refund'
  | 'completed_unpaid';

export interface FinancialOperationalIssue {
  kind: FinancialOperationalIssueKind;
  order_id: string | null;
  order_number: string | null;
  related_id: string;
  amount_cents: number;
  occurred_at: string;
  detail: string;
}

export interface MarketingSpendRow {
  id: string;
  month: string;
  channel: string;
  amountCents: number;
  notes: string | null;
}

// ═══ القوى العاملة ═══

export type WorkforceSort = 'completed' | 'earnings' | 'utilization' | 'rating' | 'idle' | 'debt';

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
  /** متمّم `active_in_period` بنفس تعريف النشاط — المجموع = `headcount.approved` دايمًا. */
  idle_approved: number;
  churned: number;
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

export interface TechnicianScorecardsReport {
  from: string;
  to: string;
  capacity_minutes_per_day: number;
  technicians: TechnicianScorecard[];
}

export interface AreaCoverageRow {
  area_id: string;
  area_name_ar: string;
  city_name_ar: string;
  orders_placed: number;
  orders_matched: number;
  orders_unmatched: number;
  match_rate: number | null;
  /** فنيون معتمدون لهم نطاق خدمة نشط يغطي نطاق طلبات المنطقة. */
  technicians_serving_area: number;
  /** عنوان السكن فقط؛ لا يستخدمه محرك المطابقة كمعيار للتغطية. */
  technicians_home_based: number;
  orders_per_technician: number | null;
}

export interface AreaCoverageReport {
  from: string;
  to: string;
  areas: AreaCoverageRow[];
  uncovered_with_demand: AreaCoverageRow[];
}

export interface WorkforceLiveLoad {
  active_orders: number;
  technicians_busy: number;
  unassigned_active_orders: number;
  busiest: { technician_id: string; technician_code: string; display_name: string; active_orders: number }[];
}

/**
 * أسماء المقاييس بالعربي — **قيم وقت تشغيل** مش أنواع، فلازم `dist` تكون متبنية عشان توصل
 * للمتصفح (نفس فخ `PRICING_METHODS` الموثّق في README الحزمة).
 */
export const KPI_LABELS_AR: Record<string, string> = {
  completed_orders: 'طلبات مكتملة',
  placed_orders: 'طلبات اتعملت',
  repeat_rate: 'نسبة العملاء الراجعين',
  gmv_cents: 'حجم المبيعات (GMV)',
  revenue_cents: 'إيراد المنصة',
  technician_earnings_cents: 'مستحقات الفنيين',
  discounts_cents: 'الخصومات',
  refunds_cents: 'الاستردادات',
  contribution_margin_cents: 'هامش المساهمة',
  refund_rate: 'نسبة الاسترداد',
  match_rate: 'نسبة المطابقة',
  cancellation_rate: 'نسبة الإلغاء',
  median_time_to_match_seconds: 'وسيط زمن المطابقة',
  avg_time_to_match_seconds: 'متوسط زمن المطابقة',
  on_time_rate: 'نسبة الانضباط',
  complaint_rate: 'نسبة الشكاوى',
  rework_rate: 'نسبة إعادة الشغل',
  technician_utilization: 'استغلال الفنيين',
  technician_retention: 'استبقاء الفنيين',
  approved_technicians: 'فنيين معتمدين',
  cac_cents: 'تكلفة اكتساب العميل (CAC)',
};

export const TECHNICIAN_LEVEL_LABELS_AR: Record<string, string> = {
  new: 'جديد',
  verified: 'موثّق',
  professional: 'محترف',
  premium: 'مميّز',
  team_leader: 'قائد فريق',
};
