'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOrder, type OrderResponseDto } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * طلب إعادة زيارة تحت الضمان (docs/08 §125، §7) — كان في `apps/customer-app` بس.
 *
 * مفيش endpoint خاص بإعادة الزيارة: الباك-إند بياخدها كطلب عادي فيه `original_order_id`
 * (`CreateOrderDto`)، وهو اللي بيصفّر السعر وبيرجّع لنفس الفني الأصلي (ADR-0051). يعني الويب
 * بيستخدم **نفس المسار** بالحرف اللي التطبيق بيستخدمه — صفر منطق موازي هنا.
 *
 * `warranty_expires_at` هو مصدر الحقيقة الوحيد لأهلية الضمان (نفس اشتقاق `isUnderWarranty`
 * في `models.dart`) — مفيش حقل `is_under_warranty` في الرد أصلاً، والاتنين بيحسبوه من نفس العمود.
 */
export function WarrantyRevisitSection({
  authedFetch,
  order,
}: {
  authedFetch: AuthedFetch;
  order: OrderResponseDto;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // نفس درس customer-app: المفتاح بيتولّد مرة واحدة بس مدى عمر الكومبوننت — توليده جوّه submit()
  // كان هيلغي الحماية لأي إعادة محاولة بعد timeout شبكة.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const revisit = await createOrder(
        authedFetch,
        {
          service_id: order.service_id,
          address_id: order.address_id,
          booking_mode: order.booking_mode as 'individual' | 'team' | 'emergency',
          original_order_id: order.id,
        },
        idempotencyKey,
      );
      router.push(`/orders/${revisit.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إرسال طلب إعادة الزيارة');
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 font-semibold">الطلب تحت الضمان</h2>
      <p className="mb-3 text-sm text-muted">
        لو الشغل رجع باظ، تقدر تطلب إعادة زيارة <strong>مجانية بالكامل</strong> لنفس الفني.
        الضمان ساري لحد {new Date(order.warranty_expires_at!).toLocaleDateString('ar-EG-u-nu-latn')}.
      </p>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="rounded-lg border border-border px-5 py-2.5 font-medium"
        >
          طلب إعادة زيارة (ضمان)
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'بنبعت...' : 'تأكيد الطلب'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-lg border border-border px-5 py-2.5 font-medium"
          >
            رجوع
          </button>
        </div>
      )}
    </section>
  );
}
