'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ErrorNotice } from '@/components/notice';
import { formatEgp } from '@/lib/format';
import { formatCount } from '@/lib/analytics-format';

/**
 * **طابور مديونية الفنيين** (ADR-0041).
 *
 * `GET /admin/technicians/debt/outstanding` اتعمل عشان يبقى «شاشة متابعة واحدة بدل ما الأدمن
 * يدوّر فني فني» — بالنص في تعليق الكونترولر. وفعلاً كان مفيش الشاشة دي: البانل الفردي
 * (`TechnicianDebtPanel`) موجود وممتاز، بس موظف المالية مكانش عنده أي طريقة يعرف **مين**
 * عليه فلوس أصلاً غير إنه يفتح الفنيين واحد واحد.
 *
 * التسجيل نفسه (السداد) بيفضل في الشاشة الفردية: عملية بتحرّك فلوس حقيقية ومحتاجة MFA
 * (`wallets.adjust`)، ومكانها الصح جنب سجل سدادات الفني مش في قايمة.
 */

type DebtStatus = 'none' | 'ok' | 'watch' | 'alert';

interface DebtListItem {
  technicianId: string;
  fullName: string | null;
  phoneNumber: string | null;
  status: DebtStatus;
  debtCents: number;
  ageDays: number | null;
  exceedsAmount: boolean;
  exceedsAge: boolean;
  balanceCents: number;
  debtSinceAt: string | null;
}

const STATUS: Record<DebtStatus, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  none: { label: 'مفيش مديونية', variant: 'secondary' },
  ok: { label: 'عادية', variant: 'outline' },
  watch: { label: 'للمتابعة', variant: 'outline' },
  alert: { label: 'محتاجة تدخّل', variant: 'destructive' },
};

export default function TechnicianDebtQueuePage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const canView = hasPermission('wallets.view');

  const debts = useAdminQuery<{ items: DebtListItem[] }>(
    isLoading || !canView ? null : 'technician-debt-outstanding',
    () => authedFetch<{ items: DebtListItem[] }>('/admin/technicians/debt/outstanding'),
    'حصل خطأ في تحميل قايمة المديونية',
  );

  const items = debts.data?.items ?? [];

  // الإجمالي والعدد الحرج قبل الجدول: القرار التشغيلي («نوقف تحصيل كاش؟») بيتاخد على الرقمين
  // دول مش على صف بعينه.
  const summary = useMemo(() => {
    const rows = debts.data?.items ?? [];
    return {
      total: rows.reduce((sum, row) => sum + Math.abs(row.debtCents), 0),
      alerts: rows.filter((row) => row.status === 'alert').length,
    };
  }, [debts.data]);

  return (
    <AppShell>
      <PageHeader
        title="مديونية الفنيين"
        description="كل فني رصيده سالب في مكان واحد، مرتّب بالأكبر. تسجيل السداد بيتم من صفحة الفني نفسه."
      />

      <div className="flex flex-col gap-6">
        {!canView && (
          <EmptyState title="ماعندكش صلاحية" description="الصفحة دي محتاجة صلاحية عرض المحافظ." />
        )}

        {canView && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">الفنيين المديونين</CardTitle>
            </CardHeader>
            <CardContent>
              {debts.error && <ErrorNotice>{debts.error}</ErrorNotice>}
              {debts.loading && <p className="text-sm text-muted-foreground">جاري التحميل…</p>}
              {!debts.loading && !debts.error && items.length === 0 && (
                <EmptyState
                  title="مفيش أي مديونية"
                  description="مفيش فني رصيده سالب دلوقتي — مفيش حاجة محتاجة تحصيل."
                />
              )}
              {items.length > 0 && (
                <>
                  <div className="mb-4 grid gap-4 sm:grid-cols-3">
                    <Metric label="إجمالي المديونية" value={formatEgp(summary.total)} />
                    <Metric label="عدد الفنيين" value={formatCount(items.length)} />
                    <Metric label="محتاجة تدخّل" value={formatCount(summary.alerts)} />
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الفني</TableHead>
                        <TableHead>المديونية</TableHead>
                        <TableHead>عمرها</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((row) => (
                        <TableRow key={row.technicianId} data-testid={`debt-row-${row.technicianId}`}>
                          <TableCell className="font-medium">
                            {row.fullName ?? '—'}
                            {row.phoneNumber && (
                              <span className="block text-xs text-muted-foreground" dir="ltr">
                                {row.phoneNumber}
                              </span>
                            )}
                          </TableCell>
                          {/* **قيمة مطلقة**: الرصيد سالب في القاعدة، وعرضه بالسالب هنا بيخلّي
                              «عليه ٥٠٠-» تتقري غلط في عمود اسمه «المديونية». */}
                          <TableCell className="font-semibold">{formatEgp(Math.abs(row.debtCents))}</TableCell>
                          <TableCell>{row.ageDays === null ? '—' : `${formatCount(row.ageDays)} يوم`}</TableCell>
                          <TableCell>
                            <Badge variant={STATUS[row.status].variant}>{STATUS[row.status].label}</Badge>
                          </TableCell>
                          <TableCell className="text-end">
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/technicians/${row.technicianId}`}>افتح الملف</Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
