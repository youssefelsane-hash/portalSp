'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderCrewSummaryDto, OrderResponseDto, OrderStatus } from '@baytak/shared-types';
import { formatWorkDuration } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { StatusChip } from '@/components/status-chip';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import { useRouter, useSearchParams } from 'next/navigation';

const PER_PAGE = 20;

/**
 * **النطاق — «إيه الطلبات اللي عايز أشوفها؟»** (ADR-0103، docs/08 §157).
 *
 * بلاغ المالك: «لو دوست على الطلبات اللي موعد تنفيذها قرب، بيجيبلي طلبات مكتملة وتنفيذها عدى
 * من أسبوعين… بيجيبلي أول طلب في السيستم».
 *
 * السبب إن «تنفيذها قرّب» كانت **Sort** على كل التاريخ، مش Scope. الطبقة دي هي الفصل: النطاق
 * بيحدّد المجموعة، والترتيب بيحدّد شكلها جواها. و`current` هو الافتراضي عشان الأدمن الصبح
 * يشوف تشغيل اليوم مش مكتمل السنة اللي فاتت.
 */
const SCOPES: { value: 'current' | 'completed' | 'all'; label: string; hint: string }[] = [
  { value: 'current', label: 'الحالية', hint: 'كل طلب لسه ماوصلش لحالة نهائية' },
  { value: 'completed', label: 'المكتملة', hint: 'سجل الطلبات المقفولة (مكتمل/ملغي/مسترد)' },
  { value: 'all', label: 'كل الطلبات', hint: 'التاريخ كله — للتنقيب' },
];

/** اختصارات تشغيلية جوّه النطاق — كلها مشتقّة في الباك-إند، مفيش حالة جديدة. */
const BUCKETS: { value: string; label: string }[] = [
  { value: 'today', label: 'اليوم' },
  { value: 'tomorrow', label: 'بكرة' },
  { value: 'next7', label: '٧ أيام' },
  { value: 'upcoming', label: 'القادمة' },
  { value: 'overdue', label: 'المتأخرة' },
  { value: 'unassigned', label: 'غير المعيّنة' },
];

/**
 * **التاريخ المقصود** — طلب المالك: «لو قلت عايز أشوف ٢٠ إلى ٣٠ سبتمبر، الأدمن لازم يقدر
 * يحدد هل يقصد الطلبات التي ستُنفذ في الفترة دي، ولا الطلبات التي تم إنشاؤها فيها».
 */
const DATE_FIELDS: { value: string; label: string }[] = [
  { value: 'scheduled_at', label: 'موعد التنفيذ' },
  { value: 'placed_at', label: 'تاريخ الطلب' },
  { value: 'completed_at', label: 'تاريخ الإكمال' },
];

const QUICK_STATUSES: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'searching_technician', label: ORDER_STATUS_LABELS.searching_technician },
  { value: 'in_progress', label: ORDER_STATUS_LABELS.in_progress },
  { value: 'completed', label: ORDER_STATUS_LABELS.completed },
  { value: 'disputed', label: ORDER_STATUS_LABELS.disputed },
];

const ORIGIN_FILTERS: { value: 'all' | 'false' | 'true'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'false', label: 'عادية' },
  { value: 'true', label: 'متكررة' },
];

interface OrdersSummary {
  total: number;
  today: number;
  in_progress: number;
  overdue: number;
  unassigned: number;
  crew_incomplete: number;
}

interface CalendarDay {
  day: string;
  total: number;
  unassigned: number;
  in_progress: number;
  completed: number;
  overdue: number;
}

