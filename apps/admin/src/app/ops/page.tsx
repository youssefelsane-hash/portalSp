'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/notice';
import { formatCount } from '@/lib/analytics-format';

/**
 * **لوحة المراقبة** (ADR-0114، طلب مالك 2026-09-25).
 *
 * الفجوة اللي بتقفلها: `GET /admin/ops/health-metrics` موجود ومبني صح من ج-٧، و**مفيش ولا سطر
 * في `apps/admin` بيناديه**. يعني كل الإشارات دي كانت لأداة مراقبة خارجية بس — والمالك اللي
 * بيفتح اللوحة مكانش يقدر يشوف حالة النظام ولا أخطاء الواجهة من غير SSH.
 *
 * نفس نمط فجوتين اتقفلوا قبلها بالحرف (تفعيل الموظف، مصروف الإعلانات): سيرفر كامل وواجهة غايبة.
 */

type Severity = 'ok' | 'warn' | 'critical';

interface OpsAlert {
  key: string;
  severity: Exclude<Severity, 'ok'>;
  message: string;
}

interface HealthMetrics {
  status: Severity;
  alerts: OpsAlert[];
  requests: { total: number; serverErrorRate: number; windowMinutes: number; p95Ms?: number };
  queues: { name: string; waiting: number; active: number; failed: number; oldestWaitingMinutes: number | null }[];
  business: Record<string, number | null>;
  clientErrors: { total: number; visitors: number };
  database: { pool: Record<string, number> };
  process: Record<string, number>;
  collectedAt: string;
}

interface ClientErrorGroup {
  fingerprint: string;
  app: string;
  kind: string;
  page_path: string;
  error_name: string | null;
  error_message: string | null;
  api_path: string | null;
  api_status: number | null;
  events: number;
  visitors: number;
  top_browser: string | null;
  top_device: string | null;
  first_seen: string;
  last_seen: string;
}

interface ClientErrorsResponse {
  from: string;
  to: string;
  last_hour: { total: number; visitors: number };
  groups: ClientErrorGroup[];
}

const KIND_LABELS: Record<string, string> = {
  render: 'رندر',
  api: 'استدعاء API',
  network: 'شبكة',
  unhandled_rejection: 'وعد مرفوض',
  not_found: 'صفحة مش موجودة',
};

const APP_LABELS: Record<string, string> = {
  'customer-web': 'موقع العملاء',
  admin: 'لوحة الأدمن',
};

const HOURS_OPTIONS = [
  { value: 1, label: 'آخر ساعة' },
  { value: 24, label: 'آخر ٢٤ ساعة' },
  { value: 72, label: 'آخر ٣ أيام' },
  { value: 168, label: 'آخر أسبوع' },
];

function statusLabel(status: Severity): { text: string; variant: 'default' | 'secondary' | 'destructive' } {
  if (status === 'critical') return { text: 'حرج', variant: 'destructive' };
  if (status === 'warn') return { text: 'تحذير', variant: 'secondary' };
  return { text: 'سليم', variant: 'default' };
}

