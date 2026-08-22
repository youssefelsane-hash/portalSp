'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AdminCategoryOpsRowDto,
  AdminCityResponseDto,
  AdminServiceCategoryResponseDto,
  AdminServiceZoneResponseDto,
  CoverageRowDto,
  DispatchDeliveryItemDto,
  DispatchDeliveryResponseDto,
  ExceptionCenterResponseDto,
  OperationsOverview,
  TechnicianLevel,
  TechnicianVerificationStatus,
  WorkloadForecastRowDto,
} from '@baytak/shared-types';
import { AlertTriangle, Bell, ChevronDown, ChevronLeft, ClipboardList, Compass, Radio, Send, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TableSkeleton } from '@/components/table-skeleton';
import { EmptyState } from '@/components/empty-state';
import { Pagination } from '@/components/pagination';
import {
  VERIFICATION_STATUS_LABELS,
  LEVEL_LABELS,
  ALL_LEVELS,
  CAPACITY_TIER_LABELS,
  capacityTierBadgeClass,
} from '@/lib/technician-labels';

function KpiCard({
  title,
  value,
  description,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardDescription>{title}</CardDescription>
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </CardHeader>
        {description && (
          <CardContent>
            <p className="text-sm text-muted-foreground">{description}</p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}

// كارت توزيع القدرة الاستيعابية اليوم — نفس الألوان المعتمدة لمستويات التصنيف في باقي الشاشات
// (LIGHT/MEANINGFUL/HEAVY/BLOCKED)، معروضة كأربع قيم مجاورة بدل رسم بياني كامل — مقياس واحد
// بسيط مايستاهلش مكوّن رسم منفصل (راجع dataviz skill: "هل ده أصلاً رسم بياني؟").
function CapacityTierRow({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-muted-foreground';
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-lg border p-3">
      <span className={`text-2xl font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function verificationBadgeVariant(status: AdminCategoryOpsRowDto['verification_status']) {
  if (status === 'approved') return 'secondary' as const;
  if (status === 'rejected' || status === 'suspended') return 'destructive' as const;
  return 'outline' as const;
}

// إعادة تعيين سريعة لصف "توزيع متأخر" (docs/08 §36.11 — تحكم أدمن من مركز العمليات، استهلاك
// أوامر §35.3 الموجودة بالحرف: GET /admin/orders/:id/eligible-technicians +
// POST /admin/orders/:id/reassign، صفر endpoint جديد). نفس الأوامر المستخدمة فعليًا في صفحة
// تفاصيل الطلب (`orders/[id]/page.tsx`)، بس مُتاحة هنا كإجراء سريع بلا ما الأدمن يضطر يفتح
// الطلب لوحده. مبنية كمكوّن فرعي عشان حالة "الفورم مفتوح/مقفول" تفضل مستقلة لكل صف.
function StaleDispatchReassignAction({
  orderId,
  authedFetch,
  onReassigned,
}: {
  orderId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
  onReassigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState<{ technicianId: string; fullName: string }[] | null>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function toggleOpen() {
    setOpen((prev) => !prev);
    setActionError(null);
    if (!eligible) {
      authedFetch<{ zoneId: string; items: { technicianId: string; fullName: string }[] }>(
        `/admin/orders/${orderId}/eligible-technicians`,
      )
        .then(({ items }) => setEligible(items))
        .catch(() => setEligible([]));
    }
  }

  async function handleReassign() {
    if (!technicianId) return;
    setSaving(true);
    setActionError(null);
    try {
      await authedFetch(`/admin/orders/${orderId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ technician_id: technicianId }),
      });
      setOpen(false);
      setTechnicianId('');
      onReassigned();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'حصل خطأ، حاول تاني');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={toggleOpen} className="text-xs text-primary hover:underline">
        {open ? 'إلغاء' : 'إعادة تعيين لفني تاني'}
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {eligible === null ? (
            <span className="text-xs text-muted-foreground">بيحمّل الفنيين المؤهّلين...</span>
          ) : eligible.length === 0 ? (
            <span className="text-xs text-muted-foreground">مفيش فني مؤهّل متاح دلوقتي للطلب ده</span>
          ) : (
            <>
              <SelectNative
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className="h-8 max-w-[220px] text-xs"
              >
                <option value="">اختار فني</option>
                {eligible.map((t) => (
                  <option key={t.technicianId} value={t.technicianId}>
                    {t.fullName}
                  </option>
                ))}
              </SelectNative>
              <button
                type="button"
                onClick={handleReassign}
                disabled={!technicianId || saving}
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                {saving ? 'جاري...' : 'تأكيد'}
              </button>
            </>
          )}
          {actionError && <span className="text-xs text-destructive">{actionError}</span>}
        </div>
      )}
    </div>
  );
}

