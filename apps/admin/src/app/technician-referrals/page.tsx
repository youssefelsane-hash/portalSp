'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { TechnicianReferralBonusResponseDto, TechnicianReferralBonusStatus } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { SelectNative } from '@/components/ui/select-native';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const STATUS_LABELS_AR: Record<TechnicianReferralBonusStatus, string> = {
  credited: 'مستحقة',
  revoked: 'ملغاة',
  rejected_suspicious: 'مرفوضة (مشبوهة)',
};

const STATUS_BADGE_VARIANT: Record<TechnicianReferralBonusStatus, 'default' | 'destructive' | 'outline'> = {
  credited: 'default',
  revoked: 'outline',
  rejected_suspicious: 'destructive',
};

function formatEgp(cents: number) {
  return `${(cents / 100).toFixed(0)} ج.م.`;
}

// نظرة عامة إدارية على ترشيح QR الفني (docs/11 §1) — كانت مؤجّلة عمدًا كـbacklog بند 39.
export default function TechnicianReferralsPage() {
  const { isLoading, authedFetchPaginated } = useAuth();
  const [bonuses, setBonuses] = useState<TechnicianReferralBonusResponseDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    const params = new URLSearchParams({ per_page: '50' });
    if (statusFilter) params.set('status', statusFilter);
    authedFetchPaginated<TechnicianReferralBonusResponseDto>(`/admin/technician-referrals?${params.toString()}`)
      .then((res) => {
        setBonuses(res.items);
        setTotal(res.meta.total ?? res.items.length);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل بيانات الترشيح'));
  }

  useEffect(() => {
    if (isLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, statusFilter]);

  const totals = (bonuses ?? []).reduce(
    (acc, b) => {
      if (b.status === 'credited') acc.credited += b.bonus_amount_cents;
      if (b.status === 'revoked') acc.revoked += b.bonus_amount_cents;
      if (b.status === 'rejected_suspicious') acc.rejected += b.bonus_amount_cents;
      return acc;
    },
    { credited: 0, revoked: 0, rejected: 0 },
  );

  return (
    <AppShell>
      <PageHeader title="ترشيح QR الفني" actions={<p className="text-sm text-muted-foreground">{total} سجل</p>} />
      {error && <p className="mb-4 text-destructive">{error}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي مستحقة (هذه الصفحة)</p>
            <p className="text-lg font-semibold">{formatEgp(totals.credited)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي ملغاة</p>
            <p className="text-lg font-semibold">{formatEgp(totals.revoked)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">إجمالي مرفوضة (مشبوهة)</p>
            <p className="text-lg font-semibold">{formatEgp(totals.rejected)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">سجل المكافآت</CardTitle>
          <SelectNative value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-48">
            <option value="">كل الحالات</option>
            <option value="credited">مستحقة</option>
            <option value="revoked">ملغاة</option>
            <option value="rejected_suspicious">مرفوضة (مشبوهة)</option>
          </SelectNative>
        </CardHeader>
        <CardContent>
          {!bonuses ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : bonuses.length === 0 ? (
            <EmptyState title="مفيش سجلات بالفلتر ده" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفني</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الطلب</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bonuses.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/technicians/${b.technician_id}`} className="underline-offset-2 hover:underline">
                        {b.technician_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/customers/${b.customer_user_id}`} className="underline-offset-2 hover:underline">
                        {b.customer_user_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/orders/${b.order_id}`} className="underline-offset-2 hover:underline">
                        {b.order_id.slice(0, 8)}…
                      </Link>
                    </TableCell>
                    <TableCell>{formatEgp(b.bonus_amount_cents)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE_VARIANT[b.status]}>{STATUS_LABELS_AR[b.status]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm text-muted-foreground">
                      {b.rejection_reason ?? b.revoked_reason ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{b.created_at.slice(0, 10)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
