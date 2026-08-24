'use client';

import { useEffect, useState } from 'react';
import type { ApplicablePaymentPolicyDto, InstallmentPlanPublicDto } from '@baytak/shared-types';
import { submitInstallmentApplication, type InstallmentApplicationDto } from '@/lib/installments';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

interface SavedPaymentMethod {
  id: string;
  provider: string;
  card_brand: string | null;
  masked_pan: string | null;
  is_default: boolean;
}

function egp(cents: number): string {
  return `${(cents / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
}

/**
 * قسم التقسيط في صفحة الطلب (migration 0177) — بيظهر بس لو الخدمة عليها خطط متاحة.
 * التدفق: اختار خطة → شوف الـbreakdown الدقيق (محسوب من الباك-إند وقت التقديم) → وافق على
 * الشروط → قدّم → الحالة "تحت المراجعة" لحد قرار الأدمن. مفيش أي موافقة ذاتية.
 */
export function InstallmentSection({
  authedFetch,
  orderId,
  serviceId,
  onApplied,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
  serviceId: string;
  onApplied: () => void;
}) {
  const [plans, setPlans] = useState<InstallmentPlanPublicDto[] | null>(null);
  const [policies, setPolicies] = useState<ApplicablePaymentPolicyDto[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<SavedPaymentMethod[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [acceptedVersions, setAcceptedVersions] = useState<Set<string>>(new Set());
  const [application, setApplication] = useState<InstallmentApplicationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    import('@/lib/installments')
      .then(({ fetchInstallmentPlans, fetchApplicablePolicies }) =>
        Promise.all([
          fetchInstallmentPlans(serviceId),
          fetchApplicablePolicies(serviceId, 'installment'),
          authedFetch<SavedPaymentMethod[]>('/payment-methods'),
        ]),
      )
      .then(([planList, policyList, methods]) => {
        setPlans(planList);
        setPolicies(policyList);
        setPaymentMethods(methods);
        setSelectedPaymentMethodId(methods.find((method) => method.is_default)?.id ?? methods[0]?.id ?? null);
      })
      .catch(() => setPlans([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  async function handleSubmit(): Promise<void> {
    if (!selectedPlanId) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await submitInstallmentApplication(authedFetch, orderId, {
        plan_id: selectedPlanId,
        payment_method_id: selectedPlan?.requires_saved_card ? selectedPaymentMethodId ?? undefined : undefined,
        accepted_policy_version_ids: [...acceptedVersions],
      });
      setApplication(result);
      onApplied();
    } catch (err) {
      // رسائل الباك-إند العربية هي المصدر (نفس شروط السياسات/الأهلية)
      setError(err instanceof Error ? err.message : 'حصل خطأ');
    } finally {
      setSubmitting(false);
    }
  }

  if (plans !== null && plans.length === 0) return null;

  if (application) {
    return (
      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-semibold">طلب التقسيط — تحت المراجعة</h2>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">سعر الخدمة</dt><dd>{egp(application.service_price_cents)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">تكلفة التمويل</dt><dd>{egp(application.financing_fee_cents)}</dd></div>
          <div className="flex justify-between font-medium"><dt>الإجمالي الممول</dt><dd>{egp(application.total_financed_cents)}</dd></div>
          {application.down_payment_cents > 0 && (
            <div className="flex justify-between"><dt className="text-muted">المقدم</dt><dd>{egp(application.down_payment_cents)}</dd></div>
          )}
          <div className="flex justify-between"><dt className="text-muted">عدد الأقساط</dt><dd>{application.installment_count}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">القسط الدوري</dt><dd>{egp(application.regular_installment_cents)}</dd></div>
          <div className="flex justify-between text-xs text-muted">
            <dt>القسط الأخير</dt><dd>{egp(application.final_installment_cents)} (تسوية التقريب)</dd>
          </div>
        </dl>
        <p className="mt-3 rounded bg-surface-variant p-3 text-xs text-muted">
          طلبك دلوقتي عند فريق المراجعة — هنبلغك بالنتيجة. الموافقة بتُنشئ جدولة الأقساط الرسمية.
        </p>
      </section>
    );
  }

  if (plans === null) return null;

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const compatibleMethods = selectedPlan
    ? paymentMethods.filter((method) => method.provider === selectedPlan.allowed_provider)
    : [];
  const allRequiredAccepted = policies
    .filter((policy) => policy.isRequired)
    .every((policy) => acceptedVersions.has(policy.currentVersionId));

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-semibold">ادفع بالتقسيط</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => setSelectedPlanId(plan.id)}
            className={`rounded-lg border px-3 py-2 text-sm ${
              selectedPlanId === plan.id ? 'border-primary bg-primary/10 text-primary' : 'border-border'
            }`}
          >
            {plan.name_ar}
          </button>
        ))}
      </div>

      {selectedPlan && (
        <>
          {/* الوصف التمهيدي بالنسب بس — المبالغ الفعلية بتتحسب authoritative من الباك-إند
              وقت التقديم وبتظهر فوق بعد الإرسال. */}
          <p className="mt-3 text-sm text-muted">
            تمويل {selectedPlan.financing_percentage}% · {selectedPlan.installment_count} أقساط كل{' '}
            {selectedPlan.interval_days} يوم تقريبًا
            {selectedPlan.down_payment_percentage > 0 ? ` · مقدم ${selectedPlan.down_payment_percentage}%` : ''}
          </p>

          {selectedPlan.requires_saved_card && (
            <div className="mt-3">
              <label className="text-sm font-medium" htmlFor="installment-payment-method">بطاقة التحصيل التلقائي</label>
              {compatibleMethods.length === 0 ? (
                <p className="mt-1 text-sm text-danger">الخطة تحتاج بطاقة Paymob محفوظة. ادفع مرة بالكارت مع اختيار حفظ البطاقة ثم ارجع للتقديم.</p>
              ) : (
                <select id="installment-payment-method" value={selectedPaymentMethodId ?? ''}
                  onChange={(event) => setSelectedPaymentMethodId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2">
                  {compatibleMethods.map((method) => (
                    <option key={method.id} value={method.id}>{method.card_brand ?? 'بطاقة'} {method.masked_pan ?? ''}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {policies.filter((p) => p.isRequired).length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-sm font-medium">شروط التقسيط:</p>
              {policies
                .filter((p) => p.isRequired)
                .map((policy) => (
                  <label key={policy.policyId} className="mt-1 flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={acceptedVersions.has(policy.currentVersionId)}
                      onChange={(e) => {
                        const next = new Set(acceptedVersions);
                        if (e.target.checked) next.add(policy.currentVersionId);
                        else next.delete(policy.currentVersionId);
                        setAcceptedVersions(next);
                      }}
                      className="mt-1"
                    />
                    <span>
                      أوافق على <span className="underline">{policy.titleAr}</span>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-muted text-xs">اقرأ النص</summary>
                        <p className="mt-1 whitespace-pre-line rounded bg-surface-variant p-2 text-xs">{policy.bodyAr}</p>
                      </details>
                    </span>
                  </label>
                ))}
            </div>
          )}

          {error && <p className="mt-2 text-sm text-danger">{error}</p>}

          <button
            onClick={() => void handleSubmit()}
            disabled={submitting || !allRequiredAccepted || (selectedPlan.requires_saved_card && !compatibleMethods.some((method) => method.id === selectedPaymentMethodId))}
            className="mt-3 w-full rounded-lg bg-primary py-2.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'جاري التقديم...' : 'قدّم طلب التقسيط'}
          </button>
        </>
      )}
    </section>
  );
}
