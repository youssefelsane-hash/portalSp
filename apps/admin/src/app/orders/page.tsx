'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderCrewSummaryDto, OrderResponseDto } from '@baytak/shared-types';
import { formatWorkDuration } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { OrdersCalendar, type CalendarDay } from '@/components/orders-calendar';
import { OrdersSummaryBar, type OrdersSummary } from '@/components/orders-summary-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { SelectNative } from '@/components/ui/select-native';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  orderStatusTone,
  PAYMENT_STATUS_LABELS,
  paymentStatusTone,
} from '@/lib/order-labels';
import { formatEgp, formatExecutionWindow, formatRelativeSchedule } from '@/lib/format';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ErrorNotice } from '@/components/notice';
import { useRouter, useSearchParams } from 'next/navigation';

const PER_PAGE = 20;

/**
 * **النطاق — «إيه الطلبات اللي عايز أشوفها؟»** (ADR-0103، docs/08 §157).
 *
 * منفصل عن الترتيب عن قصد: قبل كده «تنفيذها قرّب» كانت Sort على كل التاريخ، فالمكتمل من سنة
 * كان بيطلع أول القايمة (بلاغ المالك). `current` هو الافتراضي عشان الأدمن يشوف تشغيل اليوم.
 */
const SCOPES: { value: 'current' | 'completed' | 'all'; label: string }[] = [
  { value: 'current', label: 'الحالية' },
  { value: 'completed', label: 'المكتملة' },
  { value: 'all', label: 'كل الطلبات' },
];

const BUCKETS: { value: string; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'tomorrow', label: 'بكرة' },
  { value: 'next7', label: '٧ أيام' },
  { value: 'upcoming', label: 'القادمة' },
  { value: 'overdue', label: 'المتأخرة' },
  { value: 'unassigned', label: 'بلا فني' },
];

const DATE_FIELDS: { value: string; label: string }[] = [
  { value: 'scheduled_at', label: 'موعد التنفيذ' },
  { value: 'placed_at', label: 'تاريخ الطلب' },
  { value: 'completed_at', label: 'تاريخ الإكمال' },
];

/** نطاقات جاهزة — بتكتب `from`/`to` على الحقل المختار، فمفيش داعي لتقويمين في الشريط الرئيسي. */
const RANGE_PRESETS: { value: string; label: string; days: number | null }[] = [
  { value: '', label: 'كل الفترات', days: null },
  { value: '0', label: 'اليوم', days: 0 },
  { value: '7', label: '٧ أيام', days: 7 },
  { value: '30', label: '٣٠ يوم', days: 30 },
];

const ORIGIN_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل الأنواع' },
  { value: 'false', label: 'عادية' },
  { value: 'true', label: 'متكررة' },
];

const PAYMENT_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'كل حالات الدفع' },
  ...Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label: String(label) })),
];

interface NamedOption {
  id: string;
  name_ar?: string;
  name?: string;
}

export default function OrdersPage() {
  // useSearchParams() محتاج Suspense boundary وقت الـ static prerendering.
  return (
    <Suspense>
      <OrdersListPage />
    </Suspense>
  );
}

