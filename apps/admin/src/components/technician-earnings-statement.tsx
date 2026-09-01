'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

// docs/08 §63.أ1 — كشف مستحقات الفني كان **موجود وشغال في الباك-إند** من §61
// (`GET /admin/technicians/:id/earnings/statement` و`/earnings/months`) بس مفيش أي شاشة أدمن
// بتستهلكه، فالمالك مكانش بيشوفه خالص. الكومبوننت ده بيقفل الفجوة دي، وبيستخدم **نفس** الخدمة
// اللي تطبيق الفني بيستخدمها (TechnicianEarningsService) — فأرقام الأدمن والفني مستحيل تختلف.

interface StatementJob {
  orderId: string;
  orderNumber: string;
  serviceNameAr: string | null;
  closedAt: string;
  originalPriceCents: number;
  additionalWorkCents: number;
  levelPremiumCents: number;
  customerDiscountCents: number;
  customerPaidCents: number;
  commissionableBaseCents: number;
  commissionRatePercentage: number;
  platformCommissionCents: number;
  discountBorneByTechnicianCents: number;
  grossTechnicianEarningCents: number;
  cashCollectedCents: number;
  netTechnicianDueCents: number;
}

interface MonthlyStatement {
  month: string;
  monthStart: string;
  monthEnd: string;
  isCurrentMonth: boolean;
  jobsCount: number;
  totals: {
    originalPriceCents: number;
    additionalWorkCents: number;
    levelPremiumCents: number;
    customerDiscountCents: number;
    customerPaidCents: number;
    platformCommissionCents: number;
    discountBorneByTechnicianCents: number;
    grossTechnicianEarningCents: number;
    cashCollectedCents: number;
    netTechnicianDueCents: number;
  };
  jobs: StatementJob[];
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
}

/** مطابقة رصيد المحفظة مع كشف الشهر (docs/08 §95) — مطابقة لـTechnicianBalanceReconciliation في الباك-إند. */
interface BalanceReconciliation {
  month: string;
  monthNetCents: number;
  monthLedgerCents: number;
  currentBalanceCents: number;
  outsideMonthCents: number;
  outsideMonthBreakdown: { transactionType: string; labelAr: string; amountCents: number }[];
  monthMatchesLedger: boolean;
}

