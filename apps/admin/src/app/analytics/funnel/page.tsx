'use client';

import { useState } from 'react';
import type { FunnelReport, FunnelServiceRow, FunnelStageRow } from '@baytak/shared-types';
import { FUNNEL_STAGE_LABELS_AR, FUNNEL_TRUST_LABELS_AR, funnelFailureLabelAr } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import { DEFAULT_RANGE_DAYS, daysAgoIso, exclusiveTo, formatCount, inclusiveFrom, todayIso } from '@/lib/analytics-format';

const stageLabel = (stage: string): string => FUNNEL_STAGE_LABELS_AR[stage] ?? stage;

/**
 * شريط المرحلة. العرض نسبة من **أول مرحلة** مش من المرحلة اللي قبلها — عشان الشكل نفسه
 * يوري التسريب المتراكم، وده السؤال اللي المالك سأله: «الناس بتقع فين؟».
 */
function StageBar({ row, isWorst }: { row: FunnelStageRow; isWorst: boolean }) {
  const width = Math.max(row.pct_of_entry ?? 0, 0.6);
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 flex-1 overflow-hidden rounded bg-muted">
        <div
          className={isWorst ? 'h-full bg-amber-500' : 'h-full bg-primary'}
          style={{ width: `${Math.min(width, 100)}%` }}
        />
      </div>
      <span className="w-20 shrink-0 text-sm tabular-nums">{formatCount(row.count)}</span>
      {/* حركة مجهولة الهوية: أحداث وصلت من غير معرّف محاولة، فمستحيل نعرف هي كام شخص.
          بتتعرض جنب الرقم بدل ما تتجمع عليه — جمعها كان بيخلّي المرحلة تتضخّم بعدد
          النداءات وتطلع أكبر من المرحلة اللي قبلها (بلاغ المالك 2026-09-11). */}
      {row.untracked_count > 0 && (
        <span
          className="text-muted-foreground w-20 shrink-0 text-xs tabular-nums"
          title="أحداث من غير معرّف محاولة — مش متحسبة في الرقم لأنها ممكن تكون كلها من شخص واحد"
        >
          +{formatCount(row.untracked_count)} مجهول
        </span>
      )}
      <span className="text-muted-foreground w-16 shrink-0 text-sm tabular-nums">
        {row.pct_of_entry === null ? '—' : `${row.pct_of_entry}%`}
      </span>
    </div>
  );
}

