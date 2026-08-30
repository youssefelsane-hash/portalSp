'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminCustomerResponseDto, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useFilteredPage } from '@/lib/use-admin-query';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { TableSkeleton } from '@/components/table-skeleton';
import { Pagination } from '@/components/pagination';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatEgp } from '@/lib/format';

const PER_PAGE = 20;

const TIER_LABELS: Record<CustomerTier, string> = {
  standard: 'عادي',
  silver: 'فضي',
  gold: 'ذهبي',
  vip: 'VIP',
};

const BLOCKED_FILTERS: { value: 'all' | 'blocked' | 'active'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'active', label: 'نشطين' },
  { value: 'blocked', label: 'محظورين' },
];

export default function CustomersPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [customers, setCustomers] = useState<AdminCustomerResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [blockedFilter, setBlockedFilter] = useState<'all' | 'blocked' | 'active'>('all');
  const [phoneSearchInput, setPhoneSearchInput] = useState('');
  // بحث حي كان بيبعت طلب لكل حرف — دلوقتي بيستنى 400ms قبل ما يبعت. الترقيم بيرجع 1 مع أي تغيير
  // فلتر أثناء الرندر نفسه (useFilteredPage) بدل effect كان بيعمل setPage(1) بعد الرندر.
  const phoneSearch = useDebouncedValue(phoneSearchInput, 400);
  const [page, setPage] = useFilteredPage(`${blockedFilter}|${phoneSearch}`);
  const [error, setError] = useState<string | null>(null);


  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (blockedFilter !== 'all') params.set('is_blocked', String(blockedFilter === 'blocked'));
    if (phoneSearch.trim()) params.set('phone_number', phoneSearch.trim());
    authedFetchPaginated<AdminCustomerResponseDto>(`/admin/customers?${params.toString()}`)
      .then(({ items, meta }) => {
        setCustomers(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل العملاء'));
  }, [page, blockedFilter, phoneSearch, authedFetchPaginated]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['orders','payments'], load);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader
        title="العملاء"
        description="ملفات العملاء، حالة الحساب، الإنفاق والمحفظة وسجل الطلبات"
        actions={<Badge variant="outline">{total} عميل</Badge>}
      />

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl border border-border/70 bg-card/90 p-4 shadow-sm">
        <div className="min-w-64 flex-1">
          <label htmlFor="customer_phone_search" className="mb-2 block text-sm font-medium">بحث برقم الموبايل</label>
          <Input
            id="customer_phone_search"
            placeholder="مثال: +2010…"
            value={phoneSearchInput}
            onChange={(e) => setPhoneSearchInput(e.target.value)}
            className="max-w-md"
            dir="ltr"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {BLOCKED_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={blockedFilter === filter.value ? 'default' : 'outline'}
              onClick={() => setBlockedFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !customers && <TableSkeleton columns={6} />}
      {customers && customers.length === 0 && <EmptyState title="مفيش عملاء مطابقين" />}

      {customers && customers.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الموبايل</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead>طلبات مكتملة</TableHead>
                <TableHead>إجمالي الإنفاق</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.user_id}>
                  <TableCell>
                    <Link href={`/customers/${customer.user_id}`} className="block">
                      {customer.full_name}
                    </Link>
                  </TableCell>
                  <TableCell dir="ltr">{customer.phone_number}</TableCell>
                  <TableCell>{TIER_LABELS[customer.customer_tier]}</TableCell>
                  <TableCell>{customer.completed_orders_count}</TableCell>
                  <TableCell>{formatEgp(customer.total_spent_cents)}</TableCell>
                  <TableCell>
                    {customer.is_blocked ? (
                      <Badge variant="destructive">محظور</Badge>
                    ) : (
                      <Badge variant="secondary">نشط</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} total={total} itemLabel="عميل" onPageChange={setPage} />
        </>
      )}
    </AppShell>
  );
}