export default function OpsPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [hours, setHours] = useState(24);
  const canView = hasPermission('operations.view');

  const health = useAdminQuery<HealthMetrics>(
    isLoading || !canView ? null : 'ops-health',
    () => authedFetch<HealthMetrics>('/admin/ops/health-metrics'),
    'حصل خطأ في تحميل حالة النظام',
  );

  const clientErrors = useAdminQuery<ClientErrorsResponse>(
    isLoading || !canView ? null : `ops-client-errors:${hours}`,
    () => authedFetch<ClientErrorsResponse>(`/admin/ops/client-errors?hours=${hours}`),
    'حصل خطأ في تحميل أخطاء الواجهة',
  );

  const groups = clientErrors.data?.groups ?? [];

  return (
    <AppShell>
      <PageHeader
        title="حالة النظام وأخطاء الواجهة"
        description="نفس الأرقام اللي المراقبة الخارجية بتقرا منها، وأخطاء متصفحات المستخدمين مجمّعة بعدد الناس المتأثرة."
      />

      <div className="flex flex-col gap-6">
        {!canView && (
          <EmptyState title="ماعندكش صلاحية" description="الصفحة دي محتاجة صلاحية عرض العمليات." />
        )}

        {canView && (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">الحالة العامة</CardTitle>
                {health.data && (
                  <Badge variant={statusLabel(health.data.status).variant} data-testid="ops-status">
                    {statusLabel(health.data.status).text}
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                {health.error && <ErrorNotice>{health.error}</ErrorNotice>}
                {health.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                {health.data && (
                  <>
                    {/* **الإنذارات الأول**: الأرقام الخام تحتها بترد على «قد إيه وفين»، بس السؤال
                        الأول دايمًا «فيه مشكلة دلوقتي؟». */}
                    {health.data.alerts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">مفيش أي إنذار قايم دلوقتي.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {health.data.alerts.map((alert) => (
                          <li
                            key={alert.key}
                            className="flex items-start gap-3 rounded-lg border p-3 text-sm"
                            data-testid={`ops-alert-${alert.key}`}
                          >
                            <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}>
                              {alert.severity === 'critical' ? 'حرج' : 'تحذير'}
                            </Badge>
                            <span>{alert.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <Metric
                        label="نسبة أعطال 5xx"
                        value={`${(health.data.requests.serverErrorRate * 100).toFixed(1)}%`}
                        hint={`${formatCount(health.data.requests.total)} طلب / ${health.data.requests.windowMinutes} دقيقة`}
                      />
                      <Metric
                        label="أخطاء الواجهة (آخر ساعة)"
                        value={formatCount(health.data.clientErrors?.total ?? 0)}
                        hint={`${formatCount(health.data.clientErrors?.visitors ?? 0)} زائر متأثر`}
                      />
                      <Metric
                        label="وظايف فاشلة في الطوابير"
                        value={formatCount(health.data.queues.reduce((sum, q) => sum + Math.max(q.failed, 0), 0))}
                        hint={`${health.data.queues.length} طابور`}
                      />
                      <Metric
                        label="طلبات بتدوّر على فني"
                        value={formatCount(Number(health.data.business?.stuck_searching ?? 0))}
                        hint="أكتر من الحد الزمني المسموح"
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="text-base">أخطاء واجهة المستخدم</CardTitle>
                <div className="flex items-center gap-2">
                  <Label htmlFor="ops-hours" className="text-xs text-muted-foreground">
                    المدة
                  </Label>
                  <SelectNative
                    id="ops-hours"
                    data-testid="ops-hours"
                    value={String(hours)}
                    onChange={(e) => setHours(Number(e.target.value))}
                    className="w-40"
                  >
                    {HOURS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
              </CardHeader>
              <CardContent>
                {clientErrors.error && <ErrorNotice>{clientErrors.error}</ErrorNotice>}
                {clientErrors.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
                {!clientErrors.loading && !clientErrors.error && groups.length === 0 && (
                  <EmptyState
                    title="مفيش أخطاء في المدة دي"
                    description="مافيش متصفح بلّغ عن أي عطل — وده المفروض يكون الوضع الطبيعي."
                  />
                )}
                {groups.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصفحة</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>الخطأ</TableHead>
                        <TableHead>الاستدعاء الفاشل</TableHead>
                        {/* **المستخدمين قبل الأحداث**: مية خطأ من زائر واحد صفحة مكسورة لواحد،
                            ومية من مية عطل عام. الترتيب هنا بيعكس الأولوية دي. */}
                        <TableHead>مستخدمين</TableHead>
                        <TableHead>مرات</TableHead>
                        {/* العمودين دول بيتخفوا تحت 1536px (`2xl`) مش 1280: القايمة الجانبية
                            بتاخد ~٤٠٠px، فالجدول عايش في ٨٧٦px على شاشة ١٢٨٠ — وفاحص العرض في
                            `admin-visual.js` مسك إنه بيطلع 1194px جوّاها. عتبة `xl` كانت بتتفعّل
                            **عند** ١٢٨٠ بالظبط فماكانتش بتخفي حاجة هناك أصلاً. */}
                        <TableHead className="hidden 2xl:table-cell">الجهاز</TableHead>
                        <TableHead className="hidden 2xl:table-cell">آخر مرة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((group) => (
                        <TableRow key={group.fingerprint} data-testid={`client-error-${group.fingerprint}`}>
                          <TableCell className="font-medium" dir="ltr">
                            {group.page_path}
                            <span className="block text-xs text-muted-foreground" dir="rtl">
                              {APP_LABELS[group.app] ?? group.app}
                            </span>
                          </TableCell>
                          <TableCell>{KIND_LABELS[group.kind] ?? group.kind}</TableCell>
                          <TableCell>
                            <span dir="ltr">{group.error_name ?? '—'}</span>
                            {group.error_message && (
                              <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">
                                {group.error_message}
                              </span>
                            )}
                          </TableCell>
                          <TableCell dir="ltr">
                            {group.api_path ? `${group.api_path}${group.api_status ? ` · ${group.api_status}` : ''}` : '—'}
                          </TableCell>
                          <TableCell className="font-semibold">{formatCount(group.visitors)}</TableCell>
                          <TableCell>{formatCount(group.events)}</TableCell>
                          <TableCell className="hidden 2xl:table-cell">
                            {group.top_browser ?? '—'}
                            {group.top_device ? ` · ${group.top_device}` : ''}
                          </TableCell>
                          <TableCell className="hidden 2xl:table-cell" dir="ltr">
                            {new Date(group.last_seen).toLocaleString('ar-EG')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
