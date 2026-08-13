'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminRecurringTemplateResponseDto } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
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

// وضوح الطلبات المتكررة للتشغيل (docs/08 §32) — كانت فجوة موثّقة صراحة: القوالب المتكررة
// (`recurring_order_templates`) بتولّد طلبات حقيقية كل موعد من غير أي مسار أدمن يشوفها خالص —
// مفيش طريقة يتابع بيها فريق العمليات قالب معطوب (`next_run_at` بيتحرّك قدّام حتى لو التوليد فشل).
export default function RecurringOrdersPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [templates, setTemplates] = useState<AdminRecurringTemplateResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (activeFilter !== 'all') params.set('is_active', activeFilter);
    authedFetchPaginated<AdminRecurringTemplateResponseDto>(`/admin/recurring-orders?${params.toString()}`)
      .then(({ items, meta }) => {
        setTemplates(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الطلبات المتكررة'));
  }, [isLoading, page, activeFilter, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="الطلبات المتكررة" />

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
      {!error && !templates && <TableSkeleton columns={7} />}
      {templates && templates.length === 0 && <EmptyState title="مفيش قوالب متكررة مطابقة" />}

      {templates && templates.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>الخدمة</TableHead>
                <TableHead>التكرار</TableHead>
                <TableHead>وضع الحجز</TableHead>
                <TableHead>الموعد الجاي</TableHead>
                <TableHead>آخر طلب اتولّد</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell dir="ltr" className="font-mono text-xs">
                    {template.customer_id}
                  </TableCell>
                  <TableCell dir="ltr" className="font-mono text-xs">
                    {template.service_id}
                  </TableCell>
                  <TableCell>{RECURRING_FREQUENCY_LABELS[template.frequency] ?? template.frequency}</TableCell>
                  <TableCell>{BOOKING_MODE_LABELS[template.booking_mode] ?? template.booking_mode}</TableCell>
                  <TableCell>{new Date(template.next_run_at).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                  <TableCell>
                    {template.last_generated_order_id ? (
                      <Link href={`/orders/${template.last_generated_order_id}`} className="underline">
                        عرض الطلب
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">لسه مفيش</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.is_active ? 'secondary' : 'outline'}>
                      {template.is_active ? 'نشط' : 'موقوف'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="قالب" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
