'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import {
  confirmInstaPayTransfer,
  getInstaPayTransfer,
  payWithInstaPay,
  type InstaPayReferenceDto,
} from '@/lib/payments';
import { getMyOrder, formatEgp } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';

/**
 * صفحة تحويل InstaPay للويب — **نظير `InstaPayReferenceScreen` في تطبيق العميل بالحرف**.
 *
 * قبلها كان الويب مقفول تمامًا على البطاقة (`prepayment_method: 'card'`)، يعني عميل بيحجز من
 * المتصفح **مش قادر يستخدم وسيلة الدفع الأساسية للمنصة** — ده كان الفرق الحقيقي الوحيد
 * الباقي بين الويب والتطبيق في مسار الدفع.
 *
 * تلات قواعد مالهاش حل تاني، نفس اللي في التطبيق:
 *
 *   ١. **كل رقم في سطر LTR مستقل ومعاه زرار نسخ.** رقم لاتيني جوّه فقرة عربية بيتعرض بترتيب
 *      خانات مقلوب (bidi) — العميل بينسخ رقم حساب غلط على تحويل بنكي حقيقي. `dir="ltr"` +
 *      خط ثابت بيثبّتوا الترتيب، والنص نفسه قابل للتحديد لو زرار النسخ اتعطّل
 *      (`navigator.clipboard` مش موجود على HTTP، فالنسخة اليدوية مش رفاهية).
 *
 *   ٢. **الصفحة بتجيب بياناتها بنفسها** من `GET /orders/:id/instapay-transfer` (قراءة بحتة).
 *      العميل **لازم** يسيب موقعنا ويفتح تطبيق البنك؛ الرجوع بـURL مباشر أو زرار «رجوع» أو
 *      refresh لازم يوصّله لنفس البيانات بدل ما يعمل تحويل جديد.
 *
 *   ٣. **الرجوع للتبويب بيعيد فحص الحالة تلقائيًا** (`visibilitychange`) — نظير
 *      `didChangeAppLifecycleState` في التطبيق. لو الموظف أكّد التحويل والعميل راجع، الصفحة
 *      تكتشف ده لوحدها.
 */
