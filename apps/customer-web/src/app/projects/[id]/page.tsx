'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';

interface RoomData {
  project: { id: string; name_ar: string; project_number: string; status: string; project_type: string };
  quotes: { id: string; version: number; status: string; total_cents: number; duration_days: number | null }[];
  milestones: { id: string; sequence_number: number; name_ar: string; amount_cents: number; execution_status: string; approval_status: string; payment_status: string; payout_status: string; is_down_payment: boolean }[];
  orders: { id: string; order_number: string; status: string; total_amount_cents: number }[];
  warranties: { id: string; name_ar: string; coverage_months: number; expires_at: string; claims_used: number }[];
  summary: { total_financed_cents: number; paid_cents: number; remaining_cents: number; milestone_count: number };
}

const egp = (cents: number) => `${(cents / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

export default function ProjectRoomPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.id as string;
  const { isAuthenticated, isLoading, authedFetch } = useAuth();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actingQuote, setActingQuote] = useState<string | null>(null);

  function load() {
    setError(null);
    authedFetch<RoomData>(`/me/projects/${projectId}/room`)
      .then(setRoom)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ في تحميل المشروع'));
  }

  useEffect(() => {
    if (isLoading || !projectId) return;
    if (!isAuthenticated) {
      router.push(`/login?next=/projects/${projectId}`);
      return;
    }
    void authedFetch<RoomData>(`/me/projects/${projectId}/room`)
      .then((data) => {
        setRoom(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ في تحميل المشروع'));
  }, [authedFetch, isAuthenticated, isLoading, projectId, router]);

  async function approveQuote(quoteId: string) {
    setActingQuote(quoteId);
    try {
      await authedFetch(`/me/projects/${projectId}/quotes/${quoteId}/approve`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذرت الموافقة على العرض');
    } finally {
      setActingQuote(null);
    }
  }

  if (error && !room) return <div className="mx-auto max-w-2xl px-4 py-8 text-danger">{error}</div>;
  if (!room) return <div className="mx-auto max-w-2xl px-4 py-16"><div className="h-64 animate-pulse rounded-xl bg-surface-variant" /></div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-bold">{room.project.name_ar}</h1>
      <p className="text-muted">{room.project.project_number} · {room.project.status}</p>
      {error && <p className="mt-3 text-danger">{error}</p>}

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">المراحل</h2>
        {room.milestones.length === 0 ? <p className="text-muted">مفيش مراحل</p> : room.milestones.map((milestone) => (
          <div key={milestone.id} className="mb-2 flex items-center gap-3 rounded-lg bg-surface-variant p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">{milestone.sequence_number}</span>
            <div className="flex-1"><p className="font-medium">{milestone.name_ar}</p><p className="text-sm text-muted">{egp(milestone.amount_cents)} · {milestone.approval_status}</p></div>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">عروض الأسعار</h2>
        {room.quotes.length === 0 ? <p className="text-muted">مفيش عروض</p> : room.quotes.map((quote) => (
          <div key={quote.id} className="mb-2 flex items-center justify-between rounded-lg bg-surface-variant p-3">
            <span>عرض v{quote.version} · {egp(quote.total_cents)} · {quote.status}</span>
            {quote.status === 'sent' && <button disabled={actingQuote === quote.id} onClick={() => void approveQuote(quote.id)} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">موافقة</button>}
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">طلبات المشروع</h2>
        {room.orders.length === 0 ? <p className="text-muted">مفيش طلبات</p> : room.orders.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`} className="mb-2 block rounded-lg bg-surface-variant p-3 hover:opacity-80">{order.order_number} · {egp(order.total_amount_cents)} · {order.status}</Link>
        ))}
      </section>

      <section className="mt-6 rounded-xl border border-border p-4">
        <h2 className="mb-3 font-semibold">الضمانات</h2>
        {room.warranties.length === 0 ? <p className="text-muted">لا توجد ضمانات مرتبطة بالمشروع حاليًا</p> : room.warranties.map((warranty) => (
          <div key={warranty.id} className="mb-2 rounded-lg bg-surface-variant p-3">{warranty.name_ar} · حتى {new Date(warranty.expires_at).toLocaleDateString('ar-EG')}</div>
        ))}
      </section>
    </div>
  );
}
