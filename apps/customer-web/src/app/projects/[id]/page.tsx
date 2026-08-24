import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

type AuthedFetch = <T>(path: string, options?: RequestInit) => Promise<T>;

interface RoomData {
  project: { id: string; name_ar: string; project_number: string; status: string; project_type: string };
  quotes: { id: number; version: number; status: string; total_cents: number; duration_days: number | null }[];
  milestones: { id: number; sequence_number: number; name_ar: string; amount_cents: number; execution_status: string; approval_status: string; payment_status: string; payout_status: string; is_down_payment: boolean }[];
  orders: { id: string; order_number: string; status: string; total_amount_cents: number }[];
  summary: { total_financed_cents: number; paid_cents: number; remaining_cents: number; milestone_count: number };
}

const egp = (c: number) => `${(c / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

export default function ProjectRoomPage() {
  const params = useParams();
  const projectId = params?.id as string;
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/v1/me/projects/${projectId}/room`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
    })
      .then((r) => r.json())
      .then((d) => setRoom(d.data))
      .catch(() => setError('خطأ في تحميل المشروع'));
  }, [projectId]);

  if (error) return <div className="mx-auto max-w-2xl px-4 py-8 text-danger">{error}</div>;
  if (!room) return <div className="mx-auto max-w-2xl px-4 py-16"><div className="h-64 animate-pulse rounded-xl bg-surface-variant" /></div>;

  const p = room.project;
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">{p.name_ar}</h1>
      <p className="text-muted">{p.project_number} · {p.status}</p>

      {/* المراحل */}
      <section className="mt-6">
        <h2 className="mb-3 font-semibold">المراحل</h2>
        {room.milestones.length === 0 ? <p className="text-muted">مفيش مراحل</p> : (
          <div className="space-y-2">
            {room.milestones.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{m.sequence_number}</span>
                <div className="flex-1">
                  <p className="font-medium">{m.name_ar}</p>
                  <p className="text-sm text-muted">{egp(m.amount_cents)}</p>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-xs" data-status={m.approval_status === 'approved' ? 'معتمدة' : m.execution_status} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* العروض */}
      <section className="mt-6">
        <h2 className="mb-3 font-semibold">العروض</h2>
        {room.quotes.length === 0 ? <p className="text-muted">مفيش عروض</p> : (
          room.quotes.map((q) => (
            <div key={q.id} className="mb-2 rounded-lg border border-border p-3">
              <span>عرض v{q.version}</span> — {egp(q.total_cents)} ({q.status})
            </div>
          ))
        )}
      </section>

      {/* الطلبات */}
      <section className="mt-6">
        <h2 className="mb-3 font-semibold">الطلبات</h2>
        {room.orders.length === 0 ? <p className="text-muted">مفيش طلبات</p> : (
          room.orders.map((o) => (
            <div key={o.id} className="mb-2 rounded-lg border border-border p-3">
              <span>{o.order_number}</span> — {egp(o.total_amount_cents)} ({o.status})
            </div>
          ))
        )}
      </section>
    </div>
  );
}
