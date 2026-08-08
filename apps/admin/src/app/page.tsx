'use client';

import { useEffect, useState } from 'react';
import type { DashboardStats } from '@baytak/shared-types';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Topbar } from '@/components/topbar';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { formatEgp } from '@/lib/format';

function StatCard({ title, value, description }: { title: string; value: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      {description && (
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { isLoading, authedFetch } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<DashboardStats>('/admin/dashboard/stats')
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإحصائيات'));
  }, [isLoading, authedFetch]);

  return (
    <div className="flex flex-1 flex-col">
      <Topbar />
      <main className="flex-1 p-6">
        <h1 className="mb-6 text-xl font-semibold">نظرة عامة</h1>
        {error && <p className="text-destructive">{error}</p>}
        {!error && !stats && <p className="text-muted-foreground">جاري التحميل…</p>}
        {stats && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="طلبات النهاردة"
              value={String(stats.orders_today.total)}
              description={`مكتملة: ${stats.orders_today.completed} · نشطة: ${stats.orders_today.active} · ملغاة: ${stats.orders_today.cancelled}`}
            />
            <StatCard title="إيراد النهاردة" value={formatEgp(stats.revenue_today_cents)} />
            <StatCard title="عمولة المنصة النهاردة" value={formatEgp(stats.platform_commission_today_cents)} />
            <StatCard
              title="الفنيين"
              value={String(stats.technicians.approved)}
              description={`قيد التحقق: ${stats.technicians.pending_verification} · متاح دلوقتي: ${stats.technicians.available_now}`}
            />
            <StatCard title="شكاوى مفتوحة" value={String(stats.complaints_open)} />
            <StatCard
              title="متوسط التقييم"
              value={stats.average_rating !== null ? stats.average_rating.toFixed(2) : '—'}
            />
            <StatCard
              title="المستخدمين"
              value={String(stats.users.total)}
              description={`جديد النهاردة: ${stats.users.new_today}`}
            />
            <StatCard
              title="صرف معلّق"
              value={String(stats.financial.pending_payouts_count)}
              description={formatEgp(stats.financial.pending_payouts_amount_cents)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
