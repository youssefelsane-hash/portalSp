'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ExecutiveKpis, KpiValue } from '@baytak/shared-types';
import { KPI_LABELS_AR } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminQuery } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsRangePicker } from '@/components/analytics-range-picker';
import {
  DEFAULT_RANGE_DAYS,
  daysAgoIso,
  exclusiveTo,
  formatCount,
  formatKpiValue,
  inclusiveFrom,
  todayIso,
} from '@/lib/analytics-format';

/**
 * لوحة قيادة الشركة (ADR-0081، إحصائيات-٥).
 *
 * التجميع في مجموعات مش تزويق: خمستاشر رقم في شبكة واحدة بيبقوا حايط أرقام محدش بيقراه.
 * كل مجموعة بترد على سؤال واحد، والترتيب من «كام شغل» لـ«الناس اللي بتعمله».
 */
const GROUPS: { title: string; question: string; keys: string[] }[] = [
  {
    title: 'الحجم',
    question: 'اشتغلنا قد إيه؟',
    keys: ['completed_orders', 'placed_orders', 'repeat_rate'],
  },
  {
    title: 'المال',
    question: 'دخل كام وفضل كام؟',
    keys: ['gmv_cents', 'revenue_cents', 'contribution_margin_cents', 'technician_earnings_cents', 'discounts_cents', 'refunds_cents', 'refund_rate', 'cac_cents'],
  },
  {
    title: 'العمليات',
    question: 'بنلاقي فني ولا لأ، وفي قد إيه؟',
    keys: ['match_rate', 'cancellation_rate', 'median_time_to_match_seconds', 'avg_time_to_match_seconds'],
  },
  {
    title: 'الجودة',
    question: 'الشغل بيطلع كويس؟',
    keys: ['on_time_rate', 'complaint_rate', 'rework_rate'],
  },
  {
    title: 'العرض',
    question: 'الفنيين مشغولين وبيستمروا؟',
    keys: ['technician_utilization', 'technician_retention', 'approved_technicians'],
  },
];

/** المقاييس اللي «الأعلى أسوأ» — بتتلوّن بالعكس، وإلا نسبة إلغاء عالية بتبان إنجاز. */
const LOWER_IS_BETTER = new Set(['cancellation_rate', 'complaint_rate', 'rework_rate', 'refund_rate', 'refunds_cents', 'cac_cents']);

function KpiCard({ kpi }: { kpi: KpiValue }) {
  const label = KPI_LABELS_AR[kpi.key] ?? kpi.key;
  const unavailable = kpi.value === null;

  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={
          unavailable
            ? 'text-muted-foreground mt-1 text-lg font-medium'
            : LOWER_IS_BETTER.has(kpi.key)
              ? 'mt-1 text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-500'
              : 'mt-1 text-2xl font-semibold tabular-nums'
        }
      >
        {formatKpiValue(kpi)}
      </p>
      {/* سبب عدم التوفّر بيتعرض بدل رقم كاذب — ده كل الفكرة من `null` في الـAPI. */}
      {unavailable && kpi.unavailable_reason && (
        <p className="text-muted-foreground mt-1 text-xs">{kpi.unavailable_reason}</p>
      )}
      {/* حجم العيّنة بيمنع «١٠٠٪» على طلب واحد إنها تتقرا كإنجاز. */}
      {!unavailable && kpi.unit === 'percent' && kpi.sample_size !== null && (
        <p className="text-muted-foreground mt-1 text-xs">من {formatCount(kpi.sample_size)}</p>
      )}
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [range, setRange] = useState({ from: daysAgoIso(DEFAULT_RANGE_DAYS), to: todayIso() });
  const canSeeFinancial = hasPermission('analytics.financial.view');

  const params = new URLSearchParams({ from: inclusiveFrom(range.from), to: exclusiveTo(range.to) });
  const { data, loading, error } = useAdminQuery<ExecutiveKpis>(
    isLoading || !canSeeFinancial ? null : `executive:${params.toString()}`,
    () => authedFetch<ExecutiveKpis>(`/admin/analytics/executive?${params.toString()}`),
    'حصل خطأ في تحميل لوحة الإدارة',
  );

  const byKey = new Map((data?.kpis ?? []).map((k) => [k.key, k]));

  return (
    <AppShell>
      <PageHeader
        title="لوحة الإدارة"
        description="كل رقم هنا بيتحسب لحظة الطلب من بيانات التشغيل — مفيش عدّاد مخزّن ولا رقم متجمّد."
      />

      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="pt-6">
            <AnalyticsRangePicker
              from={range.from}
              to={range.to}
              onChange={setRange}
              idPrefix="exec"
            />
            <p className="text-muted-foreground mt-3 text-xs">
              الأساس الزمني بيختلف حسب السؤال عن قصد: الشغل المكتمل بتاريخ اكتماله، والفلوس بتاريخ
              دفعها، والطلبات بتاريخ طلبها.
            </p>
          </CardContent>
        </Card>

        {!canSeeFinancial && (
          <EmptyState
            title="مالكش صلاحية على أرقام الشركة"
            description="لوحة الإدارة محتاجة صلاحية analytics.financial.view. تقدر تشوف الفنل والقوى العاملة من القايمة."
          />
        )}
        {error && <EmptyState title={error} />}
        {canSeeFinancial && !error && loading && !data && <EmptyState title="بنحمّل الأرقام…" />}

        {data &&
          GROUPS.map((group) => {
            const kpis = group.keys.map((k) => byKey.get(k)).filter((k): k is KpiValue => k !== undefined);
            if (kpis.length === 0) return null;
            return (
              <Card key={group.title}>
                <CardHeader>
                  <CardTitle className="text-base">{group.title}</CardTitle>
                  <p className="text-muted-foreground text-sm">{group.question}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {kpis.map((kpi) => (
                      <KpiCard key={kpi.key} kpi={kpi} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">تفاصيل أعمق</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            <Link href="/analytics/funnel" className="text-primary underline">
              رحلة الحجز — الفلو بيتكسر فين؟
            </Link>
            <Link href="/analytics/money" className="text-primary underline">
              لوحة المال والتسوية
            </Link>
            <Link href="/analytics/workforce" className="text-primary underline">
              القوى العاملة
            </Link>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