function OrdersListPage() {
  const { isLoading, authedFetch, authedFetchPaginated, hasPermission } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // حالة القايمة في الـURL مش في state المكوّن (docs/08 §63.ب6) — الرجوع من تفاصيل طلب بيحافظ
  // على الفلاتر، واللينك قابل للمشاركة.
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const scope = (searchParams.get('scope') ?? 'current') as 'current' | 'completed' | 'all';
  const bucket = searchParams.get('bucket') ?? '';
  const dateField = searchParams.get('date_field') ?? 'scheduled_at';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const statusFilter = searchParams.get('status') ?? 'all';
  const paymentFilter = searchParams.get('payment') ?? 'all';
  const originFilter = searchParams.get('origin') ?? 'all';
  const serviceFilter = searchParams.get('service') ?? '';
  const zoneFilter = searchParams.get('zone') ?? '';
  const crewFilter = searchParams.get('crew') ?? '';
  const sortView = (searchParams.get('sort') === 'soonest' ? 'soonest' : 'newest') as 'newest' | 'soonest';
  const view = (searchParams.get('view') === 'calendar' ? 'calendar' : 'table') as 'table' | 'calendar';
  const searchTerm = searchParams.get('search') ?? '';

  /** عدد الفلاتر المتقدمة الفعّالة — بيتعرض على الزرار عشان الأدمن يعرف إن فيه فلتر مخفي شغّال. */
  const advancedCount = [statusFilter, paymentFilter, originFilter].filter((v) => v !== 'all' && v !== '').length
    + [serviceFilter, zoneFilter, crewFilter, from, to].filter((v) => v !== '').length;
  const [advancedOpen, setAdvancedOpen] = useState(advancedCount > 0);

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '' || v === 'all' || (k === 'page' && v === '1')) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `/orders?${qs}` : '/orders', { scroll: false });
  };

  const [orders, setOrders] = useState<OrderResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<OrdersSummary | null>(null);
  const [calendar, setCalendar] = useState<CalendarDay[] | null>(null);
  const [services, setServices] = useState<NamedOption[]>([]);
  const [zones, setZones] = useState<NamedOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** **نفس الفلاتر للقايمة والملخّص والتقويم** — وإلا الملخّص يقول رقم والقايمة تعرض غيره. */
  const filterParams = () => {
    const params = new URLSearchParams({ scope, date_field: dateField });
    if (bucket) params.set('bucket', bucket);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (statusFilter !== 'all') params.set('order_status', statusFilter);
    if (paymentFilter !== 'all') params.set('payment_status', paymentFilter);
    if (originFilter !== 'all') params.set('recurring', originFilter);
    if (serviceFilter) params.set('service_id', serviceFilter);
    if (zoneFilter) params.set('service_zone_id', zoneFilter);
    if (crewFilter) params.set('crew', crewFilter);
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    return params;
  };

  function loadOrders() {
    if (isLoading) return;
    const listParams = filterParams();
    listParams.set('page', String(page));
    listParams.set('per_page', String(PER_PAGE));
    listParams.set('sort', sortView);
    authedFetchPaginated<OrderResponseDto>(`/admin/orders?${listParams.toString()}`)
      .then(({ items, meta }) => {
        setOrders(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلبات'));

    // الملخّص والتقويم **بيفشلوا بهدوء** — معلومة مساعدة، مايصحّش يمنعوا القايمة نفسها.
    authedFetch<OrdersSummary>(`/admin/orders/summary?${filterParams().toString()}`)
      .then(setSummary)
      .catch(() => setSummary(null));

    if (view === 'calendar') {
      authedFetch<{ days: CalendarDay[] }>(`/admin/orders/calendar?${filterParams().toString()}`)
        .then((res) => setCalendar(res.days))
        .catch(() => setCalendar(null));
    }
  }

  useAdminLiveRefresh(['orders', 'payments'], loadOrders);

  useEffect(() => {
    loadOrders();
    // loadOrders intentionally reads the current filters; realtime callbacks use the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoading, page, scope, bucket, dateField, from, to, statusFilter, paymentFilter,
    originFilter, serviceFilter, zoneFilter, crewFilter, sortView, view, searchTerm, authedFetchPaginated,
  ]);

  /** قوايم الفلاتر بتتحمّل **مرة واحدة** لما الأدمن يفتح الفلاتر المتقدمة — مش مع كل صفحة. */
  useEffect(() => {
    if (isLoading || !advancedOpen || services.length > 0) return;
    authedFetchPaginated<NamedOption>('/admin/catalog/services?per_page=100')
      .then(({ items }) => setServices(items))
      .catch(() => setServices([]));
    authedFetchPaginated<NamedOption>('/admin/geo/service-zones?per_page=100')
      .then(({ items }) => setZones(items))
      .catch(() => setZones([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, advancedOpen]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const activePreset = (() => {
    if (!from || !to) return '';
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
    return RANGE_PRESETS.some((p) => p.days === days) ? String(days) : '';
  })();

  const applyPreset = (value: string) => {
    if (value === '') {
      setParams({ from: null, to: null, page: '1' });
      return;
    }
    const days = Number(value);
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);
    const isoDay = (d: Date) => d.toISOString().slice(0, 10);
    setParams({ from: isoDay(start), to: isoDay(end), bucket: null, page: '1' });
  };

  const resetAll = () =>
    router.replace('/orders', { scroll: false });

  return (
    <AppShell>
      <PageHeader
        title="الطلبات"
        description="النطاق بيحدّد الطلبات اللي بتشوفها، والترتيب بيحدّد شكلها جوّه النطاق — الاتنين مستقلين عن بعض."
        actions={
          hasPermission('orders.create_for_customer') ? (
            <Link href="/orders/create-for-customer">
              <Button>إنشاء طلب نيابة عن عميل</Button>
            </Link>
          ) : undefined
        }
      />

      {/* ═══ شريط واحد: النطاق + شكل العرض ═══ */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-xl border p-0.5">
          {SCOPES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setParams({ scope: s.value === 'current' ? null : s.value, page: '1' })}
              className={
                scope === s.value
                  ? 'rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                  : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground'
              }
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-xl border p-0.5">
          {(
            [
              { value: 'table', label: 'جدول' },
              { value: 'calendar', label: 'تقويم' },
            ] as const
          ).map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setParams({ view: v.value === 'table' ? null : v.value })}
              className={
                view === v.value
                  ? 'rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium'
                  : 'rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground'
              }
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ اختصارات تشغيلية ═══ */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {BUCKETS.map((b) => (
          <button
            key={b.value}
            type="button"
            onClick={() => setParams({ bucket: bucket === b.value ? null : b.value, page: '1' })}
            className={
              bucket === b.value
                ? 'rounded-full bg-secondary px-3 py-1 text-xs font-medium'
                : 'rounded-full border px-3 py-1 text-xs text-muted-foreground transition hover:bg-muted'
            }
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* ═══ سطر واحد: بحث + التاريخ + فتح الفلاتر ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-[260px] flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('search');
            setParams({ search: typeof value === 'string' ? value.trim() : null, page: '1' });
          }}
        >
          <Input
            name="search"
            defaultValue={searchTerm}
            key={searchTerm}
            placeholder="رقم الطلب، اسم/تليفون العميل أو الفني، أو Payment ID…"
            aria-label="بحث"
          />
          <Button type="submit" size="sm" variant="outline">
            بحث
          </Button>
        </form>

        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-xs text-muted-foreground">التاريخ حسب</span>
          <SelectNative
            className="h-9 w-auto"
            value={dateField}
            onChange={(e) => setParams({ date_field: e.target.value, page: '1' })}
            aria-label="التاريخ حسب"
          >
            {DATE_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </SelectNative>
          <SelectNative
            className="h-9 w-auto"
            value={activePreset}
            onChange={(e) => applyPreset(e.target.value)}
            aria-label="الفترة"
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {activePreset === '' && from && to && <option value="">فترة مخصّصة</option>}
          </SelectNative>
        </div>

        <Button size="sm" variant={advancedOpen ? 'secondary' : 'outline'} onClick={() => setAdvancedOpen((v) => !v)}>
          فلاتر متقدمة{advancedCount > 0 ? ` (${advancedCount})` : ''}
        </Button>
        {(advancedCount > 0 || bucket || searchTerm) && (
          <Button size="sm" variant="ghost" onClick={resetAll}>
            مسح الكل
          </Button>
        )}
      </div>

      {/* ═══ الفلاتر المتقدمة — بتفتح لما تتطلب بس ═══ */}
      {advancedOpen && (
        <div className="mb-4 grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="حالة الطلب">
            <SelectNative value={statusFilter} onChange={(e) => setParams({ status: e.target.value, page: '1' })}>
              <option value="all">كل الحالات</option>
              {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {String(label)}
                </option>
              ))}
            </SelectNative>
          </Field>
          <Field label="حالة الدفع">
            <SelectNative value={paymentFilter} onChange={(e) => setParams({ payment: e.target.value, page: '1' })}>
              {PAYMENT_FILTERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </SelectNative>
          </Field>
          <Field label="الخدمة">
            <SelectNative value={serviceFilter} onChange={(e) => setParams({ service: e.target.value, page: '1' })}>
              <option value="">كل الخدمات</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name_ar ?? s.name ?? s.id}
                </option>
              ))}
            </SelectNative>
          </Field>
          <Field label="المنطقة">
            <SelectNative value={zoneFilter} onChange={(e) => setParams({ zone: e.target.value, page: '1' })}>
              <option value="">كل المناطق</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name_ar ?? z.name ?? z.id}
                </option>
              ))}
            </SelectNative>
          </Field>
          <Field label="نوع الحجز">
            <SelectNative value={originFilter} onChange={(e) => setParams({ origin: e.target.value, page: '1' })}>
              {ORIGIN_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </SelectNative>
          </Field>
          <Field label="الطاقم">
            <SelectNative value={crewFilter} onChange={(e) => setParams({ crew: e.target.value, page: '1' })}>
              <option value="">أي طاقم</option>
              <option value="incomplete">الطاقم ناقص</option>
            </SelectNative>
          </Field>
          <Field label="الترتيب">
            <SelectNative
              value={sortView}
              onChange={(e) => setParams({ sort: e.target.value === 'newest' ? null : e.target.value, page: '1' })}
            >
              <option value="newest">الأحدث طلبًا</option>
              <option value="soonest">الأقرب تنفيذًا</option>
            </SelectNative>
          </Field>
          <Field label="فترة مخصّصة">
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={from}
                onChange={(e) => setParams({ from: e.target.value, page: '1' })}
                className="h-10"
                aria-label="من تاريخ"
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setParams({ to: e.target.value, page: '1' })}
                className="h-10"
                aria-label="إلى تاريخ"
              />
            </div>
          </Field>
        </div>
      )}

      {summary && (
        <OrdersSummaryBar
          summary={summary}
          activeBucket={bucket}
          onPickBucket={(b) => setParams({ bucket: bucket === b ? null : b, page: '1' })}
        />
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {view === 'calendar' ? (
        !calendar ? (
          <TableSkeleton columns={4} />
        ) : calendar.length === 0 ? (
          <EmptyState title="مفيش طلبات في الفترة دي" description="وسّع النطاق أو امسح فلتر التاريخ" />
        ) : (
          <OrdersCalendar
            days={calendar}
            selectedDay={from && from === to ? from : null}
            onPickDay={(day) => setParams({ from: day, to: day, bucket: null, view: null, page: '1' })}
          />
        )
      ) : (
        <>
          {!error && !orders && <TableSkeleton columns={7} />}
          {orders && orders.length === 0 && (
            <EmptyState title="مفيش طلبات مطابقة" description="جرّب توسّع النطاق أو تمسح فلتر التاريخ" />
          )}

          {orders && orders.length > 0 && (
            <>
              {/* مفيش wrapper هنا: `Table` نفسه عنده `overflow-x-auto` + border + rounding. */}
              <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الطلب</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>موعد التنفيذ</TableHead>
                      <TableHead>المدة</TableHead>
                      <TableHead>الطاقم</TableHead>
                      {/* **الفلوس عمود واحد** بدل «الدفع» + «الإجمالي»: القياس الحقيقي كان
                          جدول ١٠٢٩px جوّه حاوية ٩٢٦px، فالإجمالي كان بيخرج بره الشاشة ولازم
                          سحب أفقي عشان تشوف فلوس الطلب. المبلغ وحالة تحصيله معلومة واحدة
                          أصلاً، فبقوا فوق بعض في خانة واحدة. */}
                      <TableHead className="text-end">الدفع</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
                            {order.order_number}
                          </Link>
                          {/* النوع بيتعرض **بس لو مش عادي** — Badge «عادي» على كل صف زحمة بلا معلومة. */}
                          {order.order_type !== 'standard' && (
                            <div className="mt-1">
                              <Badge variant={order.order_type === 'emergency' ? 'destructive' : 'outline'}>
                                {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}
                              </Badge>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusChip tone={orderStatusTone(order.order_status)}>
                            {ORDER_STATUS_LABELS[order.order_status]}
                          </StatusChip>
                          <OrderFlags order={order} />
                        </TableCell>
                        <TableCell>
                          {order.scheduled_at ? (
                            <div className="flex flex-col leading-tight">
                              <span className="tabular-nums">
                                {new Date(order.scheduled_at).toLocaleDateString('ar-EG-u-nu-latn', {
                                  day: '2-digit',
                                  month: 'short',
                                })}
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {formatExecutionWindow(order.scheduled_at, order.duration_minutes) ??
                                  new Date(order.scheduled_at).toLocaleTimeString('ar-EG-u-nu-latn', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false,
                                  })}
                              </span>
                              <RelativeSchedule scheduledAt={order.scheduled_at} />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {/* المدة من نفس snapshot الطلب اللي العميل شافه (ADR-0102). */}
                        <TableCell className="whitespace-nowrap">
                          {formatWorkDuration(order.duration_minutes, order.estimated_duration_days) ?? (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {/* **عمود الطاقم محدود العرض**: أسماء طويلة كانت بتمدّ الجدول فالإجمالي
                            يخرج بره الشاشة (اتلقط بلقطة حقيقية). */}
                        <TableCell className="max-w-[190px]">
                          <CrewCell crew={order.crew ?? null} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-end">
                          <div className="font-medium tabular-nums">{formatEgp(order.total_amount_cents)}</div>
                          <div className="mt-1">
                            <StatusChip tone={paymentStatusTone(order.payment_status)}>
                              {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                            </StatusChip>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
              </Table>

              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                itemLabel="طلب"
                onPageChange={(p) => setParams({ page: String(p) })}
              />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

/** خانة فلتر مع عنوانها — بتضمن إن كل قايمة ليها اسم ظاهر بدل ما الأدمن يخمّن. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * **الوقت النسبي** — «بعد ساعتين» / «متأخر ٣٥ دقيقة».
 *
 * مكوّن منفصل عشان القيمة بتتحسب وقت الرندر: هي نسبية لـ«دلوقتي»، ولو اتحسبت مرة مع الصفحة
 * بتفضل تكبر كذب مع الوقت.
 */
function RelativeSchedule({ scheduledAt }: { scheduledAt: string }) {
  const relative = formatRelativeSchedule(scheduledAt);
  if (!relative) return null;
  const late = relative.startsWith('متأخر');
  return <span className={late ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>{relative}</span>;
}

/** علامات المشاكل التشغيلية — على نفس البيانات اللي الباك-إند بيفلتر بيها. */
function OrderFlags({ order }: { order: OrderResponseDto }) {
  const flags: string[] = [];
  if (!order.technician_id) flags.push('بلا فني');
  if (order.crew?.isTeamBooking && !order.crew.crewComplete) flags.push('الطاقم ناقص');
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="destructive" className="px-1.5 py-0 text-[10px]">
          {flag}
        </Badge>
      ))}
    </div>
  );
}

/** خلية الطاقم في قايمة الطلبات (docs/08 §63.ب5). */
function CrewCell({ crew }: { crew: OrderCrewSummaryDto | null }) {
  if (!crew || !crew.leaderTechnicianId) {
    return <span className="text-xs text-muted-foreground">لسه محدش أخدها</span>;
  }
  return (
    <div className="flex min-w-0 flex-col leading-tight">
      <span className="truncate font-medium" title={crew.leaderName ?? undefined}>
        {crew.leaderName ?? 'فني'}
      </span>
      {crew.isTeamBooking && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {1 + crew.members.length} من {crew.requiredTechnicians + crew.requiredAssistants || 1}
          {!crew.crewComplete && ' · ناقص'}
        </span>
      )}
      {crew.members.length > 0 && (
        <span className="truncate text-xs text-muted-foreground" title={crew.members.map((m) => m.fullName).join('، ')}>
          معاه: {crew.members.map((m) => m.fullName).join('، ')}
        </span>
      )}
    </div>
  );
}
