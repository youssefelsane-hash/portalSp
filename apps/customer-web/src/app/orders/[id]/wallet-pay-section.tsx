'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { payWithWallet } from '@/lib/payments';
import { fetchWallet } from '@/lib/account';
import { formatEgp, OrderResponseDto } from '@/lib/orders';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * الحالات اللي لسه فيها مبلغ ممكن يتدفع — **نسخة طبق الأصل من `_payableOrderStatuses`** في
 * `apps/customer-app/lib/features/orders/order_detail_screen.dart`. أي تغيير هنا لازم يتغيّر
 * هناك، وإلا الويب والتطبيق يعرضوا مدخلين دفع مختلفين على نفس الطلب.
 */
const PAYABLE_ORDER_STATUSES = new Set(['work_completed', 'awaiting_payment', 'pending_payment']);

/**
 * **الدفع من رصيد المحفظة جوّه الطلب** (docs/08 §165، طلب مالك 2026-09-18).
 *
 * > «أنا ككاستمر طلبت طلب، مش عارف أدفع بالفلوس اللي معايا على الموقع، أعمل إيه عشان أدفع بيها؟»
 *
 * ### ليه النسخة الأولى فضلت مش ظاهرة
 *
 * كانت بتقرا `GET /orders/:id/instapay-preview` عشان تعرف «المطلوب كام»، وبتختفي بالكامل لو
 * النداء ده فشل أو رجّع `is_closed`. يعني ربطت وسيلة دفع بوسيلة دفع تانية بلا داعي: بيئة
 * InstaPay مش متظبطة فيها ⇒ خانة المحفظة تختفي، والعميل يفضل شايف رصيده ومش عارف يستخدمه.
 *
 * دلوقتي بتقرا **الطلب نفسه** (`amount_due_now_cents` وحالة الدفع) — نفس المصدر اللي تطبيق
 * العميل بيقرا منه بالظبط، فالويب والتطبيق بيعرضوا نفس المدخل على نفس الطلب.
 *
 * ### ومابتختفيش بصمت
 *
 * لو فيه رصيد ولسه مش ينفع يتدفع دلوقتي، الخانة **بتفضل ظاهرة وبتقول السبب**. الاختفاء
 * الصامت هو اللي بيخلي العميل يفتكر إن الخيار مش موجود أصلاً.
 */
export function WalletPaySection({
  authedFetch,
  order,
  onPaid,
}: {
  authedFetch: AuthedFetch;
  order: OrderResponseDto;
  onPaid: () => void;
}) {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [isFrozen, setIsFrozen] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchWallet(authedFetch)
      .then((wallet) => {
        if (!active) return;
        setBalanceCents(wallet.balance_cents);
        setIsFrozen(wallet.is_frozen);
      })
      .catch(() => {
        if (active) setBalanceCents(null);
      });
    return () => {
      active = false;
    };
  }, [authedFetch]);

  // مفيش رصيد = مفيش خانة. دي الحالة الوحيدة اللي الإخفاء فيها صادق.
  if (balanceCents === null || balanceCents <= 0) return null;

  // المطلوب دلوقتي من الطلب نفسه؛ `amount_due_now_cents` بيرجع للإجمالي لو مش محسوب.
  const dueCents = order.amount_due_now_cents ?? order.total_amount_cents;
  const isPayableNow =
    PAYABLE_ORDER_STATUSES.has(order.order_status) && (order.payment_status !== 'paid' || dueCents > 0);
  const coversFullAmount = balanceCents >= dueCents;

  async function handlePay() {
    setIsPaying(true);
    setError(null);
    try {
      await payWithWallet(authedFetch, order.id);
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
      <p className="text-sm text-muted">
        رصيدك المتاح: <span className="font-semibold text-fg">{formatEgp(balanceCents)}</span>
        {isPayableNow && (
          <>
            {' · '}المطلوب دلوقتي: <span className="font-semibold text-fg">{formatEgp(dueCents)}</span>
          </>
        )}
      </p>

      {isFrozen ? (
        <p className="mt-3 text-sm text-danger">محفظتك متجمّدة مؤقتًا، فمينفعش تدفع منها دلوقتي. كلّم الدعم.</p>
      ) : !isPayableNow ? (
        <p className="mt-3 text-sm text-muted">
          الطلب ده مفيهوش مبلغ مستحق دلوقتي. هتقدر تدفع من رصيدك أول ما الشغل يخلص وتيجي الفاتورة.
        </p>
      ) : !coversFullAmount ? (
        // الدفع الجزئي مش مدعوم في الباك-إند، فالوعد بيه هنا كان هيبقى كذب.
        <p className="mt-3 text-sm text-muted">
          رصيدك أقل من المطلوب، والدفع من المحفظة بيتم بالكامل أو لأ. ادفع بوسيلة تانية والرصيد
          يفضل لطلب جاي.
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

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted">
        <Link href="/account/wallet" className="underline">
          شوف كل حركات المحفظة
        </Link>
      </p>
    </section>
  );
}
