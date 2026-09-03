'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminRecurringPlanResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { BOOKING_MODE_LABELS, RECURRING_FREQUENCY_LABELS } from '@/lib/order-labels';

const PER_PAGE = 20;

// خطط الحجز المتكرر (migration 0176) — الصفحة دي بتعرض **تعريف التكرار نفسه**: مين/إيه/فين/
// إزاي بيتكرر، والموعد الجاي وآخر حجز اتولّد وحالة الفشل. الطلبات المتولّدة نفسها مش هنا —
// بتتشاف من صفحة /orders العادية بفلتر "متكررة" وبتتصرف زي أي طلب عادي بالحرف (نفس التفاصيل/
// الأدوات/التتبع). أي حجز متولّد بيرجع لخطته من خلال recurring_template_id على الطلب.
export default function RecurringOrdersPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [plans, setPlans] = useState<AdminRecurringPlanResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (activeFilter !== 'all') params.set('is_active', activeFilter);
    authedFetchPaginated<AdminRecurringPlanResponseDto>(`/admin/recurring-orders?${params.toString()}`)
      .then(({ items, meta }) => {
        setPlans(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل خطط الحجز المتكرر'));
  }, [page, activeFilter, authedFetchPaginated]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['recurring','orders'], load);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="الحجوزات المتكررة (الخطط)" />

      <p className="mb-4 text-sm text-muted-foreground">
        التعريفات اللي بتولّد طلبات عادية تلقائيًا كل موعد — الطلبات نفسها في{' '}
        <Link href="/orders" className="underline">
          صفحة الطلبات
        </Link>{' '}
        (فلتر &quot;متكررة&quot;).
      </p>

      <div className="mb-4 flex gap-2">
        {(['all', 'true', 'false'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={activeFilter === value ? 'default' : 'outline'}
            onClick={() => {
              setActiveFilter(value);
              setPage(1);
            }}
          >
            {value === 'all' ? 'الكل' : value === 'true' ? 'نشطة' : 'موقوفة'}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !plans && <TableSkeleton columns={8} />}
      {plans && plans.length === 0 && <EmptyState title="مفيش خطط متكررة مطابقة" />}

      {plans && plans.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>العنوان</TableHead>
                <TableHead>التكرار</TableHead>
                <TableHead>الدفع</TableHead>
                <TableHead>الموعد الجاي</TableHead>
                <TableHead>آخر حجز</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الفشل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="text-sm">{plan.customer_full_name}</div>
                    <div dir="ltr" className="font-mono text-xs text-muted-foreground">
                      {plan.customer_phone}
                    </div>
                  </TableCell>
                  <TableCell>{plan.service_name_ar}</TableCell>
                  <TableCell>
                    {plan.address_label ?? <span className="text-muted-foreground">—</span>}
                    {/* انتماء العمارة (migration 0257، docs/08 §125) — بيفضل مربوط بالطلب المتكرر
                        مش الطلب الأول بس، فالأدمن لازم يشوفه هنا عشان يعرف ليه خصم النوبات بتتغيّر
                        مع تغيير نسبة العمارة من صفحة العمائر. */}
                    {plan.building_code && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        عمارة: {plan.building_name_ar ?? plan.building_code}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {RECURRING_FREQUENCY_LABELS[plan.frequency] ?? plan.frequency}
                    <div className="text-xs text-muted-foreground">
                      {BOOKING_MODE_LABELS[plan.booking_mode] ?? plan.booking_mode}
                    </div>
                  </TableCell>
                  <TableCell>
                    {plan.payment_method ? (
                      <Badge variant="outline">{plan.payment_method === 'card' ? 'مقدّم (كارت)' : 'مقدّم (InstaPay)'}</Badge>
                    ) : (
                      <span className="text-muted-foreground">بعد الشغل</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(plan.next_run_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                  <TableCell>
                    {plan.last_generated_order_id ? (
                      <Link href={`/orders/${plan.last_generated_order_id}`} className="underline">
                        {plan.last_order_number ?? 'عرض الطلب'}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">لسه مفيش</span>
                    )}
                    {plan.last_occurrence_at && (
                      <div className="text-xs text-muted-foreground">
                        {new Date(plan.last_occurrence_at).toLocaleString('ar-EG-u-nu-latn')}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {plan.cancelled_at ? (
                      <Badge variant="outline">اتلغت</Badge>
                    ) : (
                      <Badge variant={plan.is_active ? 'secondary' : 'outline'}>{plan.is_active ? 'نشطة' : 'موقوفة'}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {plan.last_failure_reason ? (
                      <Badge variant="destructive" title={plan.last_failure_reason}>
                        فشل ({plan.consecutive_failure_count}/3) — {new Date(plan.last_failed_at!).toLocaleString('ar-EG-u-nu-latn')}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="خطة" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
