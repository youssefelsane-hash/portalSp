'use client';

import { useEffect, useState } from 'react';
import type {
  ReportGroupBy,
  RevenuePeriodRow,
  TechnicianReportRow,
  TechniciansReportSortBy,
  ZoneReportRow,
} from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const PER_PAGE = 20;

// اللون الوحيد المستخدم في الرسم — قيمة مقروءة (magnitude)، مش هوية (identity)، فمفيش داعي
// لأكتر من hue واحد ولا legend (راجع dataviz skill: sequential = hue واحد فاتح→غامق).
const BAR_COLOR = '#2563eb';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// بَقّة حقيقية اتلقطت واتصلحت وقت المراجعة البصرية للرسم (خطوة 7 في dataviz skill — "ارسمه
// وبصّله"): الباك-إند بيرجّع صف واحد بس للفترات اللي فيها طلبات فعلاً (GROUP BY عادي، مش
// zero-filled) — لو فترة الـ 30 يوم الافتراضية فيها يوم واحد بس عليه طلبات، كان بيطلع عمود
// واحد عملاق بياخد عرض/ارتفاع الرسم كله، وكأن كل الإيراد حصل "طول الوقت" مش في يوم واحد بالذات.
// الدالة دي بتملأ الفترات الفاضية بصفر عشان الرسم يعكس نطاق التاريخ المطلوب فعلياً، مطابقة
// لسيمانتيكس date_trunc في Postgres (أسبوع بيبدأ الاثنين ISO).
function zeroFillPeriods(rows: RevenuePeriodRow[], from: string, to: string, groupBy: ReportGroupBy): RevenuePeriodRow[] {
  const byPeriod = new Map(rows.map((r) => [r.period_start.slice(0, 10), r]));
  const result: RevenuePeriodRow[] = [];
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);

  let cursor: Date;
  if (groupBy === 'day') {
    cursor = fromDate;
  } else if (groupBy === 'week') {
    const day = fromDate.getUTCDay(); // 0=الأحد
    const diffToMonday = day === 0 ? -6 : 1 - day;
    cursor = new Date(fromDate);
    cursor.setUTCDate(cursor.getUTCDate() + diffToMonday);
  } else {
    cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
  }

  let guard = 0;
  while (cursor <= toDate && guard < 400) {
    guard += 1;
    const key = cursor.toISOString().slice(0, 10);
    const existing = byPeriod.get(key);
    result.push(
      existing ?? {
        period_start: cursor.toISOString(),
        orders_count: 0,
        total_amount_cents: 0,
        platform_commission_cents: 0,
        technician_earnings_cents: 0,
      },
    );
    if (groupBy === 'day') cursor = new Date(cursor.getTime() + 86_400_000);
    else if (groupBy === 'week') cursor = new Date(cursor.getTime() + 7 * 86_400_000);
    else cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

const GROUP_BY_LABELS: Record<ReportGroupBy, string> = { day: 'يومي', week: 'أسبوعي', month: 'شهري' };

const TECH_SORT_LABELS: Record<TechniciansReportSortBy, string> = {
  completed_orders: 'طلبات مكتملة',
  average_rating: 'متوسط التقييم',
  cancelled_orders: 'طلبات ملغاة',
  quality_score: 'نقاط الجودة',
};

function RevenueChart({ rows }: { rows: RevenuePeriodRow[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">مفيش بيانات في الفترة دي</p>;

  const width = 800;
  const height = 220;
  const padding = 8;
  // هامش علوي ثابت محجوز لنص الـ tooltip — لو محسبناش المساحة دي بره منطقة الأعمدة، أي عمود
  // بيوصل لأعلى الرسم (زي عمود القيمة الوحيدة في نطاق فاضي غالباً) بيخلي نص الـ tooltip يتقطع
  // على حافة الـ viewBox. بَقّة حقيقية اتلقطت بصرياً وقت اختبار الشاشة دي حياً.
  const topReserve = 20;
  const chartHeight = height - padding * 2 - topReserve;
  const barGap = 6;
  const barWidth = Math.max(6, (width - padding * 2) / rows.length - barGap);
  const maxValue = Math.max(...rows.map((r) => r.total_amount_cents), 1);
  const hasAnyValue = rows.some((r) => r.total_amount_cents > 0);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: rows.length > 20 ? rows.length * 14 : undefined }}
        role="img"
        aria-label="رسم بياني بالإيرادات حسب الفترة"
      >
        {rows.map((row, i) => {
          const barHeight = row.total_amount_cents > 0 ? Math.max(2, (row.total_amount_cents / maxValue) * chartHeight) : 0;
          const x = padding + i * (barWidth + barGap);
          const y = padding + topReserve + (chartHeight - barHeight);
          const isHovered = hovered === i;
          return (
            <g key={row.period_start}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={2}
                fill={BAR_COLOR}
                opacity={row.total_amount_cents === 0 ? 0.15 : isHovered ? 1 : 0.85}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              />
              {isHovered && (
                <text x={x + barWidth / 2} y={topReserve - 6} textAnchor="middle" className="fill-foreground" fontSize="11">
                  {formatEgp(row.total_amount_cents)}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={padding}
          y1={padding + topReserve + chartHeight}
          x2={width - padding}
          y2={padding + topReserve + chartHeight}
          stroke="currentColor"
          strokeOpacity={0.2}
          pointerEvents="none"
        />
      </svg>
      {!hasAnyValue && <p className="text-sm text-muted-foreground">مفيش إيراد مسجّل في الفترة دي</p>}
      {hovered !== null && rows[hovered] && (
        <p className="text-sm text-muted-foreground">
          {new Date(rows[hovered].period_start).toLocaleDateString('ar-EG-u-nu-latn')} —{' '}
          {rows[hovered].orders_count} طلب، إجمالي {formatEgp(rows[hovered].total_amount_cents)}
        </p>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { isLoading, authedFetch, authedFetchPaginated } = useAuth();

  const [revenueFrom, setRevenueFrom] = useState(daysAgoIso(30));
  const [revenueTo, setRevenueTo] = useState(todayIso());
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('day');
  const [revenueRows, setRevenueRows] = useState<RevenuePeriodRow[] | null>(null);
  const [revenueError, setRevenueError] = useState<string | null>(null);

  const [techSortBy, setTechSortBy] = useState<TechniciansReportSortBy>('completed_orders');
  const [techOrder, setTechOrder] = useState<'asc' | 'desc'>('desc');
  const [techPage, setTechPage] = useState(1);
  const [techRows, setTechRows] = useState<TechnicianReportRow[] | null>(null);
  const [techTotal, setTechTotal] = useState(0);
  const [techError, setTechError] = useState<string | null>(null);

  const [zoneRows, setZoneRows] = useState<ZoneReportRow[] | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);

  function loadRevenue() {
    const params = new URLSearchParams({ from: revenueFrom, to: revenueTo, group_by: groupBy });
    authedFetch<RevenuePeriodRow[]>(`/admin/reports/revenue?${params.toString()}`)
      .then(setRevenueRows)
      .catch((err) => setRevenueError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تقرير الإيرادات'));
  }

  function loadTechnicians() {
    const params = new URLSearchParams({
      sort_by: techSortBy,
      order: techOrder,
      page: String(techPage),
      per_page: String(PER_PAGE),
    });
    authedFetchPaginated<TechnicianReportRow>(`/admin/reports/technicians?${params.toString()}`)
      .then(({ items, meta }) => {
        setTechRows(items);
        setTechTotal(meta.total ?? items.length);
      })
      .catch((err) => setTechError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تقرير الفنيين'));
  }

  function loadZones() {
    authedFetch<ZoneReportRow[]>('/admin/reports/zones')
      .then(setZoneRows)
      .catch((err) => setZoneError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل تقرير المناطق'));
  }

  useEffect(() => {
    if (isLoading) return;
    loadRevenue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, revenueFrom, revenueTo, groupBy]);

  useEffect(() => {
    if (isLoading) return;
    loadTechnicians();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, techSortBy, techOrder, techPage]);

  useEffect(() => {
    if (isLoading) return;
    loadZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const techTotalPages = Math.max(1, Math.ceil(techTotal / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="التقارير" />

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الإيرادات حسب الفترة</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="revenue_from">من</Label>
                <Input id="revenue_from" type="date" value={revenueFrom} onChange={(e) => setRevenueFrom(e.target.value)} dir="ltr" />
              </div>
              <div>
                <Label htmlFor="revenue_to">لحد</Label>
                <Input id="revenue_to" type="date" value={revenueTo} onChange={(e) => setRevenueTo(e.target.value)} dir="ltr" />
              </div>
              <div>
                <Label htmlFor="group_by">التجميع</Label>
                <SelectNative id="group_by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as ReportGroupBy)}>
                  {Object.entries(GROUP_BY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
            </div>

            {revenueError && <p className="text-destructive">{revenueError}</p>}
            {!revenueError && !revenueRows && <p className="text-muted-foreground">جاري التحميل…</p>}
            {revenueRows && (
              <>
                <RevenueChart rows={zeroFillPeriods(revenueRows, revenueFrom, revenueTo, groupBy)} />
                {revenueRows.length > 0 && (
                  <Table className="mt-4">
                    <TableHeader>
                      <TableRow>
                        <TableHead>الفترة</TableHead>
                        <TableHead>عدد الطلبات</TableHead>
                        <TableHead>الإيراد</TableHead>
                        <TableHead>عمولة المنصة</TableHead>
                        <TableHead>أرباح الفنيين</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueRows.map((row) => (
                        <TableRow key={row.period_start}>
                          <TableCell>{new Date(row.period_start).toLocaleDateString('ar-EG-u-nu-latn')}</TableCell>
                          <TableCell>{row.orders_count}</TableCell>
                          <TableCell>{formatEgp(row.total_amount_cents)}</TableCell>
                          <TableCell>{formatEgp(row.platform_commission_cents)}</TableCell>
                          <TableCell>{formatEgp(row.technician_earnings_cents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">أداء الفنيين</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="tech_sort_by">الترتيب حسب</Label>
                <SelectNative
                  id="tech_sort_by"
                  value={techSortBy}
                  onChange={(e) => {
                    setTechSortBy(e.target.value as TechniciansReportSortBy);
                    setTechPage(1);
                  }}
                >
                  {Object.entries(TECH_SORT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectNative>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTechOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              >
                {techOrder === 'desc' ? 'الأعلى أولاً' : 'الأقل أولاً'}
              </Button>
            </div>

            {techError && <p className="text-destructive">{techError}</p>}
            {!techError && !techRows && <p className="text-muted-foreground">جاري التحميل…</p>}
            {techRows && techRows.length === 0 && <p className="text-muted-foreground">مفيش فنيين</p>}
            {techRows && techRows.length > 0 && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الكود</TableHead>
                      <TableHead>الاسم</TableHead>
                      <TableHead>المستوى</TableHead>
                      <TableHead>مكتملة</TableHead>
                      <TableHead>ملغاة</TableHead>
                      <TableHead>التقييم</TableHead>
                      <TableHead>نقاط الجودة</TableHead>
                      <TableHead>متوسط زمن الرد</TableHead>
                      <TableHead>شكاوى مفتوحة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {techRows.map((row) => (
                      <TableRow key={row.technician_id}>
                        <TableCell dir="ltr">{row.technician_code}</TableCell>
                        <TableCell>{row.full_name}</TableCell>
                        <TableCell>{row.current_level}</TableCell>
                        <TableCell>{row.completed_orders_count}</TableCell>
                        <TableCell>{row.cancelled_orders_count}</TableCell>
                        <TableCell>{row.average_rating.toFixed(2)}</TableCell>
                        <TableCell>{row.quality_score.toFixed(2)}</TableCell>
                        <TableCell>
                          {row.avg_response_seconds !== null ? `${Math.round(row.avg_response_seconds)} ث` : '—'}
                        </TableCell>
                        <TableCell>{row.open_complaints_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    صفحة {techPage} من {techTotalPages} ({techTotal} فني إجمالاً)
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={techPage <= 1} onClick={() => setTechPage((p) => p - 1)}>
                      السابق
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={techPage >= techTotalPages}
                      onClick={() => setTechPage((p) => p + 1)}
                    >
                      التالي
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">أداء المناطق</CardTitle>
          </CardHeader>
          <CardContent>
            {zoneError && <p className="text-destructive">{zoneError}</p>}
            {!zoneError && !zoneRows && <p className="text-muted-foreground">جاري التحميل…</p>}
            {zoneRows && zoneRows.length === 0 && <p className="text-muted-foreground">مفيش مناطق</p>}
            {zoneRows && zoneRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنطقة</TableHead>
                    <TableHead>المدينة</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الطلبات</TableHead>
                    <TableHead>المكتملة</TableHead>
                    <TableHead>الإيراد</TableHead>
                    <TableHead>عمولة المنصة</TableHead>
                    <TableHead>فنيين نشطين</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zoneRows.map((zone) => (
                    <TableRow key={zone.zone_id}>
                      <TableCell>{zone.name_ar}</TableCell>
                      <TableCell>{zone.city_name_ar}</TableCell>
                      <TableCell>{zone.is_active ? 'نشط' : 'معطّل'}</TableCell>
                      <TableCell>{zone.orders_count}</TableCell>
                      <TableCell>{zone.completed_orders_count}</TableCell>
                      <TableCell>{formatEgp(zone.revenue_cents)}</TableCell>
                      <TableCell>{formatEgp(zone.platform_commission_cents)}</TableCell>
                      <TableCell>{zone.active_technicians_count}</TableCell>
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
