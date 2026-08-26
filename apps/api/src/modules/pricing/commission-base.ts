/**
 * أساس العمولة (ADR-0037، docs/08 §60.1).
 *
 * الملف ده **دوال خالصة بلا أي I/O** عمدًا — الحساب المالي اللي بيقرر نصيب الفني لازم يكون
 * قابل للاختبار بالورقة والقلم من غير قاعدة بيانات. تحميل السياسة من الإعدادات مكانه
 * `CommissionBaseService`، والتطبيق على الطلب مكانه `PaymentsService`.
 */

/** كل مفاتيح `commission_base.*` في محرك الإعدادات — مصدر الحقيقة الوحيد لأسماءها. */
export const COMMISSION_BASE_SETTING_KEYS = {
  includeLevelPremium: 'commission_base.include_level_premium',
  includeZoneSurge: 'commission_base.include_zone_surge',
  includeEmergencySurcharge: 'commission_base.include_emergency_surcharge',
  includeInspectionFee: 'commission_base.include_inspection_fee',
  includeAddons: 'commission_base.include_addons',
  includeAdditionalItems: 'commission_base.include_additional_items',
  includeWarranty: 'commission_base.include_warranty',
  includeInstallmentInterest: 'commission_base.include_installment_interest',
  discountReducesTechnicianShare: 'commission_base.discount_reduces_technician_share',
} as const;

export interface CommissionBasePolicy {
  includeLevelPremium: boolean;
  includeZoneSurge: boolean;
  includeEmergencySurcharge: boolean;
  includeInspectionFee: boolean;
  includeAddons: boolean;
  includeAdditionalItems: boolean;
  includeWarranty: boolean;
  includeInstallmentInterest: boolean;
  discountReducesTechnicianShare: boolean;
}

/** الافتراضيات = طلب المالك بالحرف. مستخدمة كـfallback لو الإعداد مش موجود في القاعدة. */
export const DEFAULT_COMMISSION_BASE_POLICY: CommissionBasePolicy = {
  includeLevelPremium: true,
  includeZoneSurge: false,
  includeEmergencySurcharge: false,
  includeInspectionFee: true,
  includeAddons: true,
  includeAdditionalItems: true,
  includeWarranty: false,
  includeInstallmentInterest: false,
  discountReducesTechnicianShare: false,
};

/** مكوّنات إيراد الطلب وقت الإنشاء، بالقروش، زي ما `OrdersService` بيحسبها بالظبط. */
export interface OrderRevenueComponents {
  /** سعر الشغل الأساسي قبل أي مضاعف (`estimate.base_price_cents`). */
  basePriceCents: number;
  /** مضاعف مستوى الفني (`estimate.level_price_multiplier`) — 1 لو مفيش فني معروف بعد. */
  levelPriceMultiplier: number;
  /** السعر بعد كل المضاعفات وحدود min/max (`estimate.estimated_total_cents`). */
  estimatedTotalCents: number;
  inspectionFeeCents: number;
  emergencySurchargeCents: number;
  addonsTotalCents: number;
  discountCents: number;
  warrantyPriceCents: number;
  /** رسوم/فوائد التقسيط لو اتحمّلت على الطلب. صفر في الغالبية العظمى. */
  installmentInterestCents: number;
}

export interface CommissionBaseBreakdown {
  /** الوعاء النهائي اللي نسبة العمولة بتتطبّق عليه. */
  commissionableBaseCents: number;
  /** تفصيل للعرض في لوحة الأدمن ولتفسير الرقم — مش بيتخزّن. */
  workPriceCents: number;
  levelPremiumCents: number;
  zoneSurgeCents: number;
}

/**
 * بيفكّك `estimatedTotalCents` لتلات أجزاء: سعر الشغل الخام، زيادة مستوى الفني، وزيادة
 * مضاعف المنطقة/التضخم.
 *
 * ليه بالطرح مش بالضرب: مسار `FORMULA` بيقصّ الناتج على `min_price_cents`/`max_price_cents`
 * بعد المضاعف (`catalog.service.ts`)، فـ`base × level × surge` مش دايمًا بيساوي
 * `estimatedTotalCents`. الطرح بيضمن إن مجموع التلات أجزاء = الإجمالي **دايمًا**، وده الثابت
 * اللي بيمنع قرش ضايع أو مضاعف في الحساب المالي.
 */
