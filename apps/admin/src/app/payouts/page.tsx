'use client';

import { Fragment, useEffect, useState } from 'react';
import type { AdminPayoutResponseDto, PayoutOrderItemResponseDto, PayoutStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { PromptDialog } from '@/components/prompt-dialog';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { PAYOUT_METHOD_LABELS, PAYOUT_STATUS_LABELS, payoutStatusTone } from '@/lib/payments-labels';

const STATUS_FILTERS: { value: PayoutStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'under_review', label: 'قيد المراجعة' },
  { value: 'approved', label: 'موافَق عليها' },
  { value: 'completed', label: 'مكتملة' },
  { value: 'rejected', label: 'مرفوضة' },
];

export default function PayoutsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [payouts, setPayouts] = useState<AdminPayoutResponseDto[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<PayoutStatus | 'all'>('under_review');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<PayoutOrderItemResponseDto[] | null>(null);
  const [orderItemsLoading, setOrderItemsLoading] = useState(false);

  function load() {
    const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
    authedFetch<AdminPayoutResponseDto[]>(`/admin/payouts${query}`)
      .then(setPayouts)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل طلبات الصرف'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, statusFilter]);

  async function runAction(action: () => Promise<unknown>) {
    setIsSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleApprove(id: string) {
    await runAction(() => authedFetch(`/admin/payouts/${id}/approve`, { method: 'POST' }));
  }

  async function handleComplete(id: string) {
    await runAction(() => authedFetch(`/admin/payouts/${id}/complete`, { method: 'POST' }));
  }

  async function handleReject(id: string, reason: string) {
    await runAction(() => authedFetch(`/admin/payouts/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }));
  }

  async function toggleOrderItems(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setOrderItems(null);
      return;
    }
    setExpandedId(id);
    setOrderItems(null);
    setOrderItemsLoading(true);
    try {
      const items = await authedFetch<PayoutOrderItemResponseDto[]>(`/admin/payouts/${id}/order-items`);
      setOrderItems(items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تفاصيل الطلبات');
    } finally {
      setOrderItemsLoading(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title="طلبات الصرف" />

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!error && !payouts && <TableSkeleton columns={7} />}
      {payouts && payouts.length === 0 && <EmptyState title="مفيش طلبات صرف مطابقة" />}

      {payouts && payouts.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الرقم</TableHead>
              <TableHead>الفني</TableHead>
              <TableHead>المبلغ الصافي</TableHead>
              <TableHead>الطريقة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>تاريخ الطلب</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((payout) => (
              <Fragment key={payout.id}>
                <TableRow>
                  <TableCell dir="ltr">{payout.payout_number}</TableCell>
                  <TableCell>
                    {payout.technician_name}
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {payout.technician_code}
                    </span>
                  </TableCell>
                  <TableCell>{formatEgp(payout.net_amount_cents)}</TableCell>
                  <TableCell>{PAYOUT_METHOD_LABELS[payout.payout_method]}</TableCell>
                  <TableCell>
                    <StatusChip tone={payoutStatusTone(payout.payout_status)}>
                      {PAYOUT_STATUS_LABELS[payout.payout_status]}
                    </StatusChip>
                    {payout.payout_status === 'rejected' && payout.rejection_reason && (
                      <span className="block text-xs text-muted-foreground">{payout.rejection_reason}</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(payout.requested_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={isSaving} onClick={() => toggleOrderItems(payout.id)}>
                        {expandedId === payout.id ? 'إخفاء الطلبات' : 'تفاصيل الطلبات'}
                      </Button>
                      {payout.payout_status === 'under_review' && (
                        <Button size="sm" disabled={isSaving} onClick={() => handleApprove(payout.id)}>
                          موافقة
                        </Button>
                      )}
                      {payout.payout_status === 'approved' && (
                        <Button size="sm" disabled={isSaving} onClick={() => handleComplete(payout.id)}>
                          تأكيد التحويل
                        </Button>
                      )}
                      {(payout.payout_status === 'requested' ||
                        payout.payout_status === 'under_review' ||
                        payout.payout_status === 'approved' ||
                        payout.payout_status === 'processing') && (
                        <PromptDialog
                          trigger={
                            <Button size="sm" variant="destructive" disabled={isSaving}>
                              رفض
                            </Button>
                          }
                          title="رفض طلب الصرف"
                          label="سبب الرفض"
                          minLength={2}
                          confirmLabel="رفض"
                          destructive
                          onConfirm={(reason) => handleReject(payout.id, reason)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === payout.id && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      {orderItemsLoading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                      {!orderItemsLoading && orderItems && orderItems.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          مفيش طلبات مرتبطة بالصرف ده (المبلغ من رصيد مش مرتبط بأرباح طلبات معيّنة — بونص/تعديل يدوي مثلاً).
                        </p>
                      )}
                      {!orderItemsLoading && orderItems && orderItems.length > 0 && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-start text-muted-foreground">
                              <th className="p-1 text-start font-normal">رقم الطلب</th>
                              <th className="p-1 text-start font-normal">أرباح الفني</th>
                              <th className="p-1 text-start font-normal">عمولة المنصة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderItems.map((item) => (
                              <tr key={item.order_id}>
                                <td className="p-1 font-mono text-xs" dir="ltr">
                                  {item.order_id}
                                </td>
                                <td className="p-1">{formatEgp(item.earning_cents)}</td>
                                <td className="p-1">{formatEgp(item.commission_cents)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
