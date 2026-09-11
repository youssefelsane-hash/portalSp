'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api-client';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

export type OrderAdjustmentParticipant = {
  technician_id: string;
  full_name: string;
  role_label: string;
};

type OrderAdjustment = {
  id: string;
  technician_id: string;
  technician_name: string;
  participant_role: string | null;
  adjustment_bps: number;
  reason: string;
  created_at: string;
};

type OrderAdjustmentsResponse = {
  is_settled: boolean;
  supports_order_adjustments: boolean;
  items: OrderAdjustment[];
};

/**
 * **استثناء مستحقات على الطلب ده بالذات** (docs/08 §136).
 *
 * `order_earning_adjustments` كان بيتقرا في محرك التسوية من migration 0227 وبيتضرب في وزن
 * المشارك صح — بس مفيش أي شاشة ولا endpoint بيكتب فيه. يعني «الشغلانة دي كانت أصعب، زوّد
 * نصيب الفني عليها» كان **مستحيل** يتعمل، رغم إن النظام جاهز يحسبه.
 *
 * القسم ده بيتعطّل بنفسه في حالتين، بدل ما يسيب الأدمن يكتب وياخد رفض:
 *   - **التسوية اتقفلت**: الحصص اتسجّلت و`recordV2Shares()` مابيعيدش الحساب أبدًا، فأي
 *     استثناء بعدها صف ميت. الباك-إند بيرفض بـ409، والقسم بيوضّح السبب من الأول.
 *   - **طلب على تسوية V1**: المحرك القديم مابيقراش الجدول ده خالص.
 */
export function OrderEarningAdjustmentsSection({
  authedFetch,
  orderId,
  participants,
  onChanged,
}: {
  authedFetch: AuthedFetch;
  orderId: string;
  /** المشاركون في الطلب — الباك-إند بيرفض أي حد برّههم، فالقايمة بتمنع الاختيار الغلط من الأصل. */
  participants: OrderAdjustmentParticipant[];
  /** بعد أي تغيير: نعيد تحميل توزيع المستحقات عشان الأرقام المعروضة تتحرك فورًا. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<OrderAdjustmentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    authedFetch<OrderAdjustmentsResponse>(`/admin/earnings-policy/orders/${orderId}/adjustments`)
      .then((result) => {
        setData(result);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof ApiError ? err.message : 'تعذّر تحميل استثناءات الطلب');
      });
  }, [authedFetch, orderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/earnings-policy/orders/${orderId}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          technician_id: form.get('technician_id'),
          // الواجهة بالمئة والباك-إند بالـbps — التحويل هنا عشان الأدمن مايكتبش ٢٠٠٠ وهو قاصد ٢٠٪.
          adjustment_bps: Math.round(Number(form.get('percentage')) * 100),
          reason: form.get('reason'),
        }),
      });
      setOpen(false);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر حفظ الاستثناء');
    } finally {
      setBusy(false);
    }
  }

  async function disable(technicianId: string) {
    const reason = window.prompt('سبب الإلغاء (٣ حروف على الأقل):');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/admin/earnings-policy/orders/${orderId}/adjustments/${technicianId}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      });
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إلغاء الاستثناء');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <p className="border-t p-3 text-sm text-destructive">{loadError}</p>;
  }
  if (!data) {
    return <p className="border-t p-3 text-sm text-muted-foreground">جاري تحميل استثناءات الطلب…</p>;
  }
  if (!data.supports_order_adjustments) {
    return (
      <p className="border-t p-3 text-xs text-muted-foreground">
        الطلب ده على نسخة تسوية قديمة مابتقراش استثناءات الطلب — أي تعديل عليه لازم يتم كتسوية يدوية.
      </p>
    );
  }

  const canEdit = !data.is_settled;
  return (
    <div className="border-t p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">استثناء على الطلب ده</p>
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? 'نسبة تزيد أو تقلّل نصيب فرد من وعاء الطاقم في الطلب ده وحده. وعاء الطاقم وعمولة المنصة مابيتغيروش — بس التوزيع جواه.'
              : 'التسوية اتقفلت والحصص اتسجّلت — أي استثناء دلوقتي مش هيغيّر أي مبلغ. التعديل بعد الإقفال بيتم كتسوية يدوية على محفظة الفني.'}
          </p>
        </div>
        {canEdit && participants.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
            {open ? 'إلغاء' : 'إضافة استثناء'}
          </Button>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {open && canEdit && (
        <form onSubmit={submit} className="mt-3 grid gap-3 rounded-md border p-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Label className="text-xs">الفرد</Label>
            <select name="technician_id" required className="mt-1 h-10 w-full rounded-md border px-2 text-sm">
              {participants.map((participant) => (
                <option key={participant.technician_id} value={participant.technician_id}>
                  {participant.full_name} — {participant.role_label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">النسبة %</Label>
            {/* الحدود مطابقة لـ`CHECK` بتاع الجدول: أكبر من −١٠٠٪ وأقل من أو يساوي +٢٠٠٪. */}
            <Input
              name="percentage"
              type="number"
              step="0.01"
              min="-99.99"
              max="200"
              defaultValue="10"
              dir="ltr"
              required
              className="mt-1"
            />
          </div>
          <div className="sm:col-span-4">
            <Label className="text-xs">السبب</Label>
            <Input name="reason" minLength={3} maxLength={1000} required className="mt-1" />
          </div>
          <div className="sm:col-span-4">
            <Button size="sm" disabled={busy}>{busy ? 'جاري الحفظ…' : 'حفظ الاستثناء'}</Button>
          </div>
        </form>
      )}

      {data.items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">مفيش استثناءات على الطلب ده.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{item.technician_name}</span>
                <span className={item.adjustment_bps >= 0 ? 'text-emerald-700' : 'text-destructive'}>
                  {' '}
                  {item.adjustment_bps >= 0 ? '+' : ''}
                  {(item.adjustment_bps / 100).toFixed(2)}%
                </span>
                <span className="block text-xs text-muted-foreground">{item.reason}</span>
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => disable(item.technician_id)}>
                  إلغاء
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
