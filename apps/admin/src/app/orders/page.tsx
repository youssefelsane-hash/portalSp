'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderResponseDto, OrderStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  orderStatusTone,
  PAYMENT_STATUS_LABELS,
  paymentStatusTone,
} from '@/lib/order-labels';
import { formatEgp } from '@/lib/format';

const PER_PAGE = 20;

const QUICK_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'searching_technician', label: ORDER_STATUS_LABELS.searching_technician },
  { value: 'in_progress', label: ORDER_STATUS_LABELS.in_progress },
  { value: 'completed', label: ORDER_STATUS_LABELS.completed },
  { value: 'disputed', label: ORDER_STATUS_LABELS.disputed },
];

export default function OrdersPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [orders, setOrders] = useState<OrderResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (statusFilter !== 'all') params.set('order_status', statusFilter);
    authedFetchPaginated<OrderResponseDto>(`/admin/orders?${params.toString()}`)
      .then(({ items, meta }) => {
        setOrders(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلبات'));
  }, [isLoading, page, statusFilter, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="الطلبات" />

      <div className="mb-4 flex gap-2">
        {QUICK_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => {
              setStatusFilter(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !orders && <p className="text-muted-foreground">جاري التحميل…</p>}
      {orders && orders.length === 0 && <EmptyState title="مفيش طلبات مطابقة" />}

      {orders && orders.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الطلب</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>حالة الدفع</TableHead>
                <TableHead>تاريخ الطلب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/orders/${order.id}`} className="block">
                      {order.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={order.order_type === 'emergency' ? 'destructive' : 'outline'}>
                      {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={orderStatusTone(order.order_status)}>
                      {ORDER_STATUS_LABELS[order.order_status]}
                    </StatusChip>
                  </TableCell>
                  <TableCell>{formatEgp(order.total_amount_cents)}</TableCell>
                  <TableCell>
                    <StatusChip tone={paymentStatusTone(order.payment_status)}>
                      {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                    </StatusChip>
                  </TableCell>
                  <TableCell>
                    {order.placed_at ? new Date(order.placed_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages} ({total} طلب إجمالاً)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
