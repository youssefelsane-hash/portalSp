'use client';

import { Fragment, useEffect, useState } from 'react';
import { formatDateTimeAr } from '@/lib/format';
import type { AuditLogResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ErrorNotice } from '@/components/notice';
import { auditActionLabel, auditActorRoleLabel, auditEntityLabel } from '@/lib/audit-labels';

const PER_PAGE = 20;

/** قيمة أي حقل كنص قصير — الكائنات المركّبة بتفضل JSON لأنها استثناء مش القاعدة. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'مفعّل' : 'مقفول';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * **الفرق حقل-بحقل مش JSON خام.**
 *
 * كان بيطبع `JSON.stringify` للكائن كله في سطرين أحمر/أخضر — سطر واحد طويل فيه كل الحقول
 * وأقواس وعلامات تنصيص، والأدمن لازم يقارن نصين بعينه عشان يعرف **أي حقل** اتغيّر أصلاً
 * (بلاغ مالك 2026-09-17). دلوقتي كل حقل سطر، والحقل اللي اتغيّر فعلاً هو اللي بيتعلّم عليه.
 */
function ValuesDiff({ oldValues, newValues }: { oldValues: Record<string, unknown> | null; newValues: Record<string, unknown> | null }) {
  if (!oldValues && !newValues) return <span className="text-sm text-muted-foreground">مفيش تفاصيل متسجّلة للسجل ده.</span>;
  const keys = [...new Set([...Object.keys(oldValues ?? {}), ...Object.keys(newValues ?? {})])].sort();
  if (keys.length === 0) return <span className="text-sm text-muted-foreground">مفيش تفاصيل متسجّلة للسجل ده.</span>;
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-start font-medium">الحقل</th>
            <th className="px-3 py-1.5 text-start font-medium">قبل</th>
            <th className="px-3 py-1.5 text-start font-medium">بعد</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const before = oldValues?.[key];
            const after = newValues?.[key];
            const changed = JSON.stringify(before) !== JSON.stringify(after);
            return (
              <tr key={key} className={changed ? 'border-t bg-amber-50/60' : 'border-t'}>
                <td className="px-3 py-1.5 font-mono" dir="ltr">
                  {key}
                </td>
                <td className="px-3 py-1.5 break-all text-muted-foreground">{renderValue(before)}</td>
                <td className={`px-3 py-1.5 break-all ${changed ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {renderValue(after)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <PageHeader
        title="سجل النشاط"
        description="كل تغيير إداري على المنصة. دوس على أي سجل عشان تشوف الحقول اللي اتغيّرت فيه بالظبط."
      />

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

      {error && <ErrorNotice className="mb-0">{error}</ErrorNotice>}
      {!error && !logs && <TableSkeleton columns={4} />}
      {logs && logs.length === 0 && <EmptyState title="مفيش سجلات مطابقة" />}

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
                    {/* العربي فوق والمفتاح الخام تحته: الأدمن بيقرا الجملة، والمفتاح يفضل
                        المرجع الدقيق للفلترة والتشخيص. */}
                    <TableCell>
                      <div className="font-medium">{auditActionLabel(log.action)}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {log.action}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{auditEntityLabel(log.entity_type)}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        #{log.entity_id.slice(0, 8)}
                      </div>
                    </TableCell>
                    <TableCell>{auditActorRoleLabel(log.actor_role)}</TableCell>
                    <TableCell>{(formatDateTimeAr(log.created_at) ?? '—')}</TableCell>
                  </TableRow>
                  {expandedId === log.id && (
                    <TableRow>
                      <TableCell colSpan={4} className="bg-muted/30 whitespace-normal">
                        <ValuesDiff oldValues={log.old_values} newValues={log.new_values} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="سجل" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
