'use client';

import { useState } from 'react';
import { rateOrder, type CreateRatingBody } from '@/lib/ratings';
import { ApiError } from '@/lib/api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * تقييم الطلب بعد اكتماله (docs/08 §128) — كان موجود في `apps/customer-app` بس.
 *
 * الأبعاد الخمسة الاختيارية مطابقة بالحرف لـ`rating_dialog.dart` ولـ`CreateRatingDto`: التقييم
 * العام إجباري، والباقي بيتبعت بس لو العميل حدده فعلاً (مش صفر ولا 1 افتراضية — إرسال قيمة
 * لبُعد العميل مالمسهوش بيلوّث متوسطات الفني).
 *
 * 409 معناها «اتقيّم قبل كده» — بنعتبرها نجاح من ناحية الواجهة زي `_rate()` في تطبيق العميل
 * بالظبط، مش خطأ يخلي العميل يحاول تاني على طلب متقيّم أصلاً.
 */
export function RatingSection({
  authedFetch,
  orderId,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
}) {
  const [overall, setOverall] = useState(0);
  const [punctuality, setPunctuality] = useState(0);
  const [quality, setQuality] = useState(0);
  const [professionalism, setProfessionalism] = useState(0);
  const [priceFairness, setPriceFairness] = useState(0);
  const [cleanliness, setCleanliness] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  async function submit() {
    if (overall < 1) return;
    setBusy(true);
    setError(null);
    const body: CreateRatingBody = {
      overall_rating: overall,
      ...(punctuality > 0 ? { punctuality_rating: punctuality } : {}),
      ...(quality > 0 ? { quality_rating: quality } : {}),
      ...(professionalism > 0 ? { professionalism_rating: professionalism } : {}),
      ...(priceFairness > 0 ? { price_fairness_rating: priceFairness } : {}),
      ...(cleanliness > 0 ? { cleanliness_rating: cleanliness } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    try {
      const result = await rateOrder(authedFetch, orderId, body);
      setDone(true);
      if (result.google_review_prompt.should_prompt && result.google_review_prompt.review_url) {
        setReviewUrl(result.google_review_prompt.review_url);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDone(true);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'تعذّر إرسال التقييم');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <p className="font-medium text-success">شكراً على تقييمك 🙏</p>
        {reviewUrl && (
          <a
            href={reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-primary underline"
          >
            تحب تكتب لنا مراجعة على Google كمان؟
          </a>
        )}
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-semibold">قيّم الطلب</h2>
      <p className="mb-3 text-sm text-muted">تقييمك بيساعد فنيين أحسن يوصلوا لعملاء أكتر.</p>

      <StarRow label="التقييم العام" value={overall} onChange={setOverall} required />
      <StarRow label="المواعيد" value={punctuality} onChange={setPunctuality} />
      <StarRow label="جودة الشغل" value={quality} onChange={setQuality} />
      <StarRow label="التعامل" value={professionalism} onChange={setProfessionalism} />
      <StarRow label="عدالة السعر" value={priceFairness} onChange={setPriceFairness} />
      <StarRow label="النظافة" value={cleanliness} onChange={setCleanliness} />

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="تعليق (اختياري)"
        className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <button
        onClick={submit}
        disabled={busy || overall < 1}
        className="mt-3 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? 'بنبعت...' : 'إرسال التقييم'}
      </button>
    </section>
  );
}

function StarRow({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            aria-label={`${label}: ${star} من 5`}
            aria-pressed={value === star}
            className={`text-xl leading-none ${star <= value ? 'text-warning' : 'text-muted'}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
