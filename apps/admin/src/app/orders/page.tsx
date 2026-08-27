'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import type { OrderCrewSummaryDto, OrderResponseDto, OrderStatus } from '@baytak/shared-types';
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
import { formatEgp } from '@/lib/format';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { useRouter, useSearchParams } from 'next/navigation';

const PER_PAGE = 20;

const QUICK_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'searching_technician', label: ORDER_STATUS_LABELS.searching_technician },
  { value: 'in_progress', label: ORDER_STATUS_LABELS.in_progress },
  { value: 'completed', label: ORDER_STATUS_LABELS.completed },
  { value: 'disputed', label: ORDER_STATUS_LABELS.disputed },
];

// فلتر أصل الطلب (migration 0176) — الطلبات المتولّدة من خطط متكررة بتظهر هنا جنب العادية
// بكل تفاصيلها (نفس الصفحة، نفس التفاصيل، مفيش شاشة طلبات "متكررة" منفصلة مخففة).
const ORIGIN_FILTERS: { value: 'all' | 'false' | 'true'; label: string }[] = [
  { value: 'all', label: 'كل الطلبات' },
  { value: 'false', label: 'عادية' },
  { value: 'true', label: 'متكررة' },
];

// docs/08 §63.ب5 (طلب مالك صريح) — «المفروض يكون فيه جزء للطلبات اللي لسه مطلوبة، اللي هو جزء
// الطلبات الأحدث، وكمان جزء للطلبات اللي معاد تنفيذها أحدث… الكستمر طلبها ممكن من زمن ولكن وقت
// تنفيذها حان خلاص». الترتيبين بيتحسبوا في الباك-إند (admin-orders.service.ts) مش هنا.
const SORT_VIEWS: { value: 'newest' | 'soonest'; label: string; hint: string }[] = [
  { value: 'newest', label: 'الأحدث طلبًا', hint: 'آخر اللي العملاء طلبوه' },
  { value: 'soonest', label: 'تنفيذها قرّب', hint: 'الأقرب في المواعيد' },
];

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
  const { isLoading, authedFetchPaginated, hasPermission } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // docs/08 §63.ب6 — حالة القايمة في الـURL مش في state المكوّن. من غير كده، الرجوع من تفاصيل
  // طلب كان بيرجّعك للقايمة **من أول الأول** (صفحة 1، بلا فلاتر) — نص شكوى "بيوّهني".
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const statusFilter = (searchParams.get('status') ?? 'all') as OrderStatus | 'all';
  const originFilter = (searchParams.get('origin') ?? 'all') as 'all' | 'false' | 'true';
  const sortView = (searchParams.get('sort') === 'soonest' ? 'soonest' : 'newest') as 'newest' | 'soonest';
  // docs/08 §67 — البحث في الـURL زي باقي حالة القايمة، عشان الرجوع من تفاصيل الطلب يحافظ عليه.
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
  const [error, setError] = useState<string | null>(null);

  function loadOrders() {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), sort: sortView });
    if (statusFilter !== 'all') params.set('order_status', statusFilter);
    if (originFilter !== 'all') params.set('recurring', originFilter);
    if (searchTerm.trim()) params.set('search', searchTerm.trim());
    authedFetchPaginated<OrderResponseDto>(`/admin/orders?${params.toString()}`)
      .then(({ items, meta }) => {
        setOrders(items);
        setTotal(meta.total ?? items.length);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلبات'));
  }

  useAdminLiveRefresh(['orders', 'payments'], loadOrders);

  useEffect(() => {
    loadOrders();
    // loadOrders intentionally reads the current filters; realtime callbacks use the latest render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, page, statusFilter, originFilter, sortView, searchTerm, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader
        title="الطلبات"
        actions={
          // Call Center (Script 4 §33-37) — صلاحية مخصصة، مش زرار ظاهر لكل أدمن.
          hasPermission('orders.create_for_customer') ? (
            <Link href="/orders/create-for-customer">
              <Button>إنشاء طلب نيابة عن عميل</Button>
            </Link>
          ) : undefined
        }
      />

      {/* docs/08 §67 — بلاغ المالك: «لما أحب أدور على أي طلب قديم أدور عليه وألاقيه… يبقى معايا
          رقم الطلب وأدور في السيرش ألاقيه بسهولة». البحث بيتبعت للباك-إند (مش فلترة الصفحة
          الحالية) عشان يلاقي طلب من أي صفحة مهما كانت قديمة. */}
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setParams({ search: null, page: '1' })}
          >
            مسح البحث
          </Button>
        )}
      </form>

      {searchTerm && (
        <p className="mb-3 text-sm text-muted-foreground">
          نتايج البحث عن «{searchTerm}» — {total} طلب.
        </p>
      )}

      {/* قسمين واضحين بدل قايمة واحدة (docs/08 §63.ب5) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SORT_VIEWS.map((view) => (
          <Button
            key={view.value}
            size="sm"
            variant={sortView === view.value ? 'default' : 'outline'}
            onClick={() => setParams({ sort: view.value === 'newest' ? null : view.value, page: '1' })}
            title={view.hint}
          >
            {view.label}
          </Button>
        ))}
        <span className="self-center text-xs text-muted-foreground">
          {SORT_VIEWS.find((v) => v.value === sortView)?.hint}
        </span>
      </div>

      <div className="mb-4 flex gap-2">
        {QUICK_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={statusFilter === filter.value ? 'default' : 'outline'}
            onClick={() => setParams({ status: filter.value, page: '1' })}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {/* فلتر أصل الطلب — عادي vs متولّد من خطة متكررة (نفس تصميم الفلاتر السريعة فوق) */}
      <div className="mb-4 flex gap-2">
        {ORIGIN_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={originFilter === filter.value ? 'default' : 'outline'}
            onClick={() => setParams({ origin: filter.value, page: '1' })}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !orders && <TableSkeleton columns={6} />}
      {orders && orders.length === 0 && <EmptyState title="مفيش طلبات مطابقة" />}

      {orders && orders.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الطلب</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>حالة الدفع</TableHead>
                <TableHead>الطاقم</TableHead>
                <TableHead>موعد التنفيذ</TableHead>
                <TableHead>تاريخ الطلب</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link href={`/orders/${order.id}`} className="block">
                      {order.order_number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={order.order_type === 'emergency' ? 'destructive' : 'outline'}>
                      {ORDER_TYPE_LABELS[order.order_type] ?? order.order_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusChip tone={orderStatusTone(order.order_status)}>
                      {ORDER_STATUS_LABELS[order.order_status]}
                    </StatusChip>
                  </TableCell>
                  <TableCell>{formatEgp(order.total_amount_cents)}</TableCell>
                  <TableCell>
                    <StatusChip tone={paymentStatusTone(order.payment_status)}>
                      {PAYMENT_STATUS_LABELS[order.payment_status] ?? order.payment_status}
                    </StatusChip>
                  </TableCell>
                  {/* docs/08 §63.ب5 — «مين اللي أخد الشغلانة دي، ومعاه مين، والفريق كامل ولا لأ» */}
                  <TableCell><CrewCell crew={order.crew ?? null} /></TableCell>
                  <TableCell>
                    {order.scheduled_at
                      ? new Date(order.scheduled_at).toLocaleString('ar-EG-u-nu-latn')
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {order.placed_at ? new Date(order.placed_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="طلب" onPageChange={(p) => setParams({ page: String(p) })} />
        </>
      )}
    </AppShell>
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
        <span className="text-xs text-muted-foreground">
          معاه: {crew.members.map((m) => m.fullName).join('، ')}
        </span>
      )}
      {crew.isTeamBooking && (
        <span className="text-xs text-muted-foreground">
          {1 + crew.members.length} من {crew.requiredTechnicians + crew.requiredAssistants || 1}
        </span>
      )}
    </div>
  );
}