// useSearchParams() محتاج Suspense boundary وقت الـ static prerendering — بدونها next build
// بيفشل على /orders (نفس السبب في /login و/security-center).
export default function OrdersPage() {
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

  // docs/08 §63.ب6 — حالة القايمة في الـURL مش في state المكوّن، فالرجوع من تفاصيل طلب
  // بيحافظ على الفلاتر. كل فلتر جديد هنا بيتبع نفس القاعدة.
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const scope = (searchParams.get('scope') ?? 'current') as 'current' | 'completed' | 'all';
  const bucket = searchParams.get('bucket') ?? '';
  const dateField = searchParams.get('date_field') ?? 'scheduled_at';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const statusFilter = (searchParams.get('status') ?? 'all') as OrderStatus | 'all';
  const originFilter = (searchParams.get('origin') ?? 'all') as 'all' | 'false' | 'true';
  const sortView = (searchParams.get('sort') === 'soonest' ? 'soonest' : 'newest') as 'newest' | 'soonest';
  const view = (searchParams.get('view') === 'calendar' ? 'calendar' : 'table') as 'table' | 'calendar';
  const searchTerm = searchParams.get('search') ?? '';

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
  const [error, setError] = useState<string | null>(null);

  /**
   * **نفس الفلاتر للقايمة والملخّص والتقويم** — لو الملخّص قال «٢٧ طلب» والقايمة عرضت ٣١،
   * الأدمن بيفقد الثقة في الشاشة كلها. فالبناء مرة واحدة هنا.
   */
  const filterParams = () => {
    const params = new URLSearchParams({ scope, date_field: dateField });
    if (bucket) params.set('bucket', bucket);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (statusFilter !== 'all') params.set('order_status', statusFilter);
    if (originFilter !== 'all') params.set('recurring', originFilter);
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

    // الملخّص والتقويم **بيفشلوا بهدوء**: هما معلومة مساعدة، ومايصحّش يمنعوا القايمة نفسها.
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
    isLoading, page, scope, bucket, dateField, from, to,
    statusFilter, originFilter, sortView, view, searchTerm, authedFetchPaginated,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  /** نطاق سريع على الحقل المختار — بيكتب `from`/`to` بصيغة تاريخ بس (بلا وقت). */
  const setQuickRange = (days: number) => {
    const today = new Date();
    const start = new Date(today);
    const end = new Date(today);
    end.setDate(end.getDate() + days);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setParams({ from: iso(start), to: iso(end), bucket: null, page: '1' });
  };

  return (
    <AppShell>
      <PageHeader
        title="الطلبات"
        actions={
          hasPermission('orders.create_for_customer') ? (
            <Link href="/orders/create-for-customer">
              <Button>إنشاء طلب نيابة عن عميل</Button>
            </Link>
          ) : undefined
        }
      />

      {/* ═══ الطبقة ١: النطاق — أهم طبقة في الصفحة ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b pb-3">
        {SCOPES.map((s) => (
          <Button
            key={s.value}
            size="sm"
            variant={scope === s.value ? 'default' : 'outline'}
            onClick={() => setParams({ scope: s.value === 'current' ? null : s.value, page: '1' })}
            title={s.hint}
          >
            {s.label}
            {s.value === 'current' && scope === 'current' && summary ? ` ${summary.total}` : ''}
          </Button>
        ))}
        <span className="self-center text-xs text-muted-foreground">
          {SCOPES.find((s) => s.value === scope)?.hint}
        </span>
      </div>

      {/* ═══ الطبقة ٢: اختصارات تشغيلية ═══ */}
      <div className="mb-3 flex flex-wrap gap-2">
        {BUCKETS.map((b) => (
          <Button
            key={b.value}
            size="sm"
            variant={bucket === b.value ? 'secondary' : 'ghost'}
            onClick={() => setParams({ bucket: bucket === b.value ? null : b.value, page: '1' })}
          >
            {b.label}
            {b.value === 'overdue' && summary && summary.overdue > 0 ? ` ${summary.overdue}` : ''}
            {b.value === 'unassigned' && summary && summary.unassigned > 0 ? ` ${summary.unassigned}` : ''}
          </Button>
        ))}
      </div>

      {/* ═══ الطبقة ٣: التاريخ — الحقل الأول، وبعده النطاق ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border p-3">
        <label className="text-sm text-muted-foreground" htmlFor="date-field">
          التاريخ حسب:
        </label>
        <select
          id="date-field"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={dateField}
          onChange={(e) => setParams({ date_field: e.target.value, page: '1' })}
        >
          {DATE_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setQuickRange(0)}>
          اليوم
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setQuickRange(7)}>
          ٧ أيام
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setQuickRange(30)}>
          ٣٠ يوم
        </Button>
        <Input
          type="date"
          value={from}
          onChange={(e) => setParams({ from: e.target.value, page: '1' })}
          className="h-9 w-auto"
          aria-label="من تاريخ"
        />
        <span className="text-sm text-muted-foreground">—</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => setParams({ to: e.target.value, page: '1' })}
          className="h-9 w-auto"
          aria-label="إلى تاريخ"
        />
        {(from || to) && (
          <Button size="sm" variant="ghost" onClick={() => setParams({ from: null, to: null, page: '1' })}>
            مسح التاريخ
          </Button>
        )}
      </div>

      {/* ═══ الطبقة ٤: فلاتر + ترتيب + شكل العرض ═══ */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={statusFilter}
          onChange={(e) => setParams({ status: e.target.value, page: '1' })}
          aria-label="حالة الطلب"
        >
          {QUICK_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={originFilter}
          onChange={(e) => setParams({ origin: e.target.value, page: '1' })}
          aria-label="أصل الطلب"
        >
          {ORIGIN_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={sortView}
          onChange={(e) => setParams({ sort: e.target.value === 'newest' ? null : e.target.value, page: '1' })}
          aria-label="الترتيب"
        >
          <option value="newest">ترتيب: الأحدث طلبًا</option>
          <option value="soonest">ترتيب: الأقرب تنفيذًا</option>
        </select>

        <div className="ms-auto flex gap-1">
          <Button
            size="sm"
            variant={view === 'table' ? 'default' : 'outline'}
            onClick={() => setParams({ view: null })}
          >
            جدول
          </Button>
          <Button
            size="sm"
            variant={view === 'calendar' ? 'default' : 'outline'}
            onClick={() => setParams({ view: 'calendar' })}
          >
            تقويم
          </Button>
        </div>
      </div>

      {/* البحث — بيتبعت للباك-إند (مش فلترة الصفحة الحالية) عشان يلاقي طلب من أي صفحة. */}
      <form
        className="mb-4 flex gap-2"
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
          className="max-w-md"
          aria-label="بحث برقم الطلب، اسم/تليفون العميل أو الفني، أو Payment ID"
        />
        <Button type="submit" size="sm" variant="outline">
          بحث
        </Button>
        {searchTerm && (
          <Button type="button" size="sm" variant="ghost" onClick={() => setParams({ search: null, page: '1' })}>
            مسح البحث
          </Button>
        )}
      </form>

      {/* ═══ شريط الملخّص — بيتحدّث مع نفس الفلاتر السارية ═══ */}
      {summary && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="font-medium">{summary.total} طلب</span>
          <span className="text-muted-foreground">{summary.today} اليوم</span>
          <span className="text-muted-foreground">{summary.in_progress} تحت التنفيذ</span>
          {summary.overdue > 0 && <span className="text-destructive">{summary.overdue} متأخرة</span>}
          {summary.unassigned > 0 && <span className="text-destructive">{summary.unassigned} غير معيّنة</span>}
          {summary.crew_incomplete > 0 && (
            <span className="text-destructive">{summary.crew_incomplete} الطاقم ناقص</span>
          )}
        </div>
      )}

      {error && <p className="text-destructive">{error}</p>}

      {view === 'calendar' ? (
        <CalendarView
          days={calendar}
          onPickDay={(day) => setParams({ from: day, to: day, bucket: null, view: null, page: '1' })}
        />
      ) : (
        <>
          {!error && !orders && <TableSkeleton columns={8} />}
          {orders && orders.length === 0 && (
            <EmptyState title="مفيش طلبات مطابقة" description="جرّب توسّع النطاق أو تمسح فلتر التاريخ" />
          )}

          {orders && orders.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الطلب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>موعد التنفيذ</TableHead>
                    <TableHead>المدة</TableHead>
                    <TableHead>الطاقم</TableHead>
                    <TableHead>الدفع</TableHead>
                    <TableHead>الإجمالي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/orders/${order.id}`} className="block font-medium">
                          {order.order_number}
                        </Link>
                        <Badge
                          variant={order.order_type === 'emergency' ? 'destructive' : 'outline'}
                          className="mt-1"
                        >
                          {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={orderStatusTone(order.order_status)}>
                          {ORDER_STATUS_LABELS[order.order_status]}
                        </StatusChip>
                        <OrderFlags order={order} />
                      </TableCell>
                      <TableCell>
                        {order.scheduled_at ? (
                          <div className="flex flex-col">
                            <span>{new Date(order.scheduled_at).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                            {/* نافذة التنفيذ لما المدة معروفة — أوضح من ساعة البداية وحدها. */}
                            <span className="text-xs text-muted-foreground">
                              {formatExecutionWindow(order.scheduled_at, order.duration_minutes) ??
                                new Date(order.scheduled_at).toLocaleTimeString('ar-EG-u-nu-latn', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  hour12: false,
                                })}
                            </span>
                            <RelativeSchedule order={order} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* **المدة من نفس snapshot الطلب** اللي العميل شافه (ADR-0102). */}
                      <TableCell>
                        {formatWorkDuration(order.duration_minutes, order.estimated_duration_days) ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <CrewCell crew={order.crew ?? null} />
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={paymentStatusTone(order.payment_status)}>
                          {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                        </StatusChip>
                      </TableCell>
                      <TableCell>{formatEgp(order.total_amount_cents)}</TableCell>
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

/**
 * **الوقت النسبي للموعد** — «بعد ساعتين» / «متأخر ٣٥ دقيقة».
 *
 * مكوّن منفصل عن الخلية عشان يحسب الوقت وقت الرندر: القيمة نسبية لـ«دلوقتي»، ولو اتحسبت مرة
 * واحدة مع الصفحة بتفضل تكبر كذب مع الوقت.
 */
function RelativeSchedule({ order }: { order: OrderResponseDto }) {
  const relative = formatRelativeSchedule(order.scheduled_at);
  if (!relative) return null;
  const late = relative.startsWith('متأخر');
  return <span className={late ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>{relative}</span>;
}

/**
 * **علامات المشاكل التشغيلية** (docs/08 §157) — «متأخر / غير معيّن / الفريق ناقص».
 *
 * مبنية على نفس البيانات اللي الباك-إند بيفلتر بيها، فمستحيل تقول «متأخر» وفلتر «المتأخرة»
 * مايرجّعهوش.
 */
function OrderFlags({ order }: { order: OrderResponseDto }) {
  const flags: string[] = [];
  if (!order.technician_id) flags.push('غير معيّن');
  if (order.crew?.isTeamBooking && !order.crew.crewComplete) flags.push('الطاقم ناقص');
  if (flags.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="destructive" className="text-[10px]">
          {flag}
        </Badge>
      ))}
    </div>
  );
}

/**
 * **حِمل التشغيل بالتقويم** (docs/08 §157) — «فين الأيام الفاضية وفين المكدسة».
 *
 * الأرقام جاية **aggregate من السيرفر** لكل يوم، مش محسوبة من صفوف منزّلة للمتصفح.
 *
 * واليوم اللي مفيهوش طلبات مابيرجعش من الـAPI أصلاً — الغياب هو الصفر، فمفيش حاجة تتعرض له.
 * والرقم نفسه ظاهر مش لون بس (طلب المالك: «ومن غير ما نعتمد على اللون فقط؛ الرقم نفسه لازم
 * يكون ظاهر»).
 */
function CalendarView({ days, onPickDay }: { days: CalendarDay[] | null; onPickDay: (day: string) => void }) {
  if (!days) return <TableSkeleton columns={4} />;
  if (days.length === 0) {
    return <EmptyState title="مفيش طلبات في الفترة دي" description="وسّع النطاق أو امسح فلتر التاريخ" />;
  }
  const busiest = Math.max(...days.map((d) => d.total));
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {days.map((day) => (
        <button
          key={day.day}
          type="button"
          onClick={() => onPickDay(day.day)}
          className="flex flex-col items-start gap-1 rounded-md border p-3 text-start transition hover:bg-muted"
        >
          <div className="flex w-full items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {new Date(`${day.day}T00:00:00`).toLocaleDateString('ar-EG-u-nu-latn', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </span>
            <span className="text-lg font-semibold">{day.total}</span>
          </div>
          {/* شريط الحِمل نسبةً لأزحم يوم في الفترة — مساعدة بصرية فوق الرقم، مش بديل له. */}
          <div className="h-1 w-full rounded bg-muted">
            <div
              className="h-1 rounded bg-primary"
              style={{ width: `${busiest > 0 ? Math.round((day.total / busiest) * 100) : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {day.in_progress > 0 && <span>{day.in_progress} تحت التنفيذ</span>}
            {day.unassigned > 0 && <span className="text-destructive">{day.unassigned} غير معيّن</span>}
            {day.overdue > 0 && <span className="text-destructive">{day.overdue} متأخر</span>}
            {day.completed > 0 && <span>{day.completed} مكتمل</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

/** خلية الطاقم في قايمة الطلبات (docs/08 §63.ب5). */
function CrewCell({ crew }: { crew: OrderCrewSummaryDto | null }) {
  if (!crew) return <span className="text-muted-foreground">—</span>;
  if (!crew.leaderTechnicianId) {
    return <Badge variant="outline">لسه محدش أخدها</Badge>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{crew.leaderName ?? 'فني'}</span>
        {crew.isTeamBooking && (
          <Badge variant={crew.crewComplete ? 'secondary' : 'destructive'}>
            {crew.crewComplete ? 'الطاقم كامل' : 'الطاقم ناقص'}
          </Badge>
        )}
      </div>
      {crew.members.length > 0 && (
        <span className="text-xs text-muted-foreground">معاه: {crew.members.map((m) => m.fullName).join('، ')}</span>
      )}
      {crew.isTeamBooking && (
        <span className="text-xs text-muted-foreground">
          {1 + crew.members.length} من {crew.requiredTechnicians + crew.requiredAssistants || 1}
        </span>
      )}
    </div>
  );
}
