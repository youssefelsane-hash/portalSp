'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats } from '@baytak/shared-types';
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  CircleDollarSign,
  Clock3,
  HandCoins,
  Megaphone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Star,
  TrendingUp,
  UserRoundCheck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LiveValue } from '@/components/live-value';
import { formatEgp } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-muted text-muted-foreground',
};

function StatCard({ title, value, description, icon: Icon, tone = 'primary' }: {
  title: string;
  value: string;
  description?: string;
  icon: LucideIcon;
  tone?: Tone;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-primary via-primary/50 to-transparent" />
      <CardHeader className="flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardDescription>{title}</CardDescription>
          <CardTitle className="mt-2 text-2xl"><LiveValue value={value} /></CardTitle>
        </div>
        <span className={cn('flex size-10 items-center justify-center rounded-xl', TONE_CLASSES[tone])}>
          <Icon className="size-5" />
        </span>
      </CardHeader>
      {description && <CardContent className="pt-0"><p className="text-xs leading-5 text-muted-foreground">{description}</p></CardContent>}
    </Card>
  );
}

function AttentionCard({ title, count, description, href, icon: Icon, tone }: {
  title: string;
  count: number;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: 'warning' | 'danger';
}) {
  const isClear = count === 0;
  return (
    <Link
      href={href}
      className={cn(
        'group flex min-h-28 items-start gap-3 rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md',
        !isClear && tone === 'danger' && 'border-s-4 border-s-danger',
        !isClear && tone === 'warning' && 'border-s-4 border-s-warning',
      )}
    >
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TONE_CLASSES[isClear ? 'success' : tone])}>
        {isClear ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <LiveValue value={count} className="text-2xl font-semibold" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{isClear ? 'لا توجد حالات معلّقة حاليًا' : description}</p>
      </div>
      <ChevronLeft className="mt-3 size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-1" />
    </Link>
  );
}

