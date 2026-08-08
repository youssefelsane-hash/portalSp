'use client';

import { useEffect, useState } from 'react';
import type { AdminPayoutResponseDto, PayoutStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';
import { PAYOUT_METHOD_LABELS, PAYOUT_STATUS_LABELS, payoutStatusBadgeVariant } from '@/lib/payments-labels';

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

  async function handleReject(id: string) {
    const reason = window.prompt('سبب الرفض (لازم يكون حرفين على الأقل)؟');
    if (reason === null) return;
    if (reason.trim().length < 2) {
      window.alert('سبب الرفض قصير جداً');
      return;
    }
    await runAction(() => authedFetch(`/admin/payouts/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }));
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-xl font-semibold">طلبات الصرف</h1>

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
      {!error && !payouts && <p className="text-muted-foreground">جاري التحميل…</p>}
      {payouts && payouts.length === 0 && <p className="text-muted-foreground">مفيش طلبات صرف مطابقة</p>}

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
              <TableRow key={payout.id}>
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
                  <Badge variant={payoutStatusBadgeVariant(payout.payout_status)}>
                    {PAYOUT_STATUS_LABELS[payout.payout_status]}
                  </Badge>
                  {payout.payout_status === 'rejected' && payout.rejection_reason && (
                    <span className="block text-xs text-muted-foreground">{payout.rejection_reason}</span>
                  )}
                </TableCell>
                <TableCell>{new Date(payout.requested_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
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
                      <Button size="sm" variant="destructive" disabled={isSaving} onClick={() => handleReject(payout.id)}>
                        رفض
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
