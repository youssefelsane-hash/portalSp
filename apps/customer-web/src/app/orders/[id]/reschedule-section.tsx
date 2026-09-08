'use client';

import { useState } from 'react';
import { fetchRescheduleOptions, rescheduleOrder, type OrderResponseDto, type RescheduleDateOptionDto } from '@/lib/orders';
import { ApiError } from '@/lib/api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

/**
 * "غيّر ميعاد الزيارة" (docs/08 §82 — توازي الميزات مع apps/customer-app). فتح القسم بيجيب
 * أيام الفني المعيّن المتاحة (أخضر/أحمر) — العميل يختار يوم متاح ويأكّد. الباك-إند بيرفض بوضوح
 * لو الحالة تغيّرت أو الفني بدأ يتحرّك فعلاً بين الفتح والتأكيد.
 */
export function RescheduleSection({
  authedFetch,
  orderId,
  onRescheduled,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
  onRescheduled: (order: OrderResponseDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RescheduleDateOptionDto[] | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<'customer_request' | 'availability_change' | 'address_access' | 'other'>('customer_request');
  const [reasonDetails, setReasonDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setOpen(true);
    if (options === null) {
      fetchRescheduleOptions(authedFetch, orderId)
        .then(setOptions)
        .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذّر تحميل المواعيد المتاحة'));
    }
  }

  async function submit() {
    if (!selectedDate) return;
    setBusy(true);
    setError(null);
    try {
      const order = await rescheduleOrder(authedFetch, orderId, selectedDate, reasonCode, reasonDetails);
      onRescheduled(order);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تغيير الميعاد');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={handleOpen} className="mt-4 text-sm text-primary hover:underline">
        غيّر ميعاد الزيارة
      </button>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 font-semibold">اختار ميعاد تاني</h2>
      {options === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-surface-variant" />
      ) : options.length === 0 ? (
        <p className="text-sm text-muted">مفيش مواعيد بديلة متاحة للفني حاليًا</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {options.map((opt) => (
            <button
              key={opt.date}
              disabled={!opt.available}
              onClick={() => setSelectedDate(opt.date)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                !opt.available
                  ? 'cursor-not-allowed border-border text-muted opacity-50'
                  : selectedDate === opt.date
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-surface-variant'
              }`}
            >
              {new Date(opt.date).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' })}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <label className="mt-4 block text-sm font-medium">
        سبب تغيير الموعد
        <select
          value={reasonCode}
          onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}
          className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"
        >
          <option value="customer_request">تغيير خطة العميل</option>
          <option value="availability_change">تغيّر وقتي المتاح</option>
          <option value="address_access">تعذّر الدخول إلى العنوان</option>
          <option value="other">سبب آخر</option>
        </select>
      </label>
      {reasonCode === 'other' && (
        <label className="mt-3 block text-sm font-medium">
          اكتب السبب
          <input
            value={reasonDetails}
            onChange={(event) => setReasonDetails(event.target.value)}
            maxLength={500}
            required
            className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"
          />
        </label>
      )}
      <div className="mt-4 flex gap-2">
        <button
          disabled={busy || !selectedDate || (reasonCode === 'other' && !reasonDetails.trim())}
          onClick={submit}
          className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جاري التأكيد...' : 'تأكيد الميعاد الجديد'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-border px-4 py-2">
          تراجع
        </button>
      </div>
    </section>
  );
}
