'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const egp = (c: number) => `${(c / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

interface ProjectRow {
  id: string; project_number: string; name_ar: string; project_type: string;
  status: string; customer_full_name?: string; total_cents: number;
  paid_cents: number; assigned_company_id: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft:'مسودة', survey_requested:'طلب معاينة', survey_scheduled:'معاينة مجدولة',
  quote_preparing:'تحضير عرض', awaiting_customer_approval:'انتظار موافقة العميل',
  awaiting_deposit:'انتظار العربون', active:'نشط', paused:'متوقف',
  awaiting_milestone_approval:'انتظار موافقة مرحلة', handover_pending:'استلام نهائي',
  completed:'مكتمل', cancelled:'ملغي', disputed:'نزاع',
};

export default function AdminProjectsPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    setError(null);
    authedFetchPaginated<ProjectRow>(`/admin/projects?page=${page}&per_page=20`)
      .then(({ items, meta }) => { setProjects(items); setTotal(meta.total ?? items.length); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'خطأ'));
  }, [isLoading, page, authedFetchPaginated]);

  return (
    <AppShell>
      <PageHeader title="المشروعات والتشطيب" />
      {!projects && <TableSkeleton columns={6} />}
      {projects && projects.length === 0 && <EmptyState title="مفيش مشروعات" />}
      {projects && projects.length > 0 && (
        <>
          <Table>
            <TableHeader><TableRow>
              <TableHead>رقم المشروع</TableHead><TableHead>الاسم</TableHead>
              <TableHead>النوع</TableHead><TableHead>الحالة</TableHead>
              <TableHead>العقد (ج.م)</TableHead><TableHead>مدفوع</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><span className="font-mono text-xs">{p.project_number}</span></TableCell>
                  <TableCell className="font-medium">{p.name_ar}</TableCell>
                  <TableCell><Badge variant="outline">{p.project_type}</Badge></TableCell>
                  <TableCell><Badge variant={p.status === 'active' ? 'secondary' : 'outline'}>{STATUS_LABELS[p.status] ?? p.status}</Badge></TableCell>
                  <TableCell>{egp(p.total_cents)}</TableCell>
                  <TableCell>{egp(p.paid_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / 20))} total={total} itemLabel="مشروع" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
