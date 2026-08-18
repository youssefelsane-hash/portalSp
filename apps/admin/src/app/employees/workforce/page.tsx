'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { WorkforceSummaryRowDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Users } from 'lucide-react';

// لوحة القوى العاملة (Script 5 Part 2 §5/9) — ملخص حي ليوم النهارده لكل موظف: حضور
// (ACTIVE/IDLE/OFFLINE)، وقت عمل فعلي (مش مدة تسجيل الدخول)، عدد الأفعال، الأفعال الحساسة
// المرفوضة، والتنبيهات الأمنية المفتوحة. مصدرها GET /admin/workforce/summary — استعلام واحد
// bounded بموظفي الأدمن بس (workforce-activity.service.ts§getWorkforceSummary)، مش سكان تاريخي.
const PRESENCE_LABELS: Record<string, string> = { active: 'نشط الآن', idle: 'خامل', offline: 'غير متصل' };
const PRESENCE_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  idle: 'secondary',
  offline: 'outline',
};

function formatActiveTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return '—';
  if (hours === 0) return `${minutes} دقيقة`;
  return `${hours}س ${minutes}د`;
}

export default function WorkforceDashboardPage() {
  const { isLoading, authedFetch } = useAuth();
  const [rows, setRows] = useState<WorkforceSummaryRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<WorkforceSummaryRowDto[]>('/admin/workforce/summary')
      .then(setRows)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل ملخص القوى العاملة'));
  }, [isLoading, authedFetch]);

  const activeCount = rows?.filter((r) => r.state === 'active').length ?? 0;
  const idleCount = rows?.filter((r) => r.state === 'idle').length ?? 0;
  const offlineCount = rows?.filter((r) => r.state === 'offline').length ?? 0;

  return (
    <AppShell>
      <PageHeader title="لوحة القوى العاملة" description="حضور لحظي ونشاط اليوم لكل الموظفين — Script 5." />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold">{activeCount}</div>
            <div className="text-sm text-muted-foreground">نشط الآن</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold">{idleCount}</div>
            <div className="text-sm text-muted-foreground">خامل</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold">{offlineCount}</div>
            <div className="text-sm text-muted-foreground">غير متصل</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          {rows === null ? (
            <TableSkeleton rows={6} columns={7} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Users} title="مفيش موظفين" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الموظف</TableHead>
                  <TableHead>القسم</TableHead>
                  <TableHead>الحضور</TableHead>
                  <TableHead>وقت العمل الفعلي (النهارده)</TableHead>
                  <TableHead>عدد الأفعال</TableHead>
                  <TableHead>أفعال حساسة اترفضت</TableHead>
                  <TableHead>تنبيهات مفتوحة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <Link href={`/employees/${row.user_id}`} className="hover:underline">
                        {row.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{row.department ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={PRESENCE_BADGE_VARIANT[row.state]}>{PRESENCE_LABELS[row.state]}</Badge>
                    </TableCell>
                    <TableCell>{formatActiveTime(row.active_seconds_today)}</TableCell>
                    <TableCell>{row.actions_today}</TableCell>
                    <TableCell>
                      {row.denied_sensitive_today > 0 ? (
                        <Badge variant="destructive">{row.denied_sensitive_today}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {row.open_alerts > 0 ? (
                        <Link href={`/security-center?actor_user_id=${row.user_id}`}>
                          <Badge variant="destructive">{row.open_alerts}</Badge>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
