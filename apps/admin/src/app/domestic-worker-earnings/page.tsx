'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { PromptDialog } from '@/components/prompt-dialog';
import { StatusChip } from '@/components/status-chip';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatEgp } from '@/lib/format';

type EarningStatus = 'pending' | 'approved' | 'rejected' | 'invalidated';

interface EarningApproval {
  id: string;
  booking_id: string;
  booking_number: string | null;
  booking_type: 'hourly' | 'monthly_live_in' | null;
  booking_status: string | null;
  worker_user_id: string;
  worker_name: string | null;
  source_key: string;
  amount_cents: number;
  status: EarningStatus;
  reviewed_by_user_id: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

const FILTERS: { value: EarningStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'بانتظار القرار' },
  { value: 'approved', label: 'معتمدة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'invalidated', label: 'أُبطلت بالإلغاء' },
  { value: 'all', label: 'الكل' },
];

const STATUS_LABELS: Record<EarningStatus, string> = {
  pending: 'بانتظار القرار',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  invalidated: 'أُبطلت بالإلغاء',
};

function statusTone(status: EarningStatus): 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'pending') return 'warning';
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function sourceLabel(row: EarningApproval): string {
  if (row.source_key === 'hourly-completion') return 'اكتمال زيارة بالساعة';
  if (row.source_key.startsWith('monthly:')) {
    return `فترة شهرية حتى ${new Date(row.source_key.slice('monthly:'.length)).toLocaleDateString('ar-EG-u-nu-latn')}`;
  }
  return row.source_key.startsWith('legacy:') ? 'استحقاق سابق للمهاجرة' : row.source_key;
}

export default function DomesticWorkerEarningsPage() {
  const { isLoading, authedFetch } = useAuth();
  const [rows, setRows] = useState<EarningApproval[] | null>(null);
  const [filter, setFilter] = useState<EarningStatus | 'all'>('pending');
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const query = filter === 'all' ? '' : `?status=${filter}`;
    setRows(null);
    setError(null);
    authedFetch<EarningApproval[]>(`/admin/domestic-workers/earning-approvals${query}`)
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'تعذر تحميل استحقاقات الخدمات المنزلية'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, filter]);

  async function runDecision(id: string, action: 'approve' | 'reject', reason?: string) {
    if (activeActionId) return;
    setActiveActionId(id);
    setError(null);
    try {
      await authedFetch(`/admin/domestic-workers/earning-approvals/${id}/${action}`, {
        method: 'POST',
        body: action === 'reject' ? JSON.stringify({ reason }) : undefined,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذر حفظ القرار');
    } finally {
      setActiveActionId(null);
    }
  }

  return (
    <AppShell>
      <PageHeader title="اعتماد أرباح الخدمات المنزلية" />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            size="sm"
            variant={filter === item.value ? 'default' : 'outline'}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {error && <p className="mb-4 text-destructive">{error}</p>}
      {!rows && !error && <TableSkeleton columns={7} />}
      {rows?.length === 0 && <EmptyState title="لا توجد استحقاقات بهذه الحالة" />}

      {rows && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>مقدّم الخدمة</TableHead>
              <TableHead>الحجز والمصدر</TableHead>
              <TableHead>المبلغ</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>القرار</TableHead>
              <TableHead>تاريخ الإنشاء</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.worker_name ?? 'مقدّم خدمة'}
                  <span className="block font-mono text-xs text-muted-foreground" dir="ltr">{row.worker_user_id}</span>
                </TableCell>
                <TableCell>
                  <span className="font-medium" dir="ltr">{row.booking_number ?? row.booking_id}</span>
                  <span className="block text-xs text-muted-foreground">{sourceLabel(row)}</span>
                  <span className="block text-xs text-muted-foreground">حالة الحجز: {row.booking_status ?? 'غير متاحة'}</span>
                </TableCell>
                <TableCell className="font-semibold">{formatEgp(row.amount_cents)}</TableCell>
                <TableCell>
                  <StatusChip tone={statusTone(row.status)}>{STATUS_LABELS[row.status]}</StatusChip>
                  {row.rejection_reason && <p className="mt-1 max-w-64 text-xs text-muted-foreground">{row.rejection_reason}</p>}
                </TableCell>
                <TableCell>
                  {row.reviewed_at ? (
                    <>
                      <span>{row.reviewed_by_name ?? (row.status === 'invalidated' ? 'النظام' : row.reviewed_by_user_id)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(row.reviewed_at).toLocaleString('ar-EG-u-nu-latn')}
                      </span>
                    </>
                  ) : '—'}
                </TableCell>
                <TableCell>{new Date(row.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                <TableCell>
                  {row.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={activeActionId !== null}
                        onClick={() => runDecision(row.id, 'approve')}
                      >
                        {activeActionId === row.id ? 'جارٍ الحفظ…' : 'اعتماد'}
                      </Button>
                      <PromptDialog
                        trigger={
                          <Button size="sm" variant="destructive" disabled={activeActionId !== null}>
                            رفض
                          </Button>
                        }
                        title="رفض استحقاق الخدمة المنزلية"
                        label="سبب الرفض"
                        minLength={2}
                        confirmLabel="رفض الاستحقاق"
                        destructive
                        onConfirm={(reason) => runDecision(row.id, 'reject', reason)}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AppShell>
  );
}
