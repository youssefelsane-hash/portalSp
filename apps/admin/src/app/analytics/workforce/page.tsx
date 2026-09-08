'use client';

import { useState } from 'react';
import Link from 'next/link';
import type {
  AreaCoverageReport,
  TechnicianScorecardsReport,
  WorkforceLiveLoad,
  WorkforceSort,
  WorkforceSupplySnapshot,
} from '@baytak/shared-types';
import { TECHNICIAN_LEVEL_LABELS_AR } from '@baytak/shared-types';
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
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import { formatEgp } from '@/lib/format';
import {
  DEFAULT_RANGE_DAYS,
  daysAgoIso,
  exclusiveTo,
  formatCount,
  formatDuration,
  formatMinutes,
  inclusiveFrom,
  todayIso,
} from '@/lib/analytics-format';

const SORT_LABELS: Record<WorkforceSort, string> = {
  completed: 'الأكتر شغلًا',
  earnings: 'الأعلى أرباحًا',
  utilization: 'الأعلى استغلالًا',
  rating: 'الأعلى تقييمًا',
  idle: 'الأقل شغلًا (واقفين)',
  debt: 'الأعلى مديونية',
};

const pct = (value: number | null): string => (value === null ? '—' : `${value}%`);

export default function WorkforceAnalyticsPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });
  const [sort, setSort] = useState<WorkforceSort>('completed');
  const canSeeIndividual = hasPermission('analytics.financial.view');

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const key = params.toString();

  const supply = useAdminQuery<WorkforceSupplySnapshot>(
    isLoading ? null : `wf:${key}`,
    () => authedFetch<WorkforceSupplySnapshot>(`/admin/analytics/workforce?${key}`),
    'حصل خطأ في تحميل لقطة العرض',
  );

  const live = useAdminQuery<WorkforceLiveLoad>(
    isLoading ? null : 'wf-live',
    () => authedFetch<WorkforceLiveLoad>('/admin/analytics/workforce/live'),
    'حصل خطأ في تحميل الحمل اللحظي',
  );

  const coverage = useAdminQuery<AreaCoverageReport>(
    isLoading ? null : `wf-cov:${key}`,
    () => authedFetch<AreaCoverageReport>(`/admin/analytics/workforce/coverage?${key}&limit=50`),
    'حصل خطأ في تحميل التغطية الجغرافية',
  );

  const scorecards = useAdminQuery<TechnicianScorecardsReport>(
    isLoading || !canSeeIndividual ? null : `wf-cards:${key}:${sort}`,
    () =>
      authedFetch<TechnicianScorecardsReport>(`/admin/analytics/workforce/technicians?${key}&sort=${sort}&limit=100`),
    'حصل خطأ في تحميل كشف الفنيين',
  );

  const snap = supply.data;

  return (
    <AppShell>
      <PageHeader
        title="القوى العاملة"
        description="مين عندنا، مشغولين قد إيه، بيشتغلوا كويس ولا لأ، وفين الطلب موجود من غير ناس."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="pt-6">
            <AnalyticsRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="wf" />
          </CardContent>
        </Card>

        {supply.error && <EmptyState title={supply.error} />}
        {!supply.error && supply.loading && !snap && <EmptyState title="بنحمّل الأرقام…" />}

        {snap && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">العرض</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Figure label="معتمدين" value={formatCount(snap.headcount.approved)} />
                <Figure label="صنايعية" value={formatCount(snap.headcount.approved_technicians)} />
                <Figure label="مساعدين" value={formatCount(snap.headcount.approved_assistants)} />
                <Figure label="تحت المراجعة" value={formatCount(snap.headcount.in_pipeline)} />
                <Figure label="اشتغلوا في الفترة" value={formatCount(snap.active_in_period)} />
                {/* الطاقة الواقفة هي الرقم اللي بيخلّي «معندناش فنيين» تتحول لسؤال حقيقي. */}
                <Figure
                  label="معتمدين وواقفين"
                  value={formatCount(snap.idle_approved)}
                  hint="معتمد وماخدش أي شغل في الفترة"
                />
                <Figure label="انضموا في الفترة" value={formatCount(snap.headcount.new_joiners)} />
                <Figure label="وقفوا عن الشغل" value={formatCount(snap.churned)} hint="كانوا شغالين في الفترة اللي قبلها" />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Figure label="القدرة المتاحة" value={formatMinutes(snap.capacity_minutes)} />
                <Figure label="المحجوز فعلاً" value={formatMinutes(snap.booked_minutes)} />
                <Figure label="الاستغلال" value={pct(snap.utilization_percent)} />
              </div>

              <div className="flex flex-wrap gap-2">
                {snap.by_level.map((level) => (
                  <Badge key={level.level} variant="outline">
                    {TECHNICIAN_LEVEL_LABELS_AR[level.level] ?? level.level}: {formatCount(level.count)}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {snap && (
          <Card className={snap.debt.above_threshold > 0 ? 'border-amber-500/60' : undefined}>
            <CardHeader>
              <CardTitle className="text-base">المديونيات</CardTitle>
              <p className="text-muted-foreground text-sm">
                الدَّين مش عمود مخزّن — هو رصيد محفظة سالب، بيتقرا من نفس مصدر شاشة المديونيات.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Figure label="فنيين مديونين" value={formatCount(snap.debt.technicians_in_debt)} />
                <Figure label="إجمالي الدَّين" value={formatEgp(snap.debt.total_debt_cents)} />
                <Figure
                  label="فوق العتبة"
                  value={formatCount(snap.debt.above_threshold)}
                  hint={`العتبة ${formatEgp(snap.debt.threshold_cents)}`}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {live.data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">الحمل دلوقتي</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Figure label="طلبات شغّالة" value={formatCount(live.data.active_orders)} />
                <Figure label="فنيين مشغولين" value={formatCount(live.data.technicians_busy)} />
                <Figure
                  label="شغّالة بلا فني"
                  value={formatCount(live.data.unassigned_active_orders)}
                  hint="لسه بتدوّر على حد"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {coverage.data && (
          <Card className={coverage.data.uncovered_with_demand.length > 0 ? 'border-amber-500/60' : undefined}>
            <CardHeader>
              <CardTitle className="text-base">التغطية الجغرافية</CardTitle>
              <p className="text-muted-foreground text-sm">
                {coverage.data.uncovered_with_demand.length > 0
                  ? `${coverage.data.uncovered_with_demand.length} منطقة فيها طلب حقيقي وصفر فنيين ساكنين — دي أول أماكن التوظيف.`
                  : 'كل منطقة فيها طلب فيها فنيين.'}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {coverage.data.areas.length === 0 ? (
                <EmptyState title="مفيش نشاط جغرافي في الفترة دي" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنطقة</TableHead>
                      <TableHead>المدينة</TableHead>
                      <TableHead>طلبات</TableHead>
                      <TableHead>اتطابقت</TableHead>
                      <TableHead>من غير فني</TableHead>
                      <TableHead>فنيين</TableHead>
                      <TableHead>طلب لكل فني</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coverage.data.areas.map((area) => (
                      <TableRow
                        key={area.area_id}
                        className={area.technicians_home_based === 0 && area.orders_placed > 0 ? 'bg-amber-500/10' : undefined}
                      >
                        <TableCell>{area.area_name_ar}</TableCell>
                        <TableCell>{area.city_name_ar}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(area.orders_placed)}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(area.orders_matched)}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(area.orders_unmatched)}</TableCell>
                        <TableCell className="tabular-nums">{formatCount(area.technicians_home_based)}</TableCell>
                        <TableCell className="tabular-nums">
                          {area.orders_per_technician === null ? '—' : area.orders_per_technician}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">كشف الفنيين</CardTitle>
            <p className="text-muted-foreground text-sm">
              أداء كل واحد بالتفصيل. الاستغلال محسوب على قدرته هو من تاريخ اعتماده، مش على الفترة كلها.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {!canSeeIndividual ? (
              <EmptyState
                title="الكشف الفردي محتاج صلاحية إضافية"
                description="فيه أرباح ومديونيات بالاسم، فمحتاج analytics.financial.view."
              />
            ) : (
              <>
                <div className="mb-4 w-56">
                  <Label htmlFor="wf_sort">الترتيب</Label>
                  <SelectNative id="wf_sort" value={sort} onChange={(e) => setSort(e.target.value as WorkforceSort)}>
                    {Object.entries(SORT_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectNative>
                </div>
                {scorecards.error && <EmptyState title={scorecards.error} />}
                {scorecards.loading && !scorecards.data && <EmptyState title="بنحمّل الكشف…" />}
                {(scorecards.data?.technicians.length ?? 0) === 0 && !scorecards.loading && !scorecards.error && (
                  <EmptyState title="مفيش فنيين" />
                )}
                {(scorecards.data?.technicians.length ?? 0) > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الفني</TableHead>
                        <TableHead>المستوى</TableHead>
                        <TableHead>مكتمل</TableHead>
                        <TableHead>استغلال</TableHead>
                        <TableHead>قبول</TableHead>
                        <TableHead>زمن الرد</TableHead>
                        <TableHead>انضباط</TableHead>
                        <TableHead>تقييم</TableHead>
                        <TableHead>شكاوى</TableHead>
                        <TableHead>إعادة شغل</TableHead>
                        <TableHead>أرباح</TableHead>
                        <TableHead>دَين</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(scorecards.data?.technicians ?? []).map((t) => (
                        <TableRow key={t.technician_id}>
                          <TableCell>
                            <Link href={`/technicians/${t.technician_id}`} className="text-primary underline">
                              {t.display_name}
                            </Link>
                            <span className="text-muted-foreground block text-xs" dir="ltr">
                              {t.technician_code}
                            </span>
                          </TableCell>
                          <TableCell>{TECHNICIAN_LEVEL_LABELS_AR[t.level] ?? t.level}</TableCell>
                          <TableCell className="tabular-nums">{formatCount(t.completed_orders)}</TableCell>
                          <TableCell className="tabular-nums">{pct(t.utilization_percent)}</TableCell>
                          <TableCell className="tabular-nums">
                            {pct(t.acceptance_rate)}
                            {t.assignments_sent > 0 && (
                              <span className="text-muted-foreground block text-xs">
                                من {formatCount(t.assignments_sent)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {t.median_response_seconds === null ? '—' : formatDuration(t.median_response_seconds)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {pct(t.on_time_rate)}
                            {t.on_time_sample > 0 && (
                              <span className="text-muted-foreground block text-xs">من {formatCount(t.on_time_sample)}</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {t.average_rating === null ? '—' : t.average_rating}
                            {t.ratings_count > 0 && (
                              <span className="text-muted-foreground block text-xs">من {formatCount(t.ratings_count)}</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums">{formatCount(t.complaints_count)}</TableCell>
                          <TableCell className="tabular-nums">{formatCount(t.rework_count)}</TableCell>
                          <TableCell className="tabular-nums">{formatEgp(t.net_earnings_cents)}</TableCell>
                          <TableCell
                            className={t.debt_cents > 0 ? 'tabular-nums text-amber-700 dark:text-amber-500' : 'tabular-nums'}
                          >
                            {t.debt_cents > 0 ? formatEgp(t.debt_cents) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>
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
