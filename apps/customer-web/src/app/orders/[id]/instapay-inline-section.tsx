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

  if (!preview) return null;
  // **الطلب اتقفل ⇒ الخانة كلها بتختفي** (بلاغ مالك 2026-09-15، docs/08 §150 بند ٤:
  // «طالما الطلب اتقفل ما يظهروش أصلاً الجزء بتاعه لسه خالص»).
  //
  // الخانة اتبنت «دايمًا موجودة» عن قصد (ADR-0089) عشان العميل اللي اختار كاش يلاقي الخيار
  // قدامه. لكن «دايمًا» دي كانت بتمتد لبعد ما الطلب يخلص، فطلب مقفول كان بيعرض «تحب تدفع
  // أونلاين بدل الكاش؟ / لسه بيتحدد» وزرار معطّل بيقول «هتقدر تبدأ التحويل أول ما السعر
  // يتحدد» — وعد بحاجة مش هتحصل.
  //
  // القرار جاي من الباك-إند (`is_closed`) مش محسوب هنا: نفس الخانة موجودة في التطبيق كمان،
  // وشرط متكتب مرتين بينحرف مرة.
  if (preview.is_closed) return null;

  const isCashOrder = paymentMethod === 'cash';

  return (
    <section className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {isCashOrder ? 'تحب تدفع أونلاين بدل الكاش؟' : 'ادفع بـInstaPay'}
        </h2>
        <span className="text-right">
          {preview.instapay_discount_cents > 0 && (
            <span className="block text-sm text-muted line-through">{formatEgp(preview.cash_amount_cents)}</span>
          )}
          {/* طلب لسه مالوش سعر بيرجّع صفر — و«0 ج.م.» في خانة دفع بتقري "ببلاش". */}
          <span className="text-lg font-bold">
            {preview.amount_cents > 0 ? formatEgp(preview.amount_cents) : 'لسه بيتحدد'}
          </span>
        </span>
      </div>

      {preview.instapay_discount_cents > 0 && (
        <p className="mt-1 text-sm text-primary">
          هدية InstaPay: وفّر {formatEgp(preview.instapay_discount_cents)}.
        </p>
      )}

      {/* ADR-0091 §6 — الزيادة بعد طلب مدفوع مالهاش حافز. السكوت عن السبب كان بيخلّي العميل
          يفتكر الخصم اتسحب منه، فالسطر ده بيقول القاعدة بدل ما يخبّيها. */}
      {preview.is_additional_charge ? (
        <p className="mt-1 text-sm text-muted">
          ده مبلغ الزيادة اللي وافقت عليها بس. الخصم بياخده الطلب مرة واحدة، وهو اتحسب على الدفعة الأولى.
        </p>
      ) : preview.is_prepayment ? (
        <p className="mt-1 text-sm text-muted">
          {preview.instapay_discount_cents > 0
            ? 'تقدر تحوّل دلوقتي على طول وتاخد الهدية — ولو الشغل احتاج بند إضافي بعدين، هتدفع الفرق بس.'
            : 'تقدر تحوّل دلوقتي على طول — ولو الشغل احتاج بند إضافي بعدين، هتدفع الفرق بس.'}
        </p>
      ) : isCashOrder ? (
        <p className="mt-1 text-sm text-muted">
          {preview.instapay_discount_cents > 0
            ? 'الكاش بالسعر المعتاد؛ اختار InstaPay عشان تستفيد من الهدية.'
            : 'الطلب متسجّل كاش، وده مايمنعش إنك تحوّل أونلاين في أي وقت.'}
        </p>
      ) : null}

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

      {preview.is_payable ? (
        <Link
          href={`/orders/${orderId}/instapay`}
          className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90"
        >
          {preview.has_open_transfer ? 'كمّل التحويل' : 'ابدأ التحويل بـInstaPay'}
        </Link>
      ) : (
        // ADR-0091 §2 — «مش عايز أستنى لحد ما الفني يخلّص عشان أعرف أدفع» (طلب مالك). الحالة
        // الوحيدة الفاضلة هنا إن الطلب لسه مالوش سعر.
        <p className="mt-3 text-sm text-muted">هتقدر تبدأ التحويل أول ما السعر يتحدد.</p>
      )}
    </section>
  );
}