export default function InstaPayTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();

  const [reference, setReference] = useState<InstaPayReferenceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<'idle' | 'checking' | 'paid' | 'still_pending'>('idle');
  const [copied, setCopied] = useState<string | null>(null);

  // الفحص الصامت بيقرا الحالة الحالية من داخل مستمع حدث عايش لفترة — `ref` بيمنع إنه يشتغل
  // فوق نفسه لو العميل بدّل تبويبات بسرعة، ومن غير ما يدخل في مصفوفة اعتماديات المستمع.
  const checkingRef = useRef(false);

  /**
   * استئناف أولاً، وإنشاء بس لو مفيش تحويل مفتوح.
   *
   * الترتيب ده هو اللي بيخلّي الصفحة **آمنة على إعادة التحميل وعلى تبويب تاني**: الرجوع من
   * تطبيق البنك، أو `F5`، أو فتح الرابط من الطلب، كلهم بيقعوا على مسار القراءة ومابينشئوش
   * تحويل جديد.
   *
   * ولو حصل سباق حقيقي (تبويبين فتحوا الصفحة في نفس اللحظة ولقوها فاضية)، الباك-إند بيرفض
   * الإنشاء التاني بـ409 (`activeOrderPaymentGuard` + فحص المحاولة النشطة) — فبنقرا التحويل
   * اللي كسب بدل ما نعرض خطأ على حاجة نجحت فعلاً.
   */
  const load = useCallback(() => {
    // **سلسلة وعود مش `async/await`**: `setState` لازم يقع جوّه callback مش في جسم الدالة اللي
    // الأثر بينادّيها (`react-hooks/set-state-in-effect`) — نفس نمط باقي صفحات التطبيق.
    getInstaPayTransfer(authedFetch, id)
      .catch((err: unknown) => {
        // ٤٠٤ = مفيش تحويل مفتوح لسه، يعني دي أول زيارة للصفحة → نبدأ التحويل.
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
        return payWithInstaPay(authedFetch, id, crypto.randomUUID()).catch((startErr: unknown) => {
          // ٤٠٩ = تبويب تاني سبقنا وأنشأ التحويل (`activeOrderPaymentGuard` في الباك-إند
          // بيمنع تحويلين على نفس الطلب). نقرا اللي كسب بدل ما نعرض خطأ على حاجة نجحت.
          if (startErr instanceof ApiError && startErr.status === 409) {
            return getInstaPayTransfer(authedFetch, id);
          }
          throw startErr;
        });
      })
      .then((details) => {
        setReference(details);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof ApiError ? err.message : 'مش قادرين نجيب بيانات التحويل دلوقتي — جرّب تاني',
        );
      })
      .finally(() => setLoading(false));
  }, [authedFetch, id]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    load();
  }, [authLoading, isAuthenticated, load, router]);

  /** إعادة المحاولة بعد فشل — بتصفّر الحالة المعروضة الأول، وده مسموح جوّه معالج حدث. */
  const retry = () => {
    setLoading(true);
    setLoadError(null);
    load();
  };

  /** فحص صامت: بيوجّه لصفحة الطلب لو اتأكّد، وبيسكت لو لسه — **من غير ما يقلق العميل**. */
  const refreshPaymentStatus = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const order = await getMyOrder(authedFetch, id);
      if (order.payment_status === 'paid') {
        setCheckState('paid');
        router.replace(`/orders/${id}`);
      }
    } catch {
      // فشل الشبكة هنا مالوش أي أثر مرئي — ده فحص إضافي مش مسار أساسي.
    } finally {
      checkingRef.current = false;
    }
  }, [authedFetch, id, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshPaymentStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [isAuthenticated, refreshPaymentStatus]);

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 2000);
    } catch {
      // `navigator.clipboard` بيرمي على HTTP أو من غير إذن — النص نفسه قابل للتحديد يدويًا،
      // فالفشل هنا مابيقفلش المسار على العميل.
    }
  }

  async function handleTransferred() {
    setCheckState('checking');
    // بيتسجّل في الباك-إند إن العميل ادّعى التحويل — من غيره الأدمن معندهوش أي طريقة يعرف
    // مين مستني مراجعة قبل ما يأكّد بنفسه.
    try {
      await confirmInstaPayTransfer(authedFetch, id);
    } catch {
      // مش بلوكر — الاستطلاع تحت لسه بيحاول يكتشف تأكيد الأدمن نفسه.
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const order = await getMyOrder(authedFetch, id);
        if (order.payment_status === 'paid') {
          setCheckState('paid');
          router.replace(`/orders/${id}`);
          return;
        }
      } catch {
        // نكمّل المحاولات — انقطاع مؤقت مش سبب نقول للعميل إن التحويل فشل.
      }
    }
    setCheckState('still_pending');
  }

  if (authLoading || loading) {
    return <main className="mx-auto max-w-lg px-4 py-10 text-center text-muted">بيتحمّل...</main>;
  }

  if (!reference) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="mb-4">{loadError ?? 'مفيش تحويل مفتوح على الطلب ده'}</p>
        <div className="flex justify-center gap-2">
          <button onClick={retry} className="rounded-lg bg-primary px-4 py-2 text-white">
            حاول تاني
          </button>
          <button
            onClick={() => router.replace(`/orders/${id}`)}
            className="rounded-lg border border-border px-4 py-2"
          >
            رجوع للطلب
          </button>
        </div>
      </main>
    );
  }

  const checking = checkState === 'checking';
  return (
    <main className="mx-auto max-w-lg px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">الدفع عبر InstaPay</h1>

      {/* ① المبلغ أولاً: أول سؤال في دماغ العميل «أحوّل كام؟». */}
      <section className="rounded-xl bg-primary/10 p-5 text-center">
        <p className="text-sm font-semibold text-primary">المبلغ المطلوب</p>
        <p className="mt-1 text-3xl font-bold text-primary">{formatEgp(reference.amount_cents)}</p>
      </section>

      {/* ② الحساب — أهم سطر في الصفحة، وأخطر واحد لو اتقرا غلط. */}
      {reference.recipient_address && (
        <CopyableValue
          className="mt-3 border-primary/40 bg-primary/5"
          label="حوّل على الحساب ده"
          value={reference.recipient_address}
          subtitle={reference.recipient_name}
          copied={copied === 'address'}
          onCopy={() => void copy(reference.recipient_address!, 'address')}
        />
      )}

      {/* ③ رقم الطلب — لازم يتكتب في ملاحظة التحويل عشان الموظف يربط التحويل بالطلب. */}
      <CopyableValue
        className="mt-3"
        label="اكتب رقم الطلب ده في ملاحظة التحويل"
        value={reference.reference_code}
        copied={copied === 'reference'}
        onCopy={() => void copy(reference.reference_code, 'reference')}
      />

      {reference.qr_image_url && (
        <section className="mt-4 rounded-xl border border-border bg-surface p-4 text-center">
          <p className="mb-2 text-sm font-semibold">أو امسح الكود من تطبيق البنك</p>
          <Image
            src={reference.qr_image_url}
            alt="كود QR لتحويل InstaPay"
            width={220}
            height={220}
            unoptimized
            className="mx-auto h-auto w-[220px] rounded-lg bg-white p-2"
          />
        </section>
      )}

      {/* ④ الخطوات بالكلام — الأرقام كلها فوق، فالفقرة دي مفيهاش رقم يتلخبط. */}
      <section className="mt-4 rounded-xl border border-border bg-surface p-4">
        <p className="text-sm leading-7">{reference.instructions_ar}</p>
      </section>

      {/* ⑤ وعد وقت التأكيد — **رقم صريح مش تحذير**. */}
      <section className="mt-3 rounded-xl border border-border bg-surface p-4">
        <p className="font-bold">التأكيد عادةً خلال {humanizeMinutes(reference.confirm_typical_minutes)}</p>
        <p className="mt-1 text-sm leading-6 text-muted">
          وبحد أقصى {humanizeMinutes(reference.confirm_max_minutes)}. هيوصلك إشعار أول ما يتأكّد — مش
          محتاج تفضل فاتح الصفحة.
        </p>
      </section>

      {checkState === 'still_pending' && (
        <p className="mt-4 rounded-xl bg-primary/10 p-3 text-center text-sm text-primary">
          وصلنا إنك حوّلت ✅ بنراجع التحويل دلوقتي، وهيوصلك إشعار أول ما يتأكّد. تقدر تقفل الصفحة
          عادي — مش محتاج تستنى هنا.
        </p>
      )}

      <button
        onClick={() => void handleTransferred()}
        disabled={checking || checkState === 'paid'}
        className="mt-4 w-full rounded-lg bg-primary px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {checking ? 'بنتأكّد...' : checkState === 'paid' ? 'اتأكّد الدفع ✅' : 'حوّلت الفلوس'}
      </button>
    </main>
  );
}