// مركز الاستثناءات/التنبيهات (docs/08 §36.9) — "فوق تصعيد §35.4 + تنبيهات جديدة". لمحة "محتاج
// تصرّف دلوقتي" (نوعين: نقص طاقم مصعّد + توزيع متأخر)، مش جدول قابل للتصفح — نفس فلسفة كارت
// "يحتاج انتباه" في `/` (apps/admin/src/app/page.tsx)، بس مُركّزة على نطاق العمليات/المطابقة.
// §36.11: صف "توزيع متأخر" فيه كمان إجراء سريع (إعادة تعيين) — راجع StaleDispatchReassignAction
// فوق. صف "نقص طاقم" بيفضل رابط بس (تعديل الطاقم محتاج اختيار دور فني/مساعد، مكانه الطبيعي صفحة
// الطلب نفسها اللي فيها الأداة دي بالفعل — صفر تكرار UI).
function ExceptionCenterSection({
  categoryId,
  authedFetch,
  hasPermission,
}: {
  categoryId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
  hasPermission: ReturnType<typeof useAuth>['hasPermission'];
}) {
  const [data, setData] = useState<ExceptionCenterResponseDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (categoryId) params.set('category_id', categoryId);
    authedFetch<ExceptionCenterResponseDto>(`/admin/operations/exceptions?${params.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل مركز الاستثناءات'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedFetch, categoryId]);

  const crewCount = data?.crew_shortage.total ?? 0;
  const staleCount = data?.stale_dispatch.total ?? 0;
  const totalCount = crewCount + staleCount;

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Bell className="size-4" />
        مركز الاستثناءات/التنبيهات
      </h2>

      {error && <p className="text-destructive">{error}</p>}
      {!error && loading && !data && <Skeleton className="h-24" />}

      {!error && data && totalCount === 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-s-4 border-s-success p-4">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
            <Bell className="size-5" />
          </div>
          <span className="text-sm font-medium">مفيش استثناءات محتاجة تصرّف دلوقتي</span>
        </div>
      )}

      {!error && data && totalCount > 0 && (
        <div className="flex flex-col gap-4">
          {crewCount > 0 && (
            <div className="rounded-lg border border-s-4 border-s-danger p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">نقص طاقم مصعّد ولسه مفتوح ({crewCount})</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {data.crew_shortage.items.map((item) => (
                  <li key={item.order_id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/orders/${item.order_id}`} className="font-medium hover:underline">
                      {item.order_number}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.scheduled_at).toLocaleString('ar-EG-u-nu-latn')}
                    </span>
                    {item.is_overdue && <Badge variant="destructive">فات معاده</Badge>}
                    {item.missing_technicians > 0 && (
                      <span className="text-xs text-muted-foreground">ناقص {item.missing_technicians} فني</span>
                    )}
                    {item.missing_assistants > 0 && (
                      <span className="text-xs text-muted-foreground">ناقص {item.missing_assistants} مساعد</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {staleCount > 0 && (
            <div className="rounded-lg border border-s-4 border-s-warning p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">توزيع متأخر — لسه «مُرسل» بعد ما فات معاده ({staleCount})</span>
              </div>
              <ul className="flex flex-col gap-2">
                {data.stale_dispatch.items.map((item) => (
                  <li key={item.assignment_id} className="flex flex-col gap-1 border-b pb-2 text-sm last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${item.order_id}`} className="font-medium hover:underline">
                        عرض الطلب
                      </Link>
                      <Link href={`/technicians/${item.technician_id}`} className="hover:underline">
                        {item.full_name}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        فات معاده: {new Date(item.expires_at).toLocaleString('ar-EG-u-nu-latn')}
                      </span>
                    </div>
                    {hasPermission('orders.reassign') && (
                      <StaleDispatchReassignAction orderId={item.order_id} authedFetch={authedFetch} onReassigned={refresh} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const MATRIX_PER_PAGE = 20;

// مصفوفة القوى العاملة (docs/08 §36.3) — مدينة→نطاق→فئة→فني. صفر منطق تصنيف/أهلية جديد هنا:
// نفس endpoint مركز عمليات الفئة (§35.9، AdminTechnicianCategoryOpsService) بفلتر zone_id
// إضافي بس. الفئة مشتركة مع فلتر الصفحة الرئيسي فوق (نفس القيمة، حالة واحدة) — النطاق فرعي
// تحته (مدينة→نطاق cascading، نفس نمط apps/admin/src/app/geo/page.tsx).
function WorkforceMatrixSection({
  categoryId,
  authedFetch,
  authedFetchPaginated,
}: {
  categoryId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
  authedFetchPaginated: ReturnType<typeof useAuth>['authedFetchPaginated'];
}) {
  const [cities, setCities] = useState<AdminCityResponseDto[] | null>(null);
  const [cityId, setCityId] = useState<string>('');
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [zoneId, setZoneId] = useState<string>('');
  // بحث/فلترة شاملة (docs/08 §36.12) — الاتنين قابلين للجمع مع فلاتر المدينة/النطاق/الفئة فوق،
  // مش بديل ليهم. q مُعاد استخدامها من ILIKE بسيط مضاف حديثًا في AdminTechnicianCategoryOpsService
  // (اسم/كود الفني)، صفر محرك بحث جديد.
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [verificationStatus, setVerificationStatus] = useState<TechnicianVerificationStatus | ''>('');
  const [level, setLevel] = useState<TechnicianLevel | ''>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminCategoryOpsRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<AdminCityResponseDto[]>('/admin/cities').then(setCities).catch(() => undefined);
  }, [authedFetch]);

  useEffect(() => {
    setZoneId('');
    if (!cityId) {
      setZones(null);
      return;
    }
    authedFetch<AdminServiceZoneResponseDto[]>(`/admin/service-zones?city_id=${cityId}`)
      .then(setZones)
      .catch(() => undefined);
  }, [authedFetch, cityId]);

  // ديبونس بسيط لمربّع البحث — نداء واحد بعد ما الأدمن يوقف الكتابة، مش نداء لكل حرف.
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 400);
    return () => clearTimeout(timer);
  }, [qInput]);

  useEffect(() => {
    setPage(1);
  }, [categoryId, zoneId, q, verificationStatus, level]);

  useEffect(() => {
    if (!categoryId) {
      setItems(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ category_id: categoryId, page: String(page), per_page: String(MATRIX_PER_PAGE) });
    if (zoneId) params.set('zone_id', zoneId);
    if (q) params.set('q', q);
    if (verificationStatus) params.set('verification_status', verificationStatus);
    if (level) params.set('level', level);
    authedFetchPaginated<AdminCategoryOpsRowDto>(`/admin/technicians/by-category?${params.toString()}`)
      .then(({ items: rows, meta }) => {
        setItems(rows);
        setTotal(meta.total ?? rows.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل مصفوفة القوى العاملة'))
      .finally(() => setLoading(false));
  }, [authedFetchPaginated, categoryId, zoneId, q, verificationStatus, level, page]);

  const totalPages = Math.max(1, Math.ceil(total / MATRIX_PER_PAGE));

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">مصفوفة القوى العاملة (مدينة → نطاق → فئة → فني)</h2>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="matrix_city" className="text-sm text-muted-foreground">
            المدينة
          </Label>
          <SelectNative id="matrix_city" value={cityId} onChange={(e) => setCityId(e.target.value)} className="max-w-xs">
            <option value="">كل المدن</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="matrix_zone" className="text-sm text-muted-foreground">
            النطاق
          </Label>
          <SelectNative
            id="matrix_zone"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            disabled={!cityId}
            className="max-w-xs"
          >
            <option value="">{cityId ? 'كل نطاقات المدينة' : 'اختر مدينة الأول'}</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="matrix_q" className="text-sm text-muted-foreground">
            بحث
          </Label>
          <Input
            id="matrix_q"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="اسم الفني أو الكود"
            className="max-w-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="matrix_verification" className="text-sm text-muted-foreground">
            الاعتماد
          </Label>
          <SelectNative
            id="matrix_verification"
            value={verificationStatus}
            onChange={(e) => setVerificationStatus(e.target.value as TechnicianVerificationStatus | '')}
            className="max-w-xs"
          >
            <option value="">كل حالات الاعتماد</option>
            {(Object.keys(VERIFICATION_STATUS_LABELS) as TechnicianVerificationStatus[]).map((s) => (
              <option key={s} value={s}>
                {VERIFICATION_STATUS_LABELS[s]}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="matrix_level" className="text-sm text-muted-foreground">
            المستوى
          </Label>
          <SelectNative
            id="matrix_level"
            value={level}
            onChange={(e) => setLevel(e.target.value as TechnicianLevel | '')}
            className="max-w-xs"
          >
            <option value="">كل المستويات</option>
            {ALL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABELS[l]}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {!categoryId && (
        <EmptyState title="اختر فئة من فلتر الصفحة فوق" description="مصفوفة القوى العاملة محتاجة فئة محددة عشان تعرض الفنيين المؤهّلين لها." />
      )}

      {categoryId && error && <p className="text-destructive">{error}</p>}

      {categoryId && !error && loading && <TableSkeleton rows={5} columns={7} />}

      {categoryId && !error && !loading && items && items.length === 0 && (
        <EmptyState title="مفيش فنيين" description="مفيش فني معتمد للفئة/النطاق المختارين دلوقتي." />
      )}

      {categoryId && !error && !loading && items && items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفني</TableHead>
                <TableHead>الاعتماد</TableHead>
                <TableHead>المستوى</TableHead>
                <TableHead>القدرة النهاردة</TableHead>
                <TableHead>حالة الاتصال</TableHead>
                <TableHead>نطاقات/فئات</TableHead>
                <TableHead>طلبات مفتوحة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/technicians/${row.id}`} className="font-medium hover:underline">
                      {row.full_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{row.technician_code}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={verificationBadgeVariant(row.verification_status)}>
                      {VERIFICATION_STATUS_LABELS[row.verification_status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{LEVEL_LABELS[row.current_level]}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={capacityTierBadgeClass(row.capacity_tier_today)}>
                      {CAPACITY_TIER_LABELS[row.capacity_tier_today]}
                    </Badge>
                    {row.working_now && <span className="ms-1 text-xs text-muted-foreground">(شغال دلوقتي)</span>}
                  </TableCell>
                  <TableCell>
                    <span className={row.online ? 'text-success' : 'text-muted-foreground'}>{row.online ? 'أونلاين' : 'أوفلاين'}</span>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className={row.has_zone_issue ? 'text-danger' : undefined}>{row.zone_count} نطاق</span>
                    {' · '}
                    <span className={row.has_category_issue ? 'text-danger' : undefined}>{row.category_count} فئة</span>
                  </TableCell>
                  <TableCell>{row.open_requests_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="فني" onPageChange={setPage} />
        </>
      )}
    </section>
  );
}

const WORKLOAD_PER_PAGE = 15;

function formatDayLabel(dateStr: string, offset: number): string {
  if (offset === 0) return 'النهاردة';
  if (offset === 1) return 'بكرة';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

// عرض الحمل القريب — 7 أيام (docs/08 §36.4). صفر تصنيف موازي جديد: نفس شارات/ألوان
// CapacityTierBadgeClass/CAPACITY_TIER_LABELS المستخدمة فعلاً في مصفوفة القوى العاملة فوق (لغة
// بصرية موحّدة، تمهيدًا لـ§36.14). "متعدد الأيام" علامة بصرية بس على يوم بداية الشغلانة — راجع
// تعليق admin-workload-forecast.service.ts للسبب (محرك المطابقة الحالي مابيعملش date-range
// spanning فعليًا، فالشاشة دي بتعكس بالظبط قرار المحرك مش تخترع تصنيف تاني).
function NearFutureWorkloadSection({
  categoryId,
  authedFetch,
  authedFetchPaginated,
}: {
  categoryId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
  authedFetchPaginated: ReturnType<typeof useAuth>['authedFetchPaginated'];
}) {
  const [cities, setCities] = useState<AdminCityResponseDto[] | null>(null);
  const [cityId, setCityId] = useState<string>('');
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [zoneId, setZoneId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WorkloadForecastRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<AdminCityResponseDto[]>('/admin/cities').then(setCities).catch(() => undefined);
  }, [authedFetch]);

  useEffect(() => {
    setZoneId('');
    if (!cityId) {
      setZones(null);
      return;
    }
    authedFetch<AdminServiceZoneResponseDto[]>(`/admin/service-zones?city_id=${cityId}`)
      .then(setZones)
      .catch(() => undefined);
  }, [authedFetch, cityId]);

  useEffect(() => {
    setPage(1);
  }, [categoryId, zoneId]);

  useEffect(() => {
    if (!categoryId) {
      setItems(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ category_id: categoryId, page: String(page), per_page: String(WORKLOAD_PER_PAGE) });
    if (zoneId) params.set('zone_id', zoneId);
    authedFetchPaginated<WorkloadForecastRowDto>(`/admin/operations/workload-forecast?${params.toString()}`)
      .then(({ items: rows, meta }) => {
        setItems(rows);
        setTotal(meta.total ?? rows.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل عرض الحمل القريب'))
      .finally(() => setLoading(false));
  }, [authedFetchPaginated, categoryId, zoneId, page]);

  const totalPages = Math.max(1, Math.ceil(total / WORKLOAD_PER_PAGE));

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">عرض الحمل القريب (7 أيام)</h2>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="workload_city" className="text-sm text-muted-foreground">
            المدينة
          </Label>
          <SelectNative id="workload_city" value={cityId} onChange={(e) => setCityId(e.target.value)} className="max-w-xs">
            <option value="">كل المدن</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="workload_zone" className="text-sm text-muted-foreground">
            النطاق
          </Label>
          <SelectNative
            id="workload_zone"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            disabled={!cityId}
            className="max-w-xs"
          >
            <option value="">{cityId ? 'كل نطاقات المدينة' : 'اختر مدينة الأول'}</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {!categoryId && (
        <EmptyState title="اختر فئة من فلتر الصفحة فوق" description="عرض الحمل القريب محتاج فئة محددة عشان يعرض الفنيين المؤهّلين لها." />
      )}

      {categoryId && error && <p className="text-destructive">{error}</p>}

      {categoryId && !error && loading && <TableSkeleton rows={5} columns={8} />}

      {categoryId && !error && !loading && items && items.length === 0 && (
        <EmptyState title="مفيش فنيين" description="مفيش فني معتمد للفئة/النطاق المختارين دلوقتي." />
      )}

      {categoryId && !error && !loading && items && items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفني</TableHead>
                {items[0].days.map((d, i) => (
                  <TableHead key={d.date}>{formatDayLabel(d.date, i)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link href={`/technicians/${row.id}`} className="font-medium hover:underline">
                      {row.full_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{row.technician_code}</div>
                  </TableCell>
                  {row.days.map((d) => (
                    <TableCell key={d.date}>
                      <Badge variant="outline" className={capacityTierBadgeClass(d.tier)}>
                        {CAPACITY_TIER_LABELS[d.tier]}
                      </Badge>
                      {d.is_multi_day && <div className="mt-1 text-[10px] text-muted-foreground">متعدد الأيام</div>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="فني" onPageChange={setPage} />
        </>
      )}
    </section>
  );
}

const DELIVERY_PER_PAGE = 15;
const DELIVERY_HOURS_OPTIONS = [1, 6, 24, 72, 168] as const;

const DELIVERY_KIND_LABELS: Record<string, string> = {
  assignment: 'تعيين مباشر',
  work_opportunity_assignment: 'فرصة تولّي طلب',
  work_opportunity_crew_recruit: 'تجنيد فريق',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: 'مُرسل',
  viewed: 'تمت المشاهدة',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  timeout: 'انتهت المهلة',
  cancelled: 'ملغي',
  offered: 'معروض',
  declined: 'مرفوض',
  closed: 'مُغلق',
};

function deliveryKindLabel(item: DispatchDeliveryItemDto): string {
  if (item.kind === 'assignment') return DELIVERY_KIND_LABELS.assignment;
  return item.context === 'crew_recruit' ? DELIVERY_KIND_LABELS.work_opportunity_crew_recruit : DELIVERY_KIND_LABELS.work_opportunity_assignment;
}

function deliveryStatusBadgeClass(status: string): string {
  if (['accepted'].includes(status)) return 'border-success/40 bg-success/10 text-success';
  if (['rejected', 'declined', 'timeout', 'cancelled'].includes(status)) return 'border-danger/40 bg-danger/10 text-danger';
  if (['viewed'].includes(status)) return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

// مراقبة تسليم الطلبات — REQ SENT + حالات حقيقية بس (docs/08 §36.7). صفر حالة توصيل مخترعة: بيعرض
// order_assignments (البث المباشر لكل جولة) وtechnician_work_opportunities (فرص الشغل الإضافي/
// تجنيد الفريق) الحقيقيين زي ما همّ، مع stale_sent_count المُستنتج مباشرة من expires_at الحقيقي
// (مش عتبة وقت تعسفية). بعكس الأقسام فوق، الفئة هنا اختيارية (فلتر الصفحة الرئيسي)، مش شرط.
function DispatchDeliverySection({
  categoryId,
  authedFetch,
}: {
  categoryId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
}) {
  const [cities, setCities] = useState<AdminCityResponseDto[] | null>(null);
  const [cityId, setCityId] = useState<string>('');
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [zoneId, setZoneId] = useState<string>('');
  const [hours, setHours] = useState<number>(24);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DispatchDeliveryResponseDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<AdminCityResponseDto[]>('/admin/cities').then(setCities).catch(() => undefined);
  }, [authedFetch]);

  useEffect(() => {
    setZoneId('');
    if (!cityId) {
      setZones(null);
      return;
    }
    authedFetch<AdminServiceZoneResponseDto[]>(`/admin/service-zones?city_id=${cityId}`)
      .then(setZones)
      .catch(() => undefined);
  }, [authedFetch, cityId]);

  useEffect(() => {
    setPage(1);
  }, [categoryId, zoneId, hours]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ hours: String(hours), page: String(page), per_page: String(DELIVERY_PER_PAGE) });
    if (categoryId) params.set('category_id', categoryId);
    if (zoneId) params.set('zone_id', zoneId);
    authedFetch<DispatchDeliveryResponseDto>(`/admin/operations/dispatch-delivery?${params.toString()}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل مراقبة تسليم الطلبات'))
      .finally(() => setLoading(false));
  }, [authedFetch, categoryId, zoneId, hours, page]);

  const totalPages = Math.max(1, Math.ceil((data?.feed.meta.total ?? 0) / DELIVERY_PER_PAGE));

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Send className="size-4" />
        مراقبة تسليم الطلبات
      </h2>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="delivery_city" className="text-sm text-muted-foreground">
            المدينة
          </Label>
          <SelectNative id="delivery_city" value={cityId} onChange={(e) => setCityId(e.target.value)} className="max-w-xs">
            <option value="">كل المدن</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="delivery_zone" className="text-sm text-muted-foreground">
            النطاق
          </Label>
          <SelectNative
            id="delivery_zone"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            disabled={!cityId}
            className="max-w-xs"
          >
            <option value="">{cityId ? 'كل نطاقات المدينة' : 'اختر مدينة الأول'}</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="delivery_hours" className="text-sm text-muted-foreground">
            النافذة الزمنية
          </Label>
          <SelectNative id="delivery_hours" value={String(hours)} onChange={(e) => setHours(Number(e.target.value))} className="max-w-xs">
            {DELIVERY_HOURS_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h < 24 ? `آخر ${h} ساعة` : `آخر ${h / 24} يوم`}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      {!error && loading && !data && <TableSkeleton rows={5} columns={6} />}

      {!error && data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <CapacityTierRow label="مُرسل" value={data.summary.assignments.sent} tone="muted" />
            <CapacityTierRow label="تمت المشاهدة" value={data.summary.assignments.viewed} tone="muted" />
            <CapacityTierRow label="مقبول" value={data.summary.assignments.accepted} tone="success" />
            <CapacityTierRow label="مرفوض" value={data.summary.assignments.rejected} tone="danger" />
            <CapacityTierRow label="انتهت المهلة" value={data.summary.assignments.timeout} tone="warning" />
            <CapacityTierRow label="ملغي" value={data.summary.assignments.cancelled} tone="muted" />
            <CapacityTierRow label="مُرسل متأخر" value={data.summary.assignments.stale_sent_count} tone="danger" />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <CapacityTierRow label="فرص شغل معروضة" value={data.summary.work_opportunities.offered} tone="muted" />
            <CapacityTierRow label="فرص مقبولة" value={data.summary.work_opportunities.accepted} tone="success" />
            <CapacityTierRow label="فرص مرفوضة" value={data.summary.work_opportunities.declined} tone="danger" />
            <CapacityTierRow label="فرص مُغلقة" value={data.summary.work_opportunities.closed} tone="muted" />
          </div>

          {data.feed.items.length === 0 && (
            <EmptyState title="مفيش تسليمات في النافذة الزمنية دي" description="جرّب توسيع النافذة الزمنية أو تغيير الفلاتر." />
          )}

          {data.feed.items.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>النوع</TableHead>
                    <TableHead>الفني</TableHead>
                    <TableHead>الطلب</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>اتبعت</TableHead>
                    <TableHead>اترد عليه</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.feed.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-sm">{deliveryKindLabel(item)}</TableCell>
                      <TableCell>
                        <Link href={`/technicians/${item.technician_id}`} className="font-medium hover:underline">
                          {item.full_name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{item.technician_code}</div>
                      </TableCell>
                      <TableCell>
                        <Link href={`/orders/${item.order_id}`} className="hover:underline">
                          عرض الطلب
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={deliveryStatusBadgeClass(item.status)}>
                          {DELIVERY_STATUS_LABELS[item.status] ?? item.status}
                        </Badge>
                        {item.is_stale && <div className="mt-1 text-[10px] text-danger">متأخر عن معاده</div>}
                      </TableCell>
                      <TableCell className="text-xs">{new Date(item.sent_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                      <TableCell className="text-xs">
                        {item.responded_at ? new Date(item.responded_at).toLocaleString('ar-EG-u-nu-latn') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={page} totalPages={totalPages} total={data.feed.meta.total} itemLabel="تسليمة" onPageChange={setPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}

const COVERAGE_PER_PAGE = 20;

const COVERAGE_STATUS_LABELS: Record<string, string> = {
  critical: 'حرج',
  tight: 'ضيّق',
  healthy: 'سليم',
};

function coverageStatusBadgeClass(status: string): string {
  if (status === 'critical') return 'border-danger/40 bg-danger/10 text-danger';
  if (status === 'tight') return 'border-warning/40 bg-warning/10 text-warning';
  return 'border-success/40 bg-success/10 text-success';
}

// درج قابل للتوسيع (docs/08 §36.12) — بيفتح تحت صف "ذكاء التغطية" ويعرض قايمة الفنيين الفعليين
// وراء الأرقام المجمّعة (العرض) لنفس زوج (منطقة، فئة)، بإعادة استخدام endpoint مصفوفة القوى
// العاملة (§36.3، AdminTechnicianCategoryOpsService) بنفس الفلاتر — صفر استعلام جديد.
function CoverageRowDrawer({
  categoryId,
  zoneId,
  authedFetchPaginated,
}: {
  categoryId: string;
  zoneId: string;
  authedFetchPaginated: ReturnType<typeof useAuth>['authedFetchPaginated'];
}) {
  const [items, setItems] = useState<AdminCategoryOpsRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ category_id: categoryId, zone_id: zoneId, per_page: '10' });
    authedFetchPaginated<AdminCategoryOpsRowDto>(`/admin/technicians/by-category?${params.toString()}`)
      .then(({ items: rows }) => setItems(rows))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الفنيين'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="p-3 text-xs text-destructive">{error}</p>;
  if (!items) return <p className="p-3 text-xs text-muted-foreground">بيحمّل الفنيين...</p>;
  if (items.length === 0) return <p className="p-3 text-xs text-muted-foreground">مفيش فنيين مسجّلين فعليًا للزوج ده.</p>;

  return (
    <ul className="flex flex-col gap-1.5 p-3">
      {items.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
          <Link href={`/technicians/${t.id}`} className="font-medium hover:underline">
            {t.full_name}
          </Link>
          <span className="text-muted-foreground">{t.technician_code}</span>
          <Badge variant="outline" className={capacityTierBadgeClass(t.capacity_tier_today)}>
            {CAPACITY_TIER_LABELS[t.capacity_tier_today]}
          </Badge>
          <span className={t.online ? 'text-success' : 'text-muted-foreground'}>{t.online ? 'أونلاين' : 'أوفلاين'}</span>
        </li>
      ))}
    </ul>
  );
}

// ذكاء تغطية القوى العاملة — فئة+منطقة (docs/08 §36.10). صف لكل زوج (منطقة، فئة) بيجمع العرض
// (فنيين LIGHT/MEANINGFUL متاحين) والطلب (طلبات لسه بتدوّر) — صفر أزواج مصفّاة، حتى زوج بصفر فني
// ولسه فيه طلبات بتدوّر (أخطر حالة) بيظهر. الفئة اختيارية هنا (بعكس §36.3/§36.4) — الهدف مسح شامل.
function CoverageIntelligenceSection({
  categoryId,
  authedFetch,
  authedFetchPaginated,
}: {
  categoryId: string;
  authedFetch: ReturnType<typeof useAuth>['authedFetch'];
  authedFetchPaginated: ReturnType<typeof useAuth>['authedFetchPaginated'];
}) {
  const [cities, setCities] = useState<AdminCityResponseDto[] | null>(null);
  const [cityId, setCityId] = useState<string>('');
  const [zones, setZones] = useState<AdminServiceZoneResponseDto[] | null>(null);
  const [zoneId, setZoneId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CoverageRowDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // درج قابل للتوسيع (docs/08 §36.12) — صف واحد مفتوح في نفس اللحظة، بمفتاح "zone_id-category_id".
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<AdminCityResponseDto[]>('/admin/cities').then(setCities).catch(() => undefined);
  }, [authedFetch]);

  useEffect(() => {
    setZoneId('');
    if (!cityId) {
      setZones(null);
      return;
    }
    authedFetch<AdminServiceZoneResponseDto[]>(`/admin/service-zones?city_id=${cityId}`)
      .then(setZones)
      .catch(() => undefined);
  }, [authedFetch, cityId]);

  useEffect(() => {
    setPage(1);
  }, [categoryId, zoneId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), per_page: String(COVERAGE_PER_PAGE) });
    if (categoryId) params.set('category_id', categoryId);
    if (zoneId) params.set('zone_id', zoneId);
    authedFetchPaginated<CoverageRowDto>(`/admin/operations/coverage?${params.toString()}`)
      .then(({ items: rows, meta }) => {
        setItems(rows);
        setTotal(meta.total ?? rows.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل ذكاء تغطية القوى العاملة'))
      .finally(() => setLoading(false));
  }, [authedFetchPaginated, categoryId, zoneId, page]);

  const totalPages = Math.max(1, Math.ceil(total / COVERAGE_PER_PAGE));

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Compass className="size-4" />
        ذكاء تغطية القوى العاملة (منطقة × فئة)
      </h2>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="coverage_city" className="text-sm text-muted-foreground">
            المدينة
          </Label>
          <SelectNative id="coverage_city" value={cityId} onChange={(e) => setCityId(e.target.value)} className="max-w-xs">
            <option value="">كل المدن</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="coverage_zone" className="text-sm text-muted-foreground">
            النطاق
          </Label>
          <SelectNative
            id="coverage_zone"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            disabled={!cityId}
            className="max-w-xs"
          >
            <option value="">{cityId ? 'كل نطاقات المدينة' : 'اختر مدينة الأول'}</option>
            {zones?.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name_ar}
              </option>
            ))}
          </SelectNative>
        </div>
      </div>

      {error && <p className="text-destructive">{error}</p>}

      {!error && loading && !items && <TableSkeleton rows={5} columns={7} />}

      {!error && !loading && items && items.length === 0 && (
        <EmptyState title="مفيش بيانات تغطية" description="مفيش فنيين مسجّلين أو طلبات بتدوّر لأي منطقة/فئة دلوقتي." />
      )}

      {!error && !loading && items && items.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>المنطقة</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>فنيين متاحين اليوم</TableHead>
                <TableHead>إجمالي فنيين مسجّلين</TableHead>
                <TableHead>طلبات بتدوّر</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => {
                const key = `${row.zone_id}-${row.category_id}`;
                const isExpanded = expandedKey === key;
                return (
                  <Fragment key={key}>
                    <TableRow
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronLeft className="size-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{row.zone_name}</TableCell>
                      <TableCell>{row.category_name}</TableCell>
                      <TableCell>
                        {row.technicians_light + row.technicians_meaningful}
                        <span className="ms-1 text-xs text-muted-foreground">
                          (خفيف {row.technicians_light} · متوسط {row.technicians_meaningful})
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{row.technicians_total}</TableCell>
                      <TableCell>{row.dispatch_pending_count}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={coverageStatusBadgeClass(row.coverage_status)}>
                          {COVERAGE_STATUS_LABELS[row.coverage_status] ?? row.coverage_status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-accent/20 p-0">
                          <CoverageRowDrawer categoryId={row.category_id} zoneId={row.zone_id} authedFetchPaginated={authedFetchPaginated} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="زوج منطقة/فئة" onPageChange={setPage} />
        </>
      )}
    </section>
  );
}

export default function OperationsOverviewPage() {
  const { isLoading, authedFetch, authedFetchPaginated, hasPermission } = useAuth();
  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<AdminServiceCategoryResponseDto[]>('/admin/service-categories').then(setCategories).catch(() => undefined);
  }, [isLoading, authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    setOverview(null);
    setError(null);
    const query = categoryId ? `?category_id=${categoryId}` : '';
    authedFetch<OperationsOverview>(`/admin/operations/overview${query}`)
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل نظرة العمليات'));
  }, [isLoading, authedFetch, categoryId]);

  return (
    <AppShell>
      <PageHeader
        title="مركز العمليات"
        description="نظرة تشغيلية لحظية على التوزيع والطاقم والقدرة الاستيعابية — بداية مركز عمليات موسّع (docs/08 §36)"
      />

      <div className="mb-6 flex items-center gap-2">
        <Label htmlFor="ops_category" className="text-sm text-muted-foreground">
          فلترة بالفئة
        </Label>
        <SelectNative id="ops_category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-xs">
          <option value="">كل الفئات</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_ar}
            </option>
          ))}
        </SelectNative>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !overview && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {overview && (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">مؤشرات لحظية</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="طلبات محتاجة توزيع"
                value={String(overview.dispatch_pending_count)}
                description="لسه بتدوّر على فني (بيبحث/محتاجة إعادة اختيار)"
                icon={ClipboardList}
                href="/orders"
              />
              <KpiCard
                title="نقص طاقم مفتوح"
                value={String(overview.crew_shortage_open_count)}
                description="طلبات فريق اتصعّدت ولسه ناقصة أعضاء"
                icon={AlertTriangle}
                href="/orders"
              />
              <KpiCard
                title="فنيين أونلاين دلوقتي"
                value={String(overview.technicians_online_count)}
                description="متصلين فعليًا الآن (observability بس، مش شرط أهلية)"
                icon={Radio}
                href="/technicians"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="size-4" />
              توزيع القدرة الاستيعابية اليوم
            </h2>
            <div className="flex flex-wrap gap-3">
              <CapacityTierRow label="خفيف (LIGHT)" value={overview.capacity_today.light} tone="success" />
              <CapacityTierRow label="متوسط (MEANINGFUL)" value={overview.capacity_today.meaningful} tone="muted" />
              <CapacityTierRow label="مشغول (HEAVY)" value={overview.capacity_today.heavy} tone="warning" />
              <CapacityTierRow label="محظور (BLOCKED)" value={overview.capacity_today.blocked} tone="danger" />
            </div>
          </section>

          <ExceptionCenterSection categoryId={categoryId} authedFetch={authedFetch} hasPermission={hasPermission} />

          <WorkforceMatrixSection categoryId={categoryId} authedFetch={authedFetch} authedFetchPaginated={authedFetchPaginated} />

          <NearFutureWorkloadSection categoryId={categoryId} authedFetch={authedFetch} authedFetchPaginated={authedFetchPaginated} />

          <DispatchDeliverySection categoryId={categoryId} authedFetch={authedFetch} />

          <CoverageIntelligenceSection categoryId={categoryId} authedFetch={authedFetch} authedFetchPaginated={authedFetchPaginated} />
        </div>
      )}
    </AppShell>
  );
}