export default function FunnelPage() {
  const { isLoading, authedFetch } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const key = params.toString();

  const funnel = useAdminQuery<FunnelReport>(
    isLoading ? null : `funnel:${key}`,
    () => authedFetch<FunnelReport>(`/admin/analytics/funnel?${key}`),
    'حصل خطأ في تحميل رحلة الحجز',
  );

  const byService = useAdminQuery<FunnelServiceRow[]>(
    isLoading ? null : `funnel-svc:${key}`,
    () => authedFetch<FunnelServiceRow[]>(`/admin/analytics/funnel/by-service?${key}&limit=20`),
    'حصل خطأ في تحميل الفنل حسب الخدمة',
  );

  const report = funnel.data;
  const worstStage = report?.worst_drop?.stage ?? null;
  /**
   * الـAPI بيرجّع المراحل كلها حتى لو كلها أصفار، فـ«القايمة فاضية» مابتحصلش أبدًا. رسم صفوف
   * أعمدة كلها صفر بيوحي إن فيه بيانات وهي مفيش — بلاغ حقيقي اتلقط في المراجعة البصرية.
   */
  const hasFunnelData = (report?.stages ?? []).some((s) => s.count > 0);

  return (
    <AppShell>
      <PageHeader
        title="رحلة الحجز"
        description="فين بالظبط الناس بتقع في الطريق من «شاف الخدمة» لـ«الشغل خلص»."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="pt-6">
            <AnalyticsRangePicker from={range.from} to={range.to} onChange={setRange} idPrefix="funnel" />
          </CardContent>
        </Card>

        {funnel.error && <EmptyState title={funnel.error} />}
        {!funnel.error && funnel.loading && !report && <EmptyState title="بنحمّل الرحلة…" />}

        {report?.worst_drop && (
          <Card className="border-amber-500/60">
            <CardHeader>
              <CardTitle className="text-base">أوحش نقطة تسريب</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-semibold">
                {stageLabel(report.worst_drop.stage)} — {report.worst_drop.drop_rate}% وقعوا هنا
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {formatCount(report.worst_drop.dropped)} حد وصلوا للخطوة اللي قبلها وماكمّلوش. دي أول
                صفحة تستاهل الإصلاح.
              </p>
            </CardContent>
          </Card>
        )}

        {report && hasFunnelData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">المراحل</CardTitle>
              <p className="text-muted-foreground text-sm">
                الجلسات المتتبّعة: {formatCount(report.sessions_tracked)} · طلبات من غير جلسة متتبّعة:{' '}
                {formatCount(report.sessions_untracked)}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {report.stages.map((row) => (
                <div key={row.stage}>
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{stageLabel(row.stage)}</span>
                    <Badge variant="outline" className="text-xs">
                      {FUNNEL_TRUST_LABELS_AR[row.trust] ?? row.trust}
                    </Badge>
                    {row.drop_rate_from_previous !== null && row.drop_rate_from_previous > 0 && (
                      <span className="text-muted-foreground text-xs">
                        وقع {formatCount(row.dropped_from_previous ?? 0)} ({row.drop_rate_from_previous}%) من
                        اللي قبلها
                      </span>
                    )}
                    {/* الفشل ≠ الانسحاب: ده المنتج اللي منع العميل، مش إنه غيّر رأيه. */}
                    {row.failed_count > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {formatCount(row.failed_count)} محاولة فشلت
                      </Badge>
                    )}
                  </div>
                  <StageBar row={row} isWorst={row.stage === worstStage} />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {report && !hasFunnelData && !funnel.loading && (
          <EmptyState
            title="مفيش أحداث رحلة في الفترة دي"
            description="المراحل بتتسجّل مع كل حجز حقيقي من لحظة تفعيل التتبّع. الفترات اللي قبل التفعيل هتفضل فاضية — ودي مش بَقّة."
          />
        )}

        {report && report.top_failures.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">أكتر أسباب الفشل</CardTitle>
              <p className="text-muted-foreground text-sm">
                دي حالات المنتج منع فيها العميل يكمّل — أخطر من الانسحاب الطبيعي لأنها مشكلة عندنا.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المرحلة</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>العدد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.top_failures.map((row, i) => (
                    <TableRow key={`${row.stage}-${row.failure_reason}-${i}`}>
                      <TableCell>{stageLabel(row.stage)}</TableCell>
                      {/* بلاغ مالك: كان بيتعرض الكود الخام (`BAL_001`) وبس. الكود بيفضل ظاهر
                          تحت الجملة لأنه اللي بيتبحث بيه في اللوج (`scripts/find-error.js`) —
                          الترجمة زوّدت المعنى، ماشلتش وسيلة التشخيص. */}
                      <TableCell>
                        <span className="text-sm">{funnelFailureLabelAr(row.failure_reason)}</span>
                        <span dir="ltr" className="text-muted-foreground block font-mono text-[11px]">
                          {row.failure_reason}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">التحويل حسب الخدمة</CardTitle>
            <p className="text-muted-foreground text-sm">خدمة بيدخلها ناس كتير وبتطلع طلبات قليلة = مشكلة في الخدمة نفسها.</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {byService.error && <EmptyState title={byService.error} />}
            {!byService.error && (byService.data?.length ?? 0) === 0 && !byService.loading && (
              <EmptyState title="مفيش بيانات خدمات في الفترة دي" />
            )}
            {(byService.data?.length ?? 0) > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الخدمة</TableHead>
                    <TableHead>بدأوا</TableHead>
                    <TableHead>طلبوا</TableHead>
                    <TableHead>فشلوا</TableHead>
                    <TableHead>نسبة التحويل</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(byService.data ?? []).map((row) => (
                    <TableRow key={row.service_id}>
                      <TableCell>{row.name_ar}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.started)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.placed)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(row.failed)}</TableCell>
                      <TableCell className="tabular-nums">{row.conversion_pct}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