function TrendPanel({ stats }: { stats: DashboardStats }) {
  const maxOrders = Math.max(1, ...stats.trend_7_days.map((day) => day.orders_count));
  const maxRevenue = Math.max(1, ...stats.trend_7_days.map((day) => day.revenue_cents));
  const weekOrders = stats.trend_7_days.reduce((sum, day) => sum + day.orders_count, 0);
  const weekRevenue = stats.trend_7_days.reduce((sum, day) => sum + day.revenue_cents, 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">حركة الطلبات خلال 7 أيام</CardTitle>
            <CardDescription>إجمالي {weekOrders} طلب، واللون الأخضر هو المكتمل</CardDescription>
          </div>
          <BarChart3 className="size-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="flex h-44 items-end gap-2" dir="ltr">
            {stats.trend_7_days.map((day) => {
              const totalHeight = Math.max(5, (day.orders_count / maxOrders) * 100);
              const completedHeight = day.orders_count > 0 ? (day.completed_count / day.orders_count) * 100 : 0;
              return (
                <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-2 text-center">
                  <div className="relative flex-1">
                    <div
                      className="absolute inset-x-1 bottom-0 overflow-hidden rounded-t-lg bg-primary/18"
                      style={{ height: `${totalHeight}%` }}
                      title={`${day.orders_count} طلب، ${day.completed_count} مكتمل`}
                    >
                      <div className="absolute inset-x-0 bottom-0 bg-success/80" style={{ height: `${completedHeight}%` }} />
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(`${day.date}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle className="text-base">الإيراد المحصّل خلال 7 أيام</CardTitle>
            <CardDescription>{formatEgp(weekRevenue)} إجمالي مدفوع</CardDescription>
          </div>
          <TrendingUp className="size-5 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {stats.trend_7_days.map((day) => {
              const width = Math.max(day.revenue_cents > 0 ? 3 : 0, (day.revenue_cents / maxRevenue) * 100);
              return (
                <div key={day.date} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {new Date(`${day.date}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short' })}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-gradient-to-l from-primary to-info" style={{ width: `${width}%` }} />
                  </div>
                  <span className="min-w-24 text-start font-medium tabular-nums">{formatEgp(day.revenue_cents)}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const { isLoading, authedFetch } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await authedFetch<DashboardStats>('/admin/dashboard/stats');
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإحصائيات');
    } finally {
      setRefreshing(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [isLoading, load]);
  useAdminLiveRefresh(['orders', 'technicians', 'payments'], load);

  return (
    <AppShell>
      <PageHeader
        title="مركز المتابعة"
        description="صورة تشغيلية لحظية تساعد الفريق يبدأ بالأهم بدل التنقل بين الصفحات"
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            تحديث
          </Button>
        }
      />

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-danger/20 bg-danger-bg p-4 text-sm text-danger">
          <AlertTriangle className="size-4" />
          {error}
        </div>
      )}

      {!stats && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-2xl" />)}
        </div>
      )}

      {stats && (
        <div className="flex flex-col gap-8">
          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-semibold">يحتاج تدخّل</h2>
                <p className="text-xs text-muted-foreground">كل كارت يفتح مكان المعالجة مباشرة</p>
              </div>
              <ShieldAlert className="size-5 text-warning" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <AttentionCard title="طلبات متأخرة" count={stats.attention.overdue_orders} description="موعدها عدّى ولسه الفني ما بدأش" href="/operations" icon={Clock3} tone="danger" />
              <AttentionCard title="نقص طاقم" count={stats.attention.crew_shortages} description="طلبات فريق اتصعّدت ولسه الطاقم ناقص" href="/operations" icon={Users} tone="danger" />
              <AttentionCard title="شكاوى مفتوحة" count={stats.complaints_open} description="بانتظار مراجعة أو رد من فريق الدعم" href="/support" icon={Megaphone} tone="danger" />
              <AttentionCard title="نزاعات طلبات" count={stats.attention.disputed_orders} description="طلبات في حالة نزاع وتحتاج قرار" href="/orders" icon={ShieldAlert} tone="danger" />
              <AttentionCard title="استردادات جارية" count={stats.attention.pending_refunds} description="طلبات استرداد لم تصل لحالة نهائية" href="/orders" icon={HandCoins} tone="warning" />
              <AttentionCard title="مطالبات ضمان" count={stats.attention.open_warranty_claims} description="مطالبات مفتوحة أو تحت المراجعة والإصلاح" href="/warranty-claims" icon={ShieldCheck} tone="warning" />
              <AttentionCard title="مراجعات KPI" count={stats.attention.pending_kpi_reviews} description="نتائج محسوبة بانتظار قرار الإدارة" href="/technician-kpi" icon={Star} tone="warning" />
              <AttentionCard title="صرف معلّق" count={stats.financial.pending_payouts_count} description={formatEgp(stats.financial.pending_payouts_amount_cents)} href="/payouts" icon={Banknote} tone="warning" />
              <AttentionCard title="فنيين بانتظار التحقق" count={stats.technicians.pending_verification} description="مستندات أو مراجعة أو مقابلة أو اختبار" href="/technicians" icon={UserRoundCheck} tone="warning" />
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="font-semibold">أداء اليوم</h2>
              <p className="text-xs text-muted-foreground">الأموال هنا للطلبات المدفوعة فعليًا فقط</p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
              <StatCard title="طلبات اليوم" value={String(stats.orders_today.total)} description={`مكتملة ${stats.orders_today.completed} · نشطة ${stats.orders_today.active} · ملغاة ${stats.orders_today.cancelled}`} icon={BarChart3} />
              <StatCard title="إيراد اليوم" value={formatEgp(stats.revenue_today_cents)} icon={CircleDollarSign} tone="success" />
              <StatCard title="عمولة المنصة" value={formatEgp(stats.platform_commission_today_cents)} icon={Banknote} tone="success" />
              <StatCard title="الفنيون المعتمدون" value={String(stats.technicians.approved)} description={`متاحون الآن ${stats.technicians.available_now}`} icon={Wrench} />
              <StatCard title="متوسط التقييم" value={stats.average_rating !== null ? stats.average_rating.toFixed(2) : '—'} icon={Star} tone="warning" />
              <StatCard title="المستخدمون" value={String(stats.users.total)} description={`جدد اليوم ${stats.users.new_today}`} icon={Users} tone="neutral" />
            </div>
          </section>

          <section>
            <div className="mb-3">
              <h2 className="font-semibold">الاتجاه الأسبوعي</h2>
              <p className="text-xs text-muted-foreground">الأيام محسوبة بتوقيت القاهرة لثبات أرقام التشغيل</p>
            </div>
            <TrendPanel stats={stats} />
          </section>
        </div>
      )}
    </AppShell>
  );
}