export function splitEstimatedTotal(components: OrderRevenueComponents): {
  workPriceCents: number;
  levelPremiumCents: number;
  zoneSurgeCents: number;
} {
  const { basePriceCents, levelPriceMultiplier, estimatedTotalCents } = components;

  // القصّ عند الإجمالي بيمنع "زيادة مستوى" أكبر من السعر النهائي نفسه لما max_price_cents يقصّ.
  const withLevelCents = Math.min(
    Math.max(Math.round(basePriceCents * levelPriceMultiplier), 0),
    Math.max(estimatedTotalCents, 0),
  );
  const workPriceCents = Math.min(Math.max(basePriceCents, 0), withLevelCents);
  return {
    workPriceCents,
    levelPremiumCents: withLevelCents - workPriceCents,
    zoneSurgeCents: estimatedTotalCents - withLevelCents,
  };
}

/**
 * بيحسب وعاء العمولة من المكوّنات والسياسة.
 *
 * **الوعاء مستقل تمامًا عن الخصم** (ADR-0038، docs/08 §61.2 — طلب مالك صريح): خدمة بـ1000
 * وكوبون 50% يعني العميل يدفع 500، بس الفني بياخد نصيبه من **1000** والـ500 دي تكلفة تسويق
 * بتتحملها المنصة بالكامل. «العميل يستفيد من الخصم، المنصة تتحمل تكلفته، والفني ياخد مستحقه
 * كامل» — نص المالك.
 *
 * ده بيصحّح نسخة ADR-0037 اللي كانت بتقصّ الوعاء عند `totalAmountCents`. القصّ ده كان معناه
 * عمليًا إن **الفني بيموّل حملة تسويق المنصة من جيبه**. لو خصم كبير خلّى نصيب الفني أكبر من
 * اللي العميل دفعه، `platformCommissionCents` بيطلع سالب — وده صح محاسبيًا: المنصة دفعت الفرق.
 */
export function computeCommissionableBase(
  components: OrderRevenueComponents,
  policy: CommissionBasePolicy,
): CommissionBaseBreakdown {
  const { workPriceCents, levelPremiumCents, zoneSurgeCents } = splitEstimatedTotal(components);

  let baseCents = workPriceCents;
  if (policy.includeLevelPremium) baseCents += levelPremiumCents;
  if (policy.includeZoneSurge) baseCents += zoneSurgeCents;
  if (policy.includeInspectionFee) baseCents += components.inspectionFeeCents;
  if (policy.includeEmergencySurcharge) baseCents += components.emergencySurchargeCents;
  if (policy.includeAddons) baseCents += components.addonsTotalCents;
  if (policy.includeWarranty) baseCents += components.warrantyPriceCents;
  if (policy.includeInstallmentInterest) baseCents += components.installmentInterestCents;
  if (policy.discountReducesTechnicianShare) baseCents -= components.discountCents;

  return {
    commissionableBaseCents: Math.max(baseCents, 0),
    workPriceCents,
    levelPremiumCents,
    zoneSurgeCents,
  };
}

/**
 * تقسيم الإيراد النهائي. الثابت المحفوظ عمدًا:
 * `technicianEarningCents + platformCommissionCents === totalAmountCents` **دايمًا** (جبريًا،
 * حتى لو نصيب المنصة سالب) —
 * كل المحاسبة تحته (حركة المحفظة في `settleAndComplete`، الاسترداد النسبي في `refundOrder`،
 * تجميع `payouts`) بتعتمد عليه، فأي قرش بره الوعاء بيروح للشركة تلقائيًا بلا كود إضافي.
 */
export function splitOrderRevenue(input: {
  totalAmountCents: number;
  commissionableBaseCents: number;
  commissionRatePercentage: number;
}): { platformCommissionCents: number; technicianEarningCents: number } {
  const rate = Math.min(100, Math.max(0, input.commissionRatePercentage));
  const base = Math.max(input.commissionableBaseCents, 0);

  const commissionOnBaseCents = Math.round((base * rate) / 100);
  const technicianEarningCents = base - commissionOnBaseCents;
  return {
    technicianEarningCents,
    // ممكن يطلع **سالب** لما خصم كبير يخلّي اللي العميل دفعه أقل من مستحق الفني (ADR-0038).
    // ده مش خطأ بيانات — ده خسارة المنصة على الطلب، وهي اللي مموّلة الخصم. أي تقرير بيفترض
    // إن العمود ده موجب دايمًا لازم يتراجع.
    platformCommissionCents: input.totalAmountCents - technicianEarningCents,
  };
}
