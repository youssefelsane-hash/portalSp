'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { previewInstaPay, payWithWallet } from '@/lib/payments';
import { fetchWallet } from '@/lib/account';
import { formatEgp } from '@/lib/orders';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * **الدفع من رصيد المحفظة جوّه الطلب** (docs/08 §165، طلب مالك 2026-09-18).
 *
 * > «اتأكد إن الكاستمر اللي عنده رصيد في المحفظة — سواء جاله عن طريق استرداد أو تعويض شكوى —
 * > يعرف فعليًا يدفع بالجزء اللي على الموقع.»
 *
 * الرصيد ده حقيقي (استرداد طلب ملغي، تعويض شكوى، تعديل إداري) و`POST /orders/:id/pay-with-wallet`
 * شغّال من زمان والتطبيق بيستخدمه — بس **الويب مكانش فيه أي مسار له**. فالعميل كان بيشوف
 * الرقم في «محفظتي» ومايقدرش يستخدمه من المتصفح.
 *
 * ### ليه بنقرا `instapay-preview` هنا
 *
 * عشان سؤال «الطلب ده قابل للدفع دلوقتي بكام؟» يبقى له **مصدر واحد**. الشرط ده متكتب في
 * الباك-إند (`is_payable`/`is_closed`/`amount_cents`)، ولو حسبناه هنا تاني كان هيبقى نسختين
 * بتنحرفوا. الاستدعاء قراءة بحتة ومابيفتحش أي دفعة.
 *
 * **الحافز مش هنا عن قصد**: حافز InstaPay قرار وسيلة دفع خاص بالتحويل، فبنعرض
 * `cash_amount_cents` (السعر المعتاد) عشان العميل مايفتكرش إن الدفع بالمحفظة هياخد الهدية.
 */
export function WalletPaySection({
  authedFetch,
  orderId,
  onPaid,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
  onPaid: () => void;
}) {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const [dueCents, setDueCents] = useState<number | null>(null);
  const [payable, setPayable] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchWallet(authedFetch), previewInstaPay(authedFetch, orderId)])
      .then(([wallet, preview]) => {
        if (!active) return;
        setBalanceCents(wallet.balance_cents);
        setIsFrozen(wallet.is_frozen);
        setDueCents(preview.is_closed ? null : preview.cash_amount_cents);
        setPayable(preview.is_payable && !preview.is_closed);
      })
      // فشل القراءة بيخفي الخانة بهدوء — مايصحّش يبوّظ صفحة الطلب كلها (نفس قاعدة خانة InstaPay).
      .catch(() => { if (active) setBalanceCents(null); });
    return () => { active = false; };
  }, [authedFetch, orderId]);

  // رصيد صفر = مفيش حاجة تتعرض أصلاً. الخانة دي مالهاش معنى غير لما يكون فيه فلوس فعلاً.
  if (balanceCents === null || balanceCents <= 0 || dueCents === null) return null;

  const coversFullAmount = balanceCents >= dueCents;

  async function handlePay() {
    setIsPaying(true);
    setError(null);
    try {
      await payWithWallet(authedFetch, orderId);
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حصل خطأ أثناء الدفع من المحفظة');
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-semibold">ادفع من رصيد محفظتك</h2>
      <p className="text-sm text-muted-foreground">
        رصيدك المتاح: <span className="font-semibold text-foreground">{formatEgp(balanceCents)}</span>
        {' · '}المطلوب على الطلب ده: <span className="font-semibold text-foreground">{formatEgp(dueCents)}</span>
      </p>

      {isFrozen ? (
        <p className="mt-3 text-sm text-warning-foreground">
          محفظتك متجمّدة مؤقتًا، فمينفعش تدفع منها دلوقتي. تواصل مع الدعم.
        </p>
      ) : !coversFullAmount ? (
        // الدفع الجزئي مش مدعوم في الباك-إند، فالوعد بيه هنا كان هيبقى كذب.
        <p className="mt-3 text-sm text-muted-foreground">
          رصيدك أقل من المطلوب، والدفع من المحفظة بيتم بالكامل أو لأ. تقدر تدفع بوسيلة تانية،
          والرصيد يفضل لطلب جاي.
        </p>
      ) : !payable ? (
        <p className="mt-3 text-sm text-muted-foreground">
          هتقدر تدفع من المحفظة أول ما الفاتورة تبقى جاهزة.
        </p>
      ) : (
        <button
          onClick={handlePay}
          disabled={isPaying}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {isPaying ? 'جاري الدفع…' : `ادفع ${formatEgp(dueCents)} من المحفظة`}
        </button>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        <Link href="/account/wallet" className="underline">
          شوف كل حركات المحفظة
        </Link>
      </p>
    </section>
  );
}
