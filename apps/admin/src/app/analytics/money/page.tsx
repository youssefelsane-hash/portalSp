'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { MoneySnapshot, ReconciliationReport } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import { formatEgp } from '@/lib/format';
import { DEFAULT_RANGE_DAYS, daysAgoIso, exclusiveTo, formatCount, inclusiveFrom, todayIso } from '@/lib/analytics-format';

/** السطر الأخير في السلّم هو الخلاصة — بيتعرض أعرض وأغمق عشان يتقرا كنتيجة مش كبند. */
const SUMMARY_LINE = 'net_platform_revenue';

export default function MoneyPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });
  const [showReconciliation, setShowReconciliation] = useState(false);
  const canSee = hasPermission('analytics.financial.view');

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const key = params.toString();

  const money = useAdminQuery<MoneySnapshot>(
    isLoading || !canSee ? null : `money:${key}`,
    () => authedFetch<MoneySnapshot>(`/admin/analytics/money?${key}`),
    'حصل خطأ في تحميل لوحة المال',
  );

  // التفاصيل بتتطلب **لما الأدمن يطلبها** — الفحص بيمشي على كل المحافظ، فمالوش لزوم على كل فتحة.
  const reconciliation = useAdminQuery<ReconciliationReport>(
    showReconciliation && !isLoading && canSee ? 'reconciliation' : null,
    () => authedFetch<ReconciliationReport>('/admin/analytics/money/reconciliation'),
    'حصل خطأ في تحميل تفاصيل التسوية',
  );

  const data = money.data;
  const balanced = data ? data.unreconciled_count === 0 : null;

  return (
    <AppShell>
      <PageHeader
        title="لوحة المال"
        description="خمس سطور بأسماء واضحة وتعريف مكتوب مع كل رقم — ومعاهم فحص «الفلوس غير المسوّاة»."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="pt-6">
            <AnalyticsRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="money" />
          </CardContent>
        </Card>

        {!canSee && (
          <EmptyState
            title="مالكش صلاحية على الأرقام المالية"
            description="الشاشة دي محتاجة صلاحية analytics.financial.view."
          />
        )}
        {money.error && <EmptyState title={money.error} />}
        {canSee && !money.error && money.loading && !data && <EmptyState title="بنحمّل الأرقام…" />}

        {/*
          أهم سطر في اللوحة كله — طلب المالك الحرفي: «آخر سطر أهم سطر». بيتعرض **فوق** مش تحت
          لأنه اللي بيقول لو باقي الأرقام يتقرا أصلاً ولا لأ.
        */}
        {data && (
          <Card className={balanced ? 'border-emerald-600/60' : 'border-destructive'}>
            <CardHeader>
              <CardTitle className="text-base">فلوس غير مسوّاة</CardTitle>
            </CardHeader>
            <CardContent>
              <p
                className={
                  balanced
                    ? 'text-3xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400'
                    : 'text-destructive text-3xl font-semibold tabular-nums'
                }
              >
                {formatCount(data.unreconciled_count)}
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {balanced
                  ? 'دفتر القيود متسوّي: كل رصيد محفظة = مجموع حركاتها، وكل حركة حسابها مظبوط.'
                  : 'فيه مخالفات في دفتر القيود. الرقم ده لازم يفضل صفر — أي حاجة غيره معناها فلوس مش مفسّرة.'}
              </p>
              {!balanced && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowReconciliation(true)}
                >
                  وريني التفاصيل
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {showReconciliation && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">تفاصيل مخالفات التسوية</CardTitle>
              {reconciliation.data && (
                <p className="text-muted-foreground text-sm">
                  اتفحص {formatCount(reconciliation.data.checked_wallets)} محفظة و
                  {formatCount(reconciliation.data.checked_transactions)} حركة — إجمالي المخالفات{' '}
                  {formatCount(reconciliation.data.total_issues)}
                  {reconciliation.data.issues_truncated ? ' (معروض عيّنة منها)' : ''}.
                </p>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {reconciliation.error && <EmptyState title={reconciliation.error} />}
              {reconciliation.loading && !reconciliation.data && <EmptyState title="بنفحص الدفتر…" />}
              {(reconciliation.data?.issues.length ?? 0) > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>المحفظة</TableHead>
                      <TableHead>الفرق</TableHead>
                      <TableHead>التفصيل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reconciliation.data?.issues ?? []).map((issue, i) => (
                      <TableRow key={`${issue.wallet_id}-${i}`}>
                        <TableCell dir="ltr" className="font-mono text-xs">
                          {issue.kind}
                        </TableCell>
                        <TableCell dir="ltr" className="font-mono text-xs">
                          {issue.wallet_id.slice(0, 8)}…
                        </TableCell>
                        <TableCell className="tabular-nums">{formatEgp(issue.difference_cents)}</TableCell>
                        <TableCell className="text-sm">{issue.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">سلّم الإيراد</CardTitle>
              <p className="text-muted-foreground text-sm">
                من إجمالي المبيعات لصافي إيراد المنصة — كل سطر بتعريفه، عشان محدش يخلط بين حجم
                الشغل ودخل الشركة.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.lines.map((line) => (
                <div
                  key={line.key}
                  className={
                    line.key === SUMMARY_LINE
                      ? 'rounded-lg border-2 border-primary/40 bg-primary/5 p-4'
                      : 'rounded-lg border p-4'
                  }
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={line.key === SUMMARY_LINE ? 'text-base font-semibold' : 'text-sm font-medium'}>
                      {line.label_ar}
                    </span>
                    <span
                      className={
                        line.key === SUMMARY_LINE
                          ? 'text-2xl font-semibold tabular-nums'
                          : 'text-lg font-semibold tabular-nums'
                      }
                    >
                      {formatEgp(line.amount_cents)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">{line.definition_ar}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">التوزيع والمعلّق</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Figure label="مستحقات الصنايعية" value={formatEgp(data.technician_earnings_cents)} />
                <Figure label="مستحقات المساعدين" value={formatEgp(data.assistant_earnings_cents)} />
                <Figure
                  label="تسويات معلّقة"
                  value={formatEgp(data.pending_settlements_cents)}
                  hint={`${formatCount(data.pending_settlements_count)} طلب`}
                />
                <Figure
                  label="مدفوعات فشلت"
                  value={formatEgp(data.failed_payments_cents)}
                  hint={`${formatCount(data.failed_payments_count)} محاولة`}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {data && (
          <Card className={data.double_payments_count > 0 ? 'border-amber-500/60' : undefined}>
            <CardHeader>
              <CardTitle className="text-base">الدفع المزدوج</CardTitle>
              <p className="text-muted-foreground text-sm">
                {data.double_payments_count > 0
                  ? `${formatCount(data.double_payments_count)} طلب اتدفع أكتر من قيمته، بزيادة ${formatEgp(data.double_payments_overpaid_cents)}. الاسترداد **يدوي** — الشاشة دي بتعرض بس، مفيش أي فلوس بتتحرك من هنا.`
                  : 'مفيش أي طلب اتدفع أكتر من قيمته في الفترة دي.'}
              </p>
            </CardHeader>
            {data.double_payments.length > 0 && (
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الطلب</TableHead>
                      <TableHead>قيمة الطلب</TableHead>
                      <TableHead>المدفوع</TableHead>
                      <TableHead>الزيادة</TableHead>
                      <TableHead>عدد الدفعات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.double_payments.map((row) => (
                      <TableRow key={row.order_id}>
                        <TableCell>
                          <Link href={`/orders/${row.order_id}`} className="text-primary underline" dir="ltr">
                            {row.order_number}
                          </Link>
                        </TableCell>
                        <TableCell className="tabular-nums">{formatEgp(row.order_total_cents)}</TableCell>
                        <TableCell className="tabular-nums">{formatEgp(row.paid_cents)}</TableCell>
                        <TableCell className="tabular-nums text-amber-700 dark:text-amber-500">
                          {formatEgp(row.overpaid_cents)}
                        </TableCell>
                        <TableCell className="tabular-nums">{formatCount(row.succeeded_payments)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </div>
  );
}
