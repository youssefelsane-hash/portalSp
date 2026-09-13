'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { InstaPayPreviewDto, previewInstaPay } from '@/lib/payments';
import { formatEgp } from '@/lib/orders';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * **خانة InstaPay الثابتة جوّه الطلب** (ADR-0089، طلب مالك 2026-09-13).
 *
 * > «خلي دايمًا موجود جوّه الطلب خانة الدفع by InstaPay… يظهر له السعر والبيانات اللي بتظهر
 * > عادي جدًا اللي هو كان هيدفع InstaPay من الأول… بحيث لو غيّر رأيه يعرف يدفع.»
 *
 * قبل كده كان فيه **زرار** بيوصّل لصفحة تانية. الفرق مش تجميلي: العميل اللي اختار كاش
 * مكانش عنده أي سبب يدوس على زرار دفع، فمكانش بيشوف إن الخيار موجود أصلاً. الحساب والمبلغ
 * قدام عينه بيحوّلوا الخيار من «حاجة لازم أدوّر عليها» لـ«حاجة قدامي».
 *
 * **مابتفتحش دفعة**: البيانات جاية من `GET /orders/:id/instapay-preview` (قراءة بحتة)، فمسار
 * الكاش بيفضل مفتوح بالكامل لحد ما العميل يدوس «ابدأ التحويل» بنفسه.
 */
export function InstaPayInlineSection({
  authedFetch,
  orderId,
  paymentMethod,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
  /** طريقة الدفع المسجّلة على الطلب — بتغيّر **نبرة** الخانة بس، مش وجودها. */
  paymentMethod: string | null;
}) {
  const [preview, setPreview] = useState<InstaPayPreviewDto | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    previewInstaPay(authedFetch, orderId)
      .then((data) => { if (active) setPreview(data); })
      // فشل المعاينة بيخفي الخانة بهدوء — مايصحّش يبوّظ صفحة الطلب كلها.
      .catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [authedFetch, orderId]);

  if (!preview || !preview.is_payable || preview.amount_cents <= 0) return null;

  const isCashOrder = paymentMethod === 'cash';

  return (
    <section className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {isCashOrder ? 'تحب تدفع أونلاين بدل الكاش؟' : 'ادفع بـInstaPay'}
        </h2>
        <span className="text-lg font-bold">{formatEgp(preview.amount_cents)}</span>
      </div>

      {isCashOrder && (
        <p className="mt-1 text-sm text-muted">
          الطلب متسجّل كاش، وده مايمنعش إنك تحوّل أونلاين في أي وقت — نفس المبلغ بالظبط.
        </p>
      )}

      {preview.recipient_address && (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3">
          <p className="text-xs text-muted">حوّل على الحساب ده</p>
          {/* الرقم في سطر لوحده وبـLTR — نفس قاعدة شاشة التحويل بالحرف (docs/08 §137). */}
          <p dir="ltr" className="mt-1 select-all break-all font-mono text-base font-semibold">
            {preview.recipient_address}
          </p>
          {preview.recipient_name && (
            <p className="mt-1 text-sm text-muted">باسم: {preview.recipient_name}</p>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(preview.recipient_address ?? '')
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
            className="mt-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary/50"
          >
            {copied ? 'اتنسخ ✓' : 'انسخ رقم الحساب'}
          </button>
        </div>
      )}

      {/* **التنبيه الزمني** (طلب مالك حرفي): «ينبّهه إنه يحوّل الفلوس قبل ما الشغل يخلص بوقت
          كافي بحيث نلحق نعمل المراجعة قبل الصنايع ما يمشي». الصياغة محايدة عمدًا — الغرض
          إن العميل ما يتفاجئش، مش إننا نخوّفه من الدفع أونلاين. */}
      <p className="mt-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted">
        لو هتحوّل، ابعت التحويل <strong>قبل ما الشغل يخلص</strong> بوقت كافي — مراجعة التحويل
        بتاخد حوالي {preview.confirm_typical_minutes} دقيقة (لحد {preview.confirm_max_minutes}{' '}
        دقيقة في أوقات الزحمة)، وعايزين نخلّصها والفني لسه معاك.
      </p>

      <Link
        href={`/orders/${orderId}/instapay`}
        className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
      >
        {preview.has_open_transfer ? 'كمّل التحويل' : 'ابدأ التحويل بـInstaPay'}
      </Link>
    </section>
  );
}
