'use client';

import { Fragment, useEffect, useState } from 'react';
import type { AuditLogResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const PER_PAGE = 20;

function ValuesDiff({ oldValues, newValues }: { oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }) {
  if (!oldValues && !newValues) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1 text-xs" dir="ltr">
      {oldValues && <pre className="whitespace-pre-wrap text-destructive">- {JSON.stringify(oldValues)}</pre>}
      {newValues && <pre className="whitespace-pre-wrap text-emerald-700">+ {JSON.stringify(newValues)}</pre>}
    </div>
  );
}

export default function AuditLogPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [logs, setLogs] = useState<AuditLogResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (entityTypeFilter) params.set('entity_type', entityTypeFilter);
    if (actionFilter) params.set('action', actionFilter);
    authedFetchPaginated<AuditLogResponseDto>(`/admin/audit-logs?${params.toString()}`)
      .then(({ items, meta }) => {
        setLogs(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل سجل النشاط'));
  }, [isLoading, page, entityTypeFilter, actionFilter, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <h1 className="mb-6 text-xl font-semibold">سجل النشاط</h1>

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="نوع الكيان (مثال: employee)"
          value={entityTypeFilter}
          dir="ltr"
          className="max-w-xs"
          onChange={(e) => {
            setEntityTypeFilter(e.target.value);
            setPage(1);
          }}
        />
        <Input
          placeholder="الفعل (مثال: employee.block)"
          value={actionFilter}
          dir="ltr"
          className="max-w-xs"
          onChange={(e) => {
            setActionFilter(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !logs && <p className="text-muted-foreground">جاري التحميل…</p>}
      {logs && logs.length === 0 && <p className="text-muted-foreground">مفيش سجلات مطابقة</p>}

      {logs && logs.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفعل</TableHead>
                <TableHead>الكيان</TableHead>
                <TableHead>الفاعل</TableHead>
                <TableHead>الوقت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <TableCell dir="ltr">{log.action}</TableCell>
                    <TableCell dir="ltr">
                      {log.entity_type}#{log.entity_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>{log.actor_role ?? '—'}</TableCell>
                    <TableCell>{new Date(log.created_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                  </TableRow>
                  {expandedId === log.id && (
                    <TableRow>
                      <TableCell colSpan={4} className="bg-muted/30">
                        <ValuesDiff oldValues={log.old_values} newValues={log.new_values} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages} ({total} سجل إجمالاً)
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
