'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const egp = (c: number) => `${(c / 100).toLocaleString('ar-EG-u-nu-latn')} ج.م`;

interface ProjectRow {
  id: string; project_number: string; name_ar: string; project_type: string;
  status: string; customer_full_name?: string;
  approved_quote_total_cents: number | null; paid_cents: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft:'مسودة', survey_requested:'طلب معاينة', survey_scheduled:'معاينة مجدولة',
  quote_preparing:'تحضير عرض', awaiting_customer_approval:'انتظار موافقة العميل',
  awaiting_deposit:'انتظار العربون', active:'نشط', paused:'متوقف',
  awaiting_milestone_approval:'انتظار موافقة مرحلة', handover_pending:'استلام نهائي',
  completed:'مكتمل', cancelled:'ملغي', disputed:'نزاع',
};

// انتقالات مسموحة لكل حالة
const TRANSITIONS: Record<string, {to: string; label: string}[]> = {
  survey_requested: [{to:'survey_scheduled',label:'جدولة المعاينة'},{to:'cancelled',label:'إلغاء'}],
  survey_scheduled: [{to:'quote_preparing',label:'تحضير عرض'},{to:'cancelled',label:'إلغاء'}],
  quote_preparing: [{to:'awaiting_customer_approval',label:'إرسال للعميل'},{to:'cancelled',label:'إلغاء'}],
  awaiting_customer_approval: [{to:'awaiting_deposit',label:'قبول العرض'}],
  awaiting_deposit: [{to:'active',label:'بدء التنفيذ'},{to:'cancelled',label:'إلغاء'}],
  active: [
    {to:'paused',label:'إيقاف مؤقت'},
    {to:'awaiting_milestone_approval',label:'مرحلة مستنية موافقة'},
    {to:'handover_pending',label:'جاهز للتسليم'},
    {to:'disputed',label:'نزاع'},
    {to:'cancelled',label:'إلغاء'},
  ],
  paused: [{to:'active',label:'استئناف'},{to:'cancelled',label:'إلغاء'}],
  handover_pending: [{to:'completed',label:'تسليم نهائي'},{to:'disputed',label:'نزاع'}],
  disputed: [{to:'active',label:'حل النزاع'},{to:'cancelled',label:'إلغاء'}],
};

export default function AdminProjectsPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم المشروع</TableHead><TableHead>الاسم</TableHead>
            <TableHead>النوع</TableHead><TableHead>الحالة</TableHead>
            <TableHead>العقد (ج.م)</TableHead><TableHead>مدفوع</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {projects.map((p) => (
              <ProjectRowExpandable key={p.id} project={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
                onRefresh={() => window.location.reload()} />
            ))}
          </TableBody>
        </Table>
      )}
      {/* Pagination */}
    </AppShell>
  );
}

function ProjectRowExpandable({ project, expanded, onToggle, onRefresh }: {
  project: ProjectRow; expanded: boolean; onToggle: () => void; onRefresh: () => void;
}) {
  const transitions = TRANSITIONS[project.status] ?? [];
  return (
    <>
      <TableRow className={expanded ? 'bg-muted/50' : ''}>
        <TableCell>
          <button onClick={onToggle} className="font-mono text-xs underline">{project.project_number}</button>
        </TableCell>
        <TableCell className="font-medium">{project.name_ar}</TableCell>
        <TableCell><Badge variant="outline">{project.project_type}</Badge></TableCell>
        <TableCell><Badge variant={project.status === 'active' ? 'secondary' : 'outline'}>{STATUS_LABELS[project.status] ?? project.status}</Badge></TableCell>
        <TableCell>{project.approved_quote_total_cents != null ? egp(project.approved_quote_total_cents) : '—'}</TableCell>
        <TableCell>{egp(project.paid_cents)}</TableCell>
        <TableCell>
          <Button size="sm" variant={expanded ? 'secondary' : 'ghost'} onClick={onToggle}>
            {expanded ? 'إخفاء' : 'إدارة'}
          </Button>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-4">
            <p className="mb-2 font-medium text-sm">الانتقالات المتاحة:</p>
            <div className="flex flex-wrap gap-2">
              {transitions.length > 0 ? transitions.map((t) => (
                <TransitionButton key={t.to + t.label} projectId={project.id} to={t.to} label={t.label} onDone={onRefresh} />
              )) : <span className="text-sm text-muted-foreground">مفيش انتقالات متاحة</span>}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TransitionButton({ projectId, to, label, onDone }: { projectId: string; to: string; label: string; onDone: () => void }) {
  const { authedFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    let reason: string | null = null;
    if (to === 'cancelled' || to === 'disputed' || to === 'paused') {
      reason = window.prompt(`سبب ${label} (إجباري):`);
      if (!reason?.trim()) return;
    }
    setBusy(true); setError(null);
    try {
      await authedFetch(`/admin/projects/${projectId}/transition`, {
        method: 'POST', body: JSON.stringify({ to, reason }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ');
    } finally { setBusy(false); }
  }
  return (
    <>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void go()}>
        {busy ? '…' : label}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </>
  );
}

function Pagination({ page, totalPages, total, itemLabel, onPageChange }: {
  page: number; totalPages: number; total: number; itemLabel: string; onPageChange: (n: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 mt-4">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>السابق</Button>
      <span className="text-sm">صفحة {page} من {totalPages}</span>
      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>التالي</Button>
    </div>
  );
}