export function TechnicianEarningsStatement({ technicianId }: { technicianId: string }) {
  const { isLoading, authedFetch } = useAuth();
  const [months, setMonths] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [statement, setStatement] = useState<MonthlyStatement | null>(null);
  const [reconciliation, setReconciliation] = useState<BalanceReconciliation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (month?: string) => {
      const qs = month ? `?month=${encodeURIComponent(month)}` : '';
      authedFetch<MonthlyStatement>(`/admin/technicians/${technicianId}/earnings/statement${qs}`)
        .then((s) => {
          setStatement(s);
          setSelected(s.month);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل كشف المستحقات'));
      // المطابقة مستقلة عن الكشف عمدًا: فشلها ما يمنعش عرض الكشف نفسه (نفس فلسفة باقي الأقسام).
      authedFetch<BalanceReconciliation>(`/admin/technicians/${technicianId}/earnings/reconciliation${qs}`)
        .then(setReconciliation)
        .catch(() => setReconciliation(null));
    },
    [authedFetch, technicianId],
  );

  useEffect(() => {
    if (isLoading) return;
    authedFetch<{ months: string[] }>(`/admin/technicians/${technicianId}/earnings/months`)
      .then((r) => setMonths(r.months))
      .catch(() => setMonths([]));
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, technicianId]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">
          مستحقات الفني
          {statement?.isCurrentMonth && (
            <Badge variant="secondary" className="ms-2">الشهر الحالي — حتى هذه اللحظة</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {error && <p className="text-destructive">{error}</p>}

        {months && months.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {months.map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={selected === m ? 'default' : 'outline'}
                onClick={() => load(m)}
              >
                {monthLabel(m)}
              </Button>
            ))}
          </div>
        )}

        {!statement && !error && <p className="text-muted-foreground">جاري التحميل…</p>}

        {statement && (
          <>
            {/* الإجماليات — الرقم اللي المالك بيدوّر عليه بيفضل أوضح حاجة في القسم. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="سعر الشغل الأصلي" value={statement.totals.originalPriceCents} />
              <Metric label="إضافات أثناء التنفيذ" value={statement.totals.additionalWorkCents} />
              <Metric label="فرق المستوى" value={statement.totals.levelPremiumCents} />
              <Metric label="عمولة المنصة" value={-statement.totals.platformCommissionCents} tone="muted" />
            </div>

            <div className="rounded-lg border bg-muted/40 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {statement.totals.netTechnicianDueCents < 0
                    ? 'مديونية الفني للمنصة من شغل الشهر'
                    : statement.isCurrentMonth
                      ? 'صافي حركة محفظة الفني من شغل الشهر حتى هذه اللحظة'
                      : 'صافي حركة محفظة الفني عن الشهر'}
                </span>
                <span className={`text-2xl font-bold tabular-nums ${statement.totals.netTechnicianDueCents < 0 ? 'text-destructive' : ''}`}>
                  {formatEgp(Math.abs(statement.totals.netTechnicianDueCents))}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {statement.jobsCount} شغلانة مقفولة · خصومات العملاء{' '}
                {formatEgp(statement.totals.customerDiscountCents)} —{' '}
                <span className="font-medium text-foreground">
                  خصم محمّل على الفني: {formatEgp(statement.totals.discountBorneByTechnicianCents)}
                </span>{' '}
                (المنصة بتتحمّل الخصومات بالكامل — ADR-0038).
                {' '}نصيب الفني {formatEgp(statement.totals.grossTechnicianEarningCents)} · كاش استلمه{' '}
                {formatEgp(statement.totals.cashCollectedCents)}.
              </p>
            </div>

            {/* مطابقة الرصيد (docs/08 §95، سؤال مالك مباشر): الرقم فوق بيخص **شغل الشهر ده بس**،
                بينما "المديونية الحالية" في كارت المديونية بتخص **كل الزمن**. اختلافهم طبيعي، بس
                كان بيبان كأنه خطأ حسابي. الجدول ده بيفكّك الفرق لمصادره من دفتر الحسابات نفسه. */}
            {reconciliation && (
              <div className="rounded-lg border p-4 text-sm">
                <p className="font-medium">مطابقة مع رصيد المحفظة الحالي</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  الرقم اللي فوق بيخص شغل الشهر ده بس. رصيد المحفظة بيجمع كل الزمن — فأي فرق بينهم
                  طبيعي، وده تفصيله بالكامل:
                </p>
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">صافي شغل الشهر ده</span>
                    <span className="tabular-nums">{formatEgp(reconciliation.monthLedgerCents)}</span>
                  </div>
                  {reconciliation.outsideMonthBreakdown.map((row) => (
                    <div key={row.transactionType} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{row.labelAr}</span>
                      <span className="tabular-nums">{formatEgp(row.amountCents)}</span>
                    </div>
                  ))}
                  <div className="mt-2 flex justify-between gap-2 border-t pt-2 font-medium">
                    <span>= رصيد المحفظة الحالي</span>
                    <span className={`tabular-nums ${reconciliation.currentBalanceCents < 0 ? 'text-destructive' : ''}`}>
                      {reconciliation.currentBalanceCents < 0 ? 'مديونية ' : ''}
                      {formatEgp(Math.abs(reconciliation.currentBalanceCents))}
                    </span>
                  </div>
                </div>
                {!reconciliation.monthMatchesLedger && (
                  <p className="mt-3 rounded bg-destructive/10 p-2 text-xs text-destructive">
                    ⚠️ كشف الشهر ({formatEgp(reconciliation.monthNetCents)}) مش مطابق لحركات المحفظة
                    لنفس الشهر ({formatEgp(reconciliation.monthLedgerCents)}) — ده خلل حقيقي محتاج
                    مراجعة، مش فرق طبيعي.
                  </p>
                )}
              </div>
            )}

            {statement.jobs.length === 0 ? (
              <EmptyState title="مفيش شغل مقفول في الشهر ده" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الطلب</TableHead>
                      <TableHead>الخدمة</TableHead>
                      <TableHead>السعر الأصلي</TableHead>
                      <TableHead>إضافات</TableHead>
                      <TableHead>فرق المستوى</TableHead>
                      <TableHead>خصم العميل</TableHead>
                      <TableHead>دفع العميل</TableHead>
                      <TableHead>العمولة</TableHead>
                      <TableHead>نصيب الفني</TableHead>
                      <TableHead>كاش استلمه</TableHead>
                      <TableHead>صافي حركة المحفظة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.jobs.map((j) => (
                      <TableRow key={j.orderId}>
                        <TableCell>
                          <a className="underline underline-offset-2" href={`/orders/${j.orderId}`}>
                            {j.orderNumber}
                          </a>
                          <div className="text-xs text-muted-foreground">
                            {new Date(j.closedAt).toLocaleDateString('ar-EG-u-nu-latn')}
                          </div>
                        </TableCell>
                        <TableCell>{j.serviceNameAr ?? '—'}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.originalPriceCents)}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.additionalWorkCents)}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.levelPremiumCents)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatEgp(j.customerDiscountCents)}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.customerPaidCents)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {formatEgp(j.platformCommissionCents)} ({j.commissionRatePercentage}%)
                        </TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.grossTechnicianEarningCents)}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(j.cashCollectedCents)}</TableCell>
                        <TableCell className={`font-medium tabular-nums ${j.netTechnicianDueCents < 0 ? 'text-destructive' : ''}`}>
                          {j.netTechnicianDueCents < 0 ? 'مديونية ' : ''}{formatEgp(Math.abs(j.netTechnicianDueCents))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'muted' }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'muted' ? 'text-muted-foreground' : ''}`}>
        {formatEgp(value)}
      </div>
    </div>
  );
}
