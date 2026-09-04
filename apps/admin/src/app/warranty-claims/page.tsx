'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { TableSkeleton } from '@/components/table-skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ClaimRow {
  id: string; warranty_id: string; customer_id: string | null;
  order_id: string | null; project_id: string | null;
  customer_name: string | null; customer_phone: string | null;
  warranty_name: string | null; order_number: string | null; project_number: string | null;
  status: string; defect_description: string;
  original_provider_id: string | null; repair_order_id: string | null;
  created_at: string;
}

function customerReference(customerId: string | null): string {
  return customerId?.slice(0, 8) || 'غير متاح';
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  open:'جديد', under_review:'تحت المراجعة', inspection_scheduled:'معاينة مجدولة',
  approved:'مقبول', rejected:'مرفوض', repair_in_progress:'إصلاح جاري',
  resolved:'تم الحل', closed:'مغلق',
};

const CLAIM_ACTIONS: Record<string, { status: string; label: string; needsReason?: boolean }[]> = {
  open: [
    { status: 'under_review', label: 'بدء المراجعة' },
    { status: 'rejected', label: 'رفض', needsReason: true },
  ],
  under_review: [
    { status: 'inspection_scheduled', label: 'جدولة معاينة' },
    { status: 'approved', label: 'قبول' },
    { status: 'rejected', label: 'رفض', needsReason: true },
  ],
  inspection_scheduled: [
    { status: 'approved', label: 'قبول' },
    { status: 'rejected', label: 'رفض', needsReason: true },
  ],
  approved: [
    { status: 'repair_in_progress', label: 'بدء الإصلاح' },
    { status: 'resolved', label: 'تم الحل' },
  ],
  repair_in_progress: [{ status: 'resolved', label: 'تم الحل' }],
  resolved: [{ status: 'closed', label: 'إغلاق' }],
  rejected: [{ status: 'closed', label: 'إغلاق' }],
};

export default function AdminWarrantyClaimsPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), per_page: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    authedFetchPaginated<ClaimRow>(`/admin/warranty-claims?${params.toString()}`)
      .then(({ items, meta }) => {
        setClaims(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [page, statusFilter, authedFetchPaginated]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['warranty'], load);

  async function reviewClaim(claimId: string, status: string, rejectionReason?: string) {
    try {
      await authedFetch(`/admin/warranty-claims/${claimId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status, rejection_reason: rejectionReason }),
      });
      // Refresh
      const params = new URLSearchParams({ page: String(page), per_page: '20' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      authedFetchPaginated<ClaimRow>(`/admin/warranty-claims?${params.toString()}`)
        .then(({ items, meta }) => { setClaims(items); setTotal(meta.total ?? items.length); })
        // فشل التحميل كان بيضيع كـunhandled rejection: القسم يفضل فاضي
        // والمستخدم مش عارف ليه (docs/08 §133).
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'تعذّر تحميل البيانات'));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
  }

  return (
    <AppShell>
      <PageHeader title="مطالبات الضمان" />
      {error && <p className="mb-4 text-destructive">{error}</p>}
      <div className="mb-4 flex gap-2 flex-wrap">
        {['all','open','under_review','inspection_scheduled','approved','rejected','repair_in_progress','resolved','closed'].map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded px-3 py-1 text-sm ${statusFilter === s ? 'bg-primary text-white' : 'border'}`}>
            {CLAIM_STATUS_LABELS[s] ?? s}
          </button>
        ))}
      </div>
      {!claims && <TableSkeleton columns={6} />}
      {claims && claims.length === 0 && <EmptyState title="مفيش مطالبات" />}
      {claims && claims.length > 0 && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>العميل</TableHead><TableHead>الوصف</TableHead>
            <TableHead>الضمان والطلب</TableHead><TableHead>الحالة</TableHead>
            <TableHead>التاريخ</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-sm">
                  <div className="font-medium">{c.customer_name || customerReference(c.customer_id)}</div>
                  {c.customer_phone && <div className="text-muted-foreground" dir="ltr">{c.customer_phone}</div>}
                </TableCell>
                <TableCell className="max-w-md whitespace-pre-wrap break-words text-sm">{c.defect_description}</TableCell>
                <TableCell className="text-sm">
                  <div>{c.warranty_name || 'ضمان غير متاح'}</div>
                  {c.order_id && (
                    <Link href={`/orders/${c.order_id}`} className="text-primary hover:underline">
                      {c.order_number || 'فتح الطلب'}
                    </Link>
                  )}
                  {c.project_number && <div className="text-muted-foreground">{c.project_number}</div>}
                </TableCell>
                <TableCell><Badge variant={c.status === 'open' ? 'destructive' : 'outline'}>{CLAIM_STATUS_LABELS[c.status] ?? c.status}</Badge></TableCell>
                <TableCell className="text-sm">{new Date(c.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(CLAIM_ACTIONS[c.status] ?? []).map((action) => (
                      <Button key={action.status} size="sm" variant="outline" onClick={() => {
                        if (!action.needsReason) {
                          void reviewClaim(c.id, action.status);
                          return;
                        }
                        const reason = window.prompt('سبب الرفض:');
                        if (reason?.trim()) void reviewClaim(c.id, action.status, reason.trim());
                      }}>{action.label}</Button>
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {claims && total > 0 && (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / 20))}
          total={total}
          itemLabel="مطالبة"
          onPageChange={setPage}
        />
      )}
    </AppShell>
  );
}
