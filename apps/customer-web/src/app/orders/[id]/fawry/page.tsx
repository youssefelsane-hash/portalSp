'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { payWithFawryReference, type FawryReferenceResponseDto } from '@/lib/payments';
import { getMyOrder, formatEgp } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';
import { ErrorState } from '@/components/error-state';

/**
 * **الدفع في أقرب منفذ فوري** — نظير `FawryReferenceScreen` في تطبيق العميل.
 *
 * الويب كان **بيخفي فوري بالكامل** من وسائل الدفع عن قصد («فوري والتقسيط ليهم مسارات مالهاش
 * واجهة هنا لسه») — وده كان الصح وقتها: عرض وسيلة بلا صفحة بيوصّل العميل لطريق مسدود. الصفحة
 * دي هي اللي بتخلّي فتح الوسيلة مقبول.
 *
 * ### الكود في سطر LTR لوحده ومعاه زرار نسخ
 *
 * نفس قاعدة صفحة InstaPay بالحرف، ولنفس السبب: رقم لاتيني جوّه فقرة عربية بيتعرض بترتيب خانات
 * مقلوب (bidi)، والعميل بياخد كود غلط للمنفذ ويدفع فيه — ودي فلوس حقيقية بتضيع. النص نفسه
 * قابل للتحديد لو `navigator.clipboard` مش متاح (مش موجود على HTTP).
 *
 * ### مفيش تأكيد يدوي هنا
 *
 * القفل النهائي عبر webhook من فوري. زرار «دفعت» بيفحص حالة الطلب فعليًا بدل ما يدّعي حاجة —
 * نفس فلسفة التطبيق بالظبط.
 */
export default function FawryReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();

  const [reference, setReference] = useState<FawryReferenceResponseDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stillPending, setStillPending] = useState(false);

  /**
   * **سلسلة وعود مش `async/await`**: `setState` لازم يقع جوّه callback مش في جسم الدالة اللي
   * الأثر بينادّيها (`react-hooks/set-state-in-effect`) — نفس نمط صفحة InstaPay بالحرف.
   *
   * والنداء آمن يتكرر: المفتاح مشتق من الطلب فالباك-إند بيرجّع **نفس** الكود مش كود جديد.
   */
  const load = useCallback(() => {
    payWithFawryReference(authedFetch, id)
      .then((details) => {
        setReference(details);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'مقدرناش نجيب كود الدفع دلوقتي');
      })
      .finally(() => setLoading(false));
  }, [authedFetch, id]);

  /** إعادة المحاولة بعد فشل — بتصفّر الحالة الأول، وده مسموح جوّه معالج حدث. */
  const retry = () => {
    setLoading(true);
    setError(null);
    load();
  };

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace(`/login?next=/orders/${id}/fawry`);
      return;
    }
    load();
  }, [authLoading, isAuthenticated, load, router, id]);

  async function copyCode() {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference.reference_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // الجهاز مش سامح بالنسخ — النص متحدّد يدويًا فوق، فمفيش طريق مسدود.
    }
  }

  async function checkPaid() {
    setChecking(true);
    setStillPending(false);
    try {
      const order = await getMyOrder(authedFetch, id);
      if (order.payment_status === 'paid') {
        router.replace(`/orders/${id}`);
        return;
      }
      setStillPending(true);
    } catch {
      setStillPending(true);
    } finally {
      setChecking(false);
    }
  }

  if (authLoading || loading) {
    return <p className="p-6 text-center text-sm text-muted">جاري تجهيز كود الدفع…</p>;
  }

  if (error) {
    return (
      <ErrorState
        testId="fawry-error"
        title="مقدرناش نجهّز كود الدفع"
        description={error}
        primary={{ label: 'حاول تاني', onClick: retry }}
        secondary={{ label: 'تفاصيل الطلب', href: `/orders/${id}` }}
      />
    );
  }

  if (!reference) return null;

  const expiresAt = reference.expires_at ? new Date(reference.expires_at) : null;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8" data-testid="fawry-page">
      <h1 className="text-xl font-bold">الدفع في أقرب فوري</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        خد الكود ده لأقرب منفذ فوري وادفعه كاش. التنفيذ بيبدأ أول ما الدفع يوصلنا.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <p className="text-sm text-muted">الكود المرجعي</p>
        {/* سطر LTR مستقل — الشرح في تعليق أعلى الملف. */}
        <p
          dir="ltr"
          className="mt-2 select-all text-center font-mono text-2xl font-bold tracking-widest"
          data-testid="fawry-reference"
        >
          {reference.reference_number}
        </p>
        <button
          type="button"
          onClick={copyCode}
          data-testid="fawry-copy"
          className="mt-3 min-h-11 w-full rounded-xl border border-border text-sm font-medium transition-colors duration-150 hover:bg-muted/10"
        >
          {copied ? 'اتنسخ ✓' : 'انسخ الكود'}
        </button>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">المبلغ</dt>
          <dd className="font-semibold">{formatEgp(reference.payment.amount_cents)}</dd>
        </div>
        {expiresAt && (
          <div className="flex justify-between">
            <dt className="text-muted">صالح لحد</dt>
            <dd dir="ltr">{expiresAt.toLocaleString('ar-EG')}</dd>
          </div>
        )}
      </dl>

      <button
        type="button"
        onClick={checkPaid}
        disabled={checking}
        data-testid="fawry-check"
        className="mt-6 min-h-11 w-full rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-transform duration-150 active:scale-[0.99] disabled:opacity-60"
      >
        {checking ? 'بنتأكد…' : 'دفعت — اتأكد من الحالة'}
      </button>

      {stillPending && (
        <p className="mt-3 text-center text-sm text-muted" data-testid="fawry-still-pending">
          لسه مستلمناش الدفع. لو دفعت من شوية، استنى دقيقة وجرّب تاني — بيوصلنا تلقائيًا من فوري.
        </p>
      )}

      <p className="mt-6 text-center text-xs text-muted">
        تقدر ترجع للصفحة دي في أي وقت من تفاصيل الطلب — الكود مش بيتغيّر.
      </p>
    </div>
  );
}
