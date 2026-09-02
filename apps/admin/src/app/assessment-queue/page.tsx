'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

/** نفس فلاتر الباك-إند بالحرف (`AssessmentQueueFilter`) — مفيش فلتر واجهة ملهوش مقابل. */
const FILTERS = [
  { value: 'photo_review', label: 'مراجعة الصور', hint: 'العميل بعت صور والإدارة لسه ما سعّرتش' },
  { value: 'onsite_assessment', label: 'معاينة موقعية', hint: 'محوّل لمعاين وبيستنى الزيارة' },
  { value: 'awaiting_quote', label: 'انتظار السعر', hint: 'المعاينة خلصت والسعر لسه ما اتحددش' },
  { value: 'awaiting_customer', label: 'انتظار العميل', hint: 'العرض راح للعميل وبيستنى رده' },
  { value: 'above_range', label: 'خارج النطاق', hint: 'سعر الفني عدّى النطاق ومستني قرار الإدارة' },
  { value: 'expired_quote', label: 'عروض منتهية', hint: 'خلصت صلاحيتها ومحتاجة إعادة إصدار' },
] as const;

type QueueFilter = (typeof FILTERS)[number]['value'];

interface AssessmentQueueRow {
  order_id: string;
  order_number: string;
  service_name_ar: string;
  customer_name: string;
  order_status: string;
  price_status: string;
  assessment_type: string | null;
  created_at: string;
  latest_quote_id: string | null;
  latest_quote_status: string | null;
  latest_quote_amount_cents: number | null;
  latest_quote_valid_until: string | null;
}

const PRICE_STATUS_LABELS: Record<string, string> = {
  confirmed: 'مؤكد',
  provisional: 'مبدئي',
  waiting_assessment: 'بيستنى التقييم',
  waiting_quote: 'بيستنى السعر',
  waiting_customer_approval: 'بيستنى موافقة العميل',
  locked: 'مقفول',
};

const QUOTE_STATUS_LABELS: Record<string, string> = {
  pending_admin_review: 'مستني مراجعة الإدارة',
  pending_customer: 'مستني العميل',
  approved: 'معتمد',
  rejected: 'مرفوض',
  expired: 'منتهي',
  superseded: 'اتبدل بعرض أحدث',
};

export default function AssessmentQueuePage() {
  const { isLoading, authedFetch, hasPermission } = useAuth();
  const [filter, setFilter] = useState<QueueFilter>('photo_review');
  const [rows, setRows] = useState<AssessmentQueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      setRows(await authedFetch<AssessmentQueueRow[]>(`/admin/orders/assessment-queue?filter=${filter}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تحميل الطابور');
      setRows([]);
    }
  }, [authedFetch, filter]);

  useEffect(() => {
    if (!isLoading) void load();
  }, [isLoading, load]);

  const active = FILTERS.find((f) => f.value === filter)!;

  return (
    <AppShell>
      <PageHeader
        title="طلبات التقييم"
        description="الطلبات اللي سعرها لسه مش مستقر — من ساعة ما العميل يبعت الصور لحد ما يوافق على السعر."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            variant={f.value === filter ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{active.hint}</p>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {rows === null ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title="مفيش طلبات في الخانة دي" description={active.hint} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الطلب</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>حالة السعر</TableHead>
                <TableHead>نوع التقييم</TableHead>
                <TableHead>آخر عرض</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.order_id}>
                  <TableCell className="font-mono text-xs">{row.order_number}</TableCell>
                  <TableCell>{row.service_name_ar}</TableCell>
                  <TableCell>{row.customer_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{PRICE_STATUS_LABELS[row.price_status] ?? row.price_status}</Badge>
                  </TableCell>
                  <TableCell>
                    {row.assessment_type === 'remote' ? 'بالصور' : row.assessment_type === 'onsite' ? 'في الموقع' : '—'}
                  </TableCell>
                  <TableCell>
                    {row.latest_quote_status ? (
                      <span className="whitespace-nowrap">
                        {formatEgp(row.latest_quote_amount_cents ?? 0)}
                        <span className="ms-2 text-xs text-muted-foreground">
                          {QUOTE_STATUS_LABELS[row.latest_quote_status] ?? row.latest_quote_status}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">لسه مفيش عرض</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* الأفعال نفسها في صفحة الطلب — الطابور بيوجّه ليها مش بينفّذها، عشان
                        مايبقاش فيه مكانين بيعملوا نفس القرار. */}
                    <Link href={`/orders/${row.order_id}`} className="text-sm text-primary underline">
                      فتح الطلب
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!hasPermission('orders.adjust_price') && (
        <p className="mt-4 text-xs text-muted-foreground">
          عندك صلاحية عرض بس — قرارات تعديل السعر والتحويل للمعاينة محتاجة صلاحية «تعديل سعر الطلب».
        </p>
      )}
    </AppShell>
  );
}