/**
 * سطر قيمة قابل للنسخ — **القيمة لوحدها في سطر مستقل بـ`dir="ltr"`**.
 *
 * ده حل مشكلة حقيقية مش تجميل: الأرقام اللاتينية جوّه سياق عربي بتتعرض بترتيب خانات مقلوب،
 * فالعميل بينسخها أو يكتبها غلط. الخط الثابت كمان بيمنع الخلط بين المحارف المتشابهة.
 */
function CopyableValue({
  label,
  value,
  subtitle,
  copied,
  onCopy,
  className = '',
}: {
  label: string;
  value: string;
  subtitle?: string | null;
  copied: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 flex items-center gap-3">
        <span dir="ltr" className="flex-1 select-all font-mono text-lg font-bold tracking-wide">
          {value}
        </span>
        <button
          onClick={onCopy}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-primary/10"
        >
          {copied ? 'اتنسخ ✅' : 'نسخ'}
        </button>
      </div>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </section>
  );
}

/** ٦٠ دقيقة بتتقري «ساعة» — الناس بتفكّر بالساعات مش بستين دقيقة. */
function humanizeMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} دقيقة`;
  if (minutes === 60) return 'ساعة';
  if (minutes % 60 === 0) return `${minutes / 60} ساعات`;
  return `${minutes} دقيقة`;
}
