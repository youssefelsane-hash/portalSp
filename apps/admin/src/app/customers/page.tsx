'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminCustomerResponseDto, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
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
  const [page, setPage] = useState(1);
  const [blockedFilter, setBlockedFilter] = useState<'all' | 'blocked' | 'active'>('all');
  const [phoneSearchInput, setPhoneSearchInput] = useState('');
  const phoneSearch = useDebouncedValue(phoneSearchInput, 400);
  const [error, setError] = useState<string | null>(null);

  // بحث حي كان بيبعت طلب لكل حرف — دلوقتي بيستنى الـuseDebouncedValue فوق (400ms) قبل ما يبعت.
  useEffect(() => {
    setPage(1);
  }, [phoneSearch]);

  useEffect(() => {
    if (isLoading) return;
    const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
    if (blockedFilter !== 'all') params.set('is_blocked', String(blockedFilter === 'blocked'));
    if (phoneSearch.trim()) params.set('phone_number', phoneSearch.trim());
    authedFetchPaginated<AdminCustomerResponseDto>(`/admin/customers?${params.toString()}`)
      .then(({ items, meta }) => {
        setCustomers(items);
        setTotal(meta.total ?? items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل العملاء'));
  }, [isLoading, page, blockedFilter, phoneSearch, authedFetchPaginated]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <AppShell>
      <PageHeader title="العملاء" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {BLOCKED_FILTERS.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={blockedFilter === filter.value ? 'default' : 'outline'}
            onClick={() => {
              setBlockedFilter(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </Button>
        ))}
        <Input
          placeholder="بحث برقم الموبايل"
          value={phoneSearchInput}
          onChange={(e) => setPhoneSearchInput(e.target.value)}
          className="max-w-xs"
          dir="ltr"
        />
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
