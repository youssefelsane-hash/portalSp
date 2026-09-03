'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { listMyOrders, orderStatusLabelsAr, formatEgp, OrderResponseDto } from '@/lib/orders';

export default function OrdersPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, authedFetch } = useAuth();
  const [orders, setOrders] = useState<OrderResponseDto[] | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login?next=/orders');
      return;
    }
    if (isAuthenticated) {
      listMyOrders(authedFetch).then((list) =>
        setOrders([...list].sort((a, b) => (b.placed_at ?? '').localeCompare(a.placed_at ?? ''))),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, authLoading]);

  if (authLoading || (isAuthenticated && orders === null)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-surface-variant" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">طلباتي</h1>
      {!orders || orders.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-muted">لسه معملتش أي طلب</p>
          <Link href="/" className="mt-3 inline-block text-primary hover:underline">
            احجز أول طلب
          </Link>
        </div>
      ) : (
        <div className="motion-list space-y-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="motion-rise motion-press flex items-center justify-between rounded-xl border border-border bg-surface p-4 transition-colors hover:border-primary"
            >
              <div>
                <p className="font-medium">طلب #{o.order_number}</p>
                <p className="text-sm text-muted">{orderStatusLabelsAr[o.order_status] ?? o.order_status}</p>
              </div>
              <span className="font-semibold text-primary">{formatEgp(o.total_amount_cents)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
