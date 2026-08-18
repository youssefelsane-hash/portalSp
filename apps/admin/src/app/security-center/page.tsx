'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { SecurityEventDto, SecurityEventSeverity, SecurityEventStatus, SecurityOverviewResponse } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { TableSkeleton } from '@/components/table-skeleton';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ShieldAlert } from 'lucide-react';

// مركز الأمان (Script 5 Part 11) — نظرة عامة + قايمة أحداث قابلة للفلترة. صفحة جديدة منفصلة عمداً
// عن /security الموجودة (دي "مفاتيح المرور/جلساتي" self-service بس، مش أحداث أمنية على مستوى
// المنصة كلها) — راجع apps/api/src/modules/security/README.md.
const SEVERITY_LABELS: Record<SecurityEventSeverity, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  high: 'خطورة عالية',
  critical: 'حرج',
};

const SEVERITY_BADGE_VARIANT: Record<SecurityEventSeverity, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  info: 'outline',
  warning: 'secondary',
  high: 'default',
  critical: 'destructive',
};

const STATUS_LABELS: Record<SecurityEventStatus, string> = {
  open: 'مفتوح',
  acknowledged: 'مُقرّ بيه',
  investigating: 'تحت المراجعة',
  resolved: 'اتحل',
  false_positive: 'إنذار كاذب',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  privilege_escalation_attempt: 'محاولة تصعيد صلاحيات',
  unauthorized_role_change: 'تغيير دور غير مصرّح بيه',
  unauthorized_permission_grant: 'منح صلاحية غير مصرّح بيه',
  repeated_permission_denial: 'رفض متكرر لفعل حساس',
  mfa_failure_burst: 'محاولات MFA فاشلة متكررة',
  sensitive_action_denied: 'فعل حساس اترفض',
  session_reuse_after_revoke: 'محاولة استخدام جلسة ملغاة',
  blocked_account_access_attempt: 'محاولة وصول من حساب محظور',
  security_setting_change: 'تغيير إعداد أمني',
};

// useSearchParams() محتاج Suspense boundary وقت الـ static prerendering — بدونها next build
// بيفشل على /security-center (نفس السبب في /login).
export default function SecurityCenterPage() {
  return (
    <Suspense>
      <SecurityCenterView />
    </Suspense>
  );
}

function SecurityCenterView() {
  const { isLoading, authedFetch } = useAuth();
  const searchParams = useSearchParams();
  const actorUserId = searchParams.get('actor_user_id');

  const [overview, setOverview] = useState<SecurityOverviewResponse | null>(null);
  const [events, setEvents] = useState<SecurityEventDto[] | null>(null);
  const [severityFilter, setSeverityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(actorUserId ? '' : 'open');
  const [error, setError] = useState<string | null>(null);

  function load() {
    authedFetch<SecurityOverviewResponse>('/admin/security/overview')
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل النظرة العامة'));

    const params = new URLSearchParams();
    if (severityFilter) params.set('severity', severityFilter);
    if (statusFilter) params.set('status', statusFilter);
    if (actorUserId) params.set('actor_user_id', actorUserId);
    authedFetch<{ items: SecurityEventDto[] }>(`/admin/security/events?${params.toString()}`)
      .then((res) => setEvents(res.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الأحداث'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, severityFilter, statusFilter, actorUserId]);

  const openCounts = new Map((overview?.open_by_severity ?? []).map((r) => [r.severity, r.count]));

  return (
    <AppShell>
      <PageHeader title="مركز الأمان" description="أحداث أمنية، محاولات تصعيد صلاحيات، وأفعال حساسة مرفوضة عبر المنصة كلها." />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(['critical', 'high', 'warning', 'info'] as SecurityEventSeverity[]).map((sev) => (
          <Card key={sev}>
            <CardContent className="pt-6">
              <div className="text-2xl font-semibold">{openCounts.get(sev) ?? 0}</div>
              <div className="text-sm text-muted-foreground">{SEVERITY_LABELS[sev]} — مفتوح</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">الأحداث</CardTitle>
          <div className="flex gap-2">
            <SelectNative value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="w-40">
              <option value="">كل الخطورات</option>
              {(['critical', 'high', 'warning', 'info'] as SecurityEventSeverity[]).map((sev) => (
                <option key={sev} value={sev}>
                  {SEVERITY_LABELS[sev]}
                </option>
              ))}
            </SelectNative>
            <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-40">
              <option value="">كل الحالات</option>
              {(['open', 'acknowledged', 'investigating', 'resolved', 'false_positive'] as SecurityEventStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABELS[st]}
                </option>
              ))}
            </SelectNative>
          </div>
        </CardHeader>
        <CardContent>
          {events === null ? (
            <TableSkeleton rows={5} columns={5} />
          ) : events.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="مفيش أحداث" description="مفيش أحداث أمنية بالفلتر ده حاليًا." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الخطورة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التكرار</TableHead>
                  <TableHead>آخر مرة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/security-center/${event.id}`} className="hover:underline">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={SEVERITY_BADGE_VARIANT[event.severity]}>{SEVERITY_LABELS[event.severity]}</Badge>
                    </TableCell>
                    <TableCell>{STATUS_LABELS[event.status]}</TableCell>
                    <TableCell>{event.occurrenceCount > 1 ? `×${event.occurrenceCount}` : '—'}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(event.lastOccurredAt).toLocaleString('ar-EG-u-nu-latn')}
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
