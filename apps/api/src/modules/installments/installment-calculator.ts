// محرك الحسابات المالية للتقسيط — دالة نقية بلا أي I/O أو تبعيات، مصدر الحقيقة الوحيد
// لأي مبلغ تقسيطي في المنصة. **ممنوع** أي واجهة تعرض/ترسل مبالغ محسوبة من العميل — الباك-إند
// هو اللي بيحسب من الأسعار الصحيحة (قرش integer) وبالـrounding المحدد هنا بالظبط.
//
// النموذج (مطابق لمثال المالك):
//   سعر الخدمة 10,000 ج → رسوم تمويل 12% = 1,200 → إجمالي ممول 11,200
//   → مقدم 2,000 → رصيد تقسيط 9,200 → 6 أقساط ≈ 1,533.33 (القسط الأخير يستوعب فرق التقريب).
//
// الثابت الحاكم: down_payment + sum(الأقساط المجدولة) === total_financed — **ولا قرش يضيع ولا يتخترع**
// (راجع installment-calculation.spec.ts للمصفوفة الكاملة).

export interface InstallmentPlanFinancials {
  /** عدد الأقساط (بدون المقدم). */
  readonly installmentCount: number;
  /** نسبة التمويل (0-100، قد تكون كسور مثل 12.5). */
  readonly financingPercentage: number;
  /** رسم تمويل ثابت بالقرش (اختياري فوق النسبة). */
  readonly fixedFeeCents: number;
  /** نسبة المقدم من الإجمالي الممول (0-100). */
  readonly downPaymentPercentage: number;
}

export interface ComputedInstallmentBreakdown {
  /** سعر الخدمة المرجعي (المبلغ الصحيح من محرك التسعير). */
  servicePriceCents: number;
  financingFeeCents: number;
  totalFinancedCents: number;
  downPaymentCents: number;
  financedBalanceCents: number;
  installmentCount: number;
  /** القيمة المنتظمة لكل قسط (floor). */
  regularInstallmentAmountCents: number;
  /**
   * مبالغ الأقساط N بالترتيب — كلها `regularInstallmentAmountCents` إلا **الأخير** اللي بيستوعب
   * فرق التقريب (يمكن يساوي المنتظم لو القسمة سليمة). مجموع المصفوفة دي + المقدم =
   * totalFinancedCents بالظبط.
   */
  installmentAmountsCents: number[];
}

// التقريب المطلوب "أقرب قرش" للمبالغ الموجبة — Math.round محددة وثابتة هنا.
const toCents = (value: number): number => Math.round(value);

export function computeInstallmentBreakdown(
  servicePriceCents: number,
  plan: InstallmentPlanFinancials,
): ComputedInstallmentBreakdown {
  if (!Number.isInteger(servicePriceCents) || servicePriceCents <= 0) {
    throw new Error(`سعر خدمة غير صالح للتقسيط: ${servicePriceCents}`);
  }
  if (!Number.isInteger(plan.installmentCount) || plan.installmentCount < 1 || plan.installmentCount > 60) {
    throw new Error(`عدد أقساط غير صالح: ${plan.installmentCount}`);
  }

  // 1) رسوم التمويل = نسبة من السعر + رسم ثابت (كله بالقرش، التقريب لأقرب قرش).
  const percentageFeeCents = toCents((servicePriceCents * plan.financingPercentage) / 100);
  const financingFeeCents = percentageFeeCents + plan.fixedFeeCents;

  // 2) الإجمالي الممول.
  const totalFinancedCents = servicePriceCents + financingFeeCents;

  // 3) المقدم = نسبة من الإجمالي الممول (مش من السعر) — مطابق لمثال المالك بالحرف
  // (2,000 / 11,200 ≈ 17.86%).
  const downPaymentCents = toCents((totalFinancedCents * plan.downPaymentPercentage) / 100);
  const financedBalanceCents = totalFinancedCents - downPaymentCents;

  // 4) قسمة الرصيد: floor للمنتظم، والباقي (0..N-1 قرش) كله على القسط الأخير —
  //    sum(regular×(N-1) + final) === balance بالتمام.
  const regularInstallmentAmountCents = Math.floor(financedBalanceCents / plan.installmentCount);
  const finalInstallmentAmountCents =
    financedBalanceCents - regularInstallmentAmountCents * (plan.installmentCount - 1);

  const installmentAmountsCents: number[] = [];
  for (let i = 0; i < plan.installmentCount; i += 1) {
    installmentAmountsCents.push(i === plan.installmentCount - 1 ? finalInstallmentAmountCents : regularInstallmentAmountCents);
  }

  return {
    servicePriceCents,
    financingFeeCents,
    totalFinancedCents,
    downPaymentCents,
    financedBalanceCents,
    installmentCount: plan.installmentCount,
    regularInstallmentAmountCents,
    installmentAmountsCents,
  };
}

/** الثابت الحاكم — بيتنادى بعد أي حساب قبل ما ينشئ صفوفًا فعلية (دفاع أخير ضد أي انزلاق مستقبلي). */
export function assertBreakdownInvariant(breakdown: ComputedInstallmentBreakdown): void {
  const scheduledSum = breakdown.installmentAmountsCents.reduce((sum, amount) => sum + amount, 0);
  if (breakdown.downPaymentCents + scheduledSum !== breakdown.totalFinancedCents) {
    throw new Error(
      `انتهاك ثابت التقسيط: مقدم ${breakdown.downPaymentCents} + أقساط ${scheduledSum} ≠ ممول ${breakdown.totalFinancedCents}`,
    );
  }
  if (breakdown.installmentAmountsCents.some((amount) => amount <= 0)) {
    throw new Error('قسط بصفر/سالب — خطة غير قابلة للتنفيذ على المبلغ ده');
  }
}

/** فحص أهلية المبلغ لحدود الخطة (min/max) — فحص نطاق منفصل تمامًا عن الحساب نفسه. */
export function isAmountWithinPlanLimits(
  amountCents: number,
  limits: { minOrderAmountCents: number | null; maxOrderAmountCents: number | null },
): boolean {
  if (limits.minOrderAmountCents !== null && amountCents < limits.minOrderAmountCents) return false;
  if (limits.maxOrderAmountCents !== null && amountCents > limits.maxOrderAmountCents) return false;
  return true;
}
