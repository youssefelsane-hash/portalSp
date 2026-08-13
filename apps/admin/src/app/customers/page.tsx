'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminCustomerResponseDto, CustomerTier } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
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
  const [phoneSearch, setPhoneSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

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
          value={phoneSearch}
          onChange={(e) => {
            setPhoneSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-xs"
          dir="ltr"
        />
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !customers && <p className="text-muted-foreground">جاري التحميل…</p>}
      {customers && customers.length === 0 && <p className="text-muted-foreground">مفيش عملاء مطابقين</p>}

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

          <div className="mt-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              صفحة {page} من {totalPages} ({total} عميل إجمالاً)
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                السابق
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
