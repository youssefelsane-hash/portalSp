/**
 * حالة مديونية الفني (ADR-0041، docs/08 §63.أ2) — **رياضيات صافية**، صفر I/O.
 *
 * الدَّين نفسه مش مخزّن في أي مكان: هو ببساطة رصيد محفظة سالب. الملف ده بيحوّل (الرصيد + عمر
 * الدَّين + عتبات الأدمن) لحالة واحدة مفهومة تظهر للأدمن.
 */

export type DebtStatus = 'none' | 'ok' | 'watch' | 'alert';

export interface DebtPolicy {
  /** فوقها المديونية "تستاهل انتباه" — بالقرش. */
  alertThresholdCents: number;
  /** بعدها المديونية تتحسب "قديمة" — بالأيام. */
  alertAgeDays: number;
}

export interface DebtAssessment {
  status: DebtStatus;
  debtCents: number;
  ageDays: number | null;
  /** عدّى عتبة المبلغ. */
  exceedsAmount: boolean;
  /** عدّى عتبة العمر. */
  exceedsAge: boolean;
}

export const DEFAULT_DEBT_POLICY: DebtPolicy = { alertThresholdCents: 50_000, alertAgeDays: 14 };

/**
 * @param balanceCents رصيد محفظة الفني (سالب = مديون).
 * @param debtSinceAt  أقدم لحظة الرصيد بقى فيها سالب ومرجعش موجب. `null` = مفيش دَين.
 * @param now          مُمرَّرة عشان الاختبار يبقى حتمي، مش `Date.now()` جوّه الدالة.
 *
 * القاعدة: `alert` لما **العتبتين** يتعدّوا مع بعض. ليه مش واحدة كفاية؟ لأن مبلغ كبير من ساعة
 * (فني لسه مخلّص طلب كاش كبير) مش نفس مبلغ صغير من شهرين (حد بياخد فلوس الشركة وما بيدفعش).
 * الأولانية طبيعية تمامًا والتانية هي اللي المالك قلق منها.
 */
export function assessTechnicianDebt(
  balanceCents: number,
  debtSinceAt: Date | null,
  policy: DebtPolicy,
  now: Date,
): DebtAssessment {
  if (balanceCents >= 0) {
    return { status: 'none', debtCents: 0, ageDays: null, exceedsAmount: false, exceedsAge: false };
  }

  const debtCents = -balanceCents;
  const ageDays =
    debtSinceAt !== null ? Math.max(0, Math.floor((now.getTime() - debtSinceAt.getTime()) / 86_400_000)) : null;

  const exceedsAmount = debtCents > policy.alertThresholdCents;
  const exceedsAge = ageDays !== null && ageDays > policy.alertAgeDays;

  if (exceedsAmount && exceedsAge) return { status: 'alert', debtCents, ageDays, exceedsAmount, exceedsAge };
  if (exceedsAmount || exceedsAge) return { status: 'watch', debtCents, ageDays, exceedsAmount, exceedsAge };
  return { status: 'ok', debtCents, ageDays, exceedsAmount, exceedsAge };
}
