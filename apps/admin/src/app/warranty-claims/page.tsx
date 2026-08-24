'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { TableSkeleton } from '@/components/table-skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const egp = (c: number) => `${(c / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

interface ClaimRow {
  id: string; warranty_id: string; customer_id: string;
  status: string; defect_description: string;
  original_provider_id: string | null; repair_order_id: string | null;
  created_at: string;
}

const CLAIM_STATUS_LABELS: Record<string, string> = {
  open:'جديد', under_review:'تحت المراجعة', inspection_scheduled:'معاينة مجدولة',
  approved:'مقبول', rejected:'مرفوض', repair_in_progress:'إصلاح جاري',
  resolved:'تم الحل', closed:'مغلق',
};

export default function AdminWarrantyClaimsPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    authedFetchPaginated<ClaimRow>(`/admin/warranty-claims?${params.toString()}`)
      .then(({ items, meta }) => { setClaims(items); setTotal(meta.total ?? items.length); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [isLoading, page, statusFilter, authedFetchPaginated]);

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
        .then(({ items }) => setClaims(items));
    } catch (err) { setError(err instanceof ApiError ? err.message : 'خطأ'); }
  }

  return (
    <AppShell>
      <PageHeader title="مطالبات الضمان" />
      <div className="mb-4 flex gap-2 flex-wrap">
        {['all','open','under_review','approved','repair_in_progress','resolved'].map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`rounded px-3 py-1 text-sm ${statusFilter === s ? 'bg-primary text-white' : 'border'}`}>
            {CLAIM_STATUS_LABELS[s] ?? s}
          </button>
        ))}
      </div>
      {!claims && <TableSkeleton columns={5} />}
      {claims && claims.length === 0 && <EmptyState title="مفيش مطالبات" />}
      {claims && claims.length > 0 && (
        <Table>
          <TableHeader><TableRow>
            <TableHead>العميل</TableHead><TableHead>الوصف</TableHead>
            <TableHead>الحالة</TableHead><TableHead>التاريخ</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-sm">{c.customer_id.slice(0,8)}</TableCell>
                <TableCell className="max-w-xs truncate text-sm">{c.defect_description}</TableCell>
                <TableCell><Badge variant={c.status === 'open' ? 'destructive' : 'outline'}>{CLAIM_STATUS_LABELS[c.status] ?? c.status}</Badge></TableCell>
                <TableCell className="text-sm">{new Date(c.created_at).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
                <TableCell>
                  {(c.status === 'open' || c.status === 'under_review') && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => reviewClaim(c.id, 'approved')}>قبول</Button>
                      <Button size="sm" variant="outline" onClick={() => {
                        const reason = window.prompt('سبب الرفض:');
                        if (reason?.trim()) reviewClaim(c.id, 'rejected', reason.trim());
                      }}>رفض</Button>
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
