'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardStats } from '@baytak/shared-types';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  Megaphone,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAdminLiveRefresh } from '@/lib/admin-realtime-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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

// كارت "يحتاج انتباه" (docs/12، الطلب الأول — "بنود تحتاج تبقى واضحة فورًا" مذكورة صراحة لـAdmin
// Panel) — لون النغمة بيتغيّر لـwarning/danger لو فيه عدد فعلي محتاج تصرّف، وborder-s سميك
// يفرّقه بصريًا عن كروت الإحصائيات العادية جنبه من أول نظرة، من غير ما يحتاج قراءة الرقم نفسه.
function AttentionCard({
  title,
  count,
  description,
  href,
  icon: Icon,
  tone,
}: {
  title: string;
  count: number;
  description?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'warning' | 'danger' | 'success';
}) {
  const isClear = count === 0;
  return (
    <Link
      href={href}
      className={
        'flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/50 ' +
        (isClear ? 'border-s-4 border-s-success' : tone === 'danger' ? 'border-s-4 border-s-danger' : 'border-s-4 border-s-warning')
      }
    >
      <div
        className={
          'flex size-9 shrink-0 items-center justify-center rounded-full ' +
          (isClear ? 'bg-success-bg text-success' : tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning')
        }
      >
        {isClear ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold">{count}</span>
          <span className="text-sm font-medium">{title}</span>
        </div>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default function DashboardPage() {
  const { isLoading, authedFetch } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<DashboardStats>('/admin/dashboard/stats')
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل الإحصائيات'));
  }, [authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    load();
  }, [isLoading, load]);
  // docs/08 §63.ب1 — تحديث حي: الباك-إند بيبثّ الأحداث دي أصلاً، الصفحة كانت بتفوّتها
  // فكانت محتاجة refresh يدوي. الجلب اتحوّل لـuseCallback عشان يتنادى من المكانين.
  useAdminLiveRefresh(['orders','technicians','payments'], load);

  return (
    <AppShell>
      <PageHeader title="نظرة عامة" description="ملخص عمليات اليوم والبنود اللي محتاجة تصرّف من فريق العمليات" />
      {error && <p className="text-destructive">{error}</p>}
      {!error && !stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      {stats && (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">يحتاج انتباه</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <AttentionCard
                title="شكاوى مفتوحة"
                count={stats.complaints_open}
                description="بانتظار رد/حل من فريق الدعم"
                href="/support"
                icon={Megaphone}
                tone="danger"
              />
              <AttentionCard
                title="فنيين بانتظار التحقق"
                count={stats.technicians.pending_verification}
                description="افتح القايمة وفلتر بحالة التحقق (مستندات/مراجعة/مقابلة/اختبار)"
                href="/technicians"
                icon={ShieldCheck}
                tone="warning"
              />
              <AttentionCard
                title="صرف معلّق"
                count={stats.financial.pending_payouts_count}
                description={stats.financial.pending_payouts_count > 0 ? formatEgp(stats.financial.pending_payouts_amount_cents) : undefined}
                href="/payouts"
                icon={Banknote}
                tone="warning"
              />
              <AttentionCard
                title="طلبات اتلغت النهاردة"
                count={stats.orders_today.cancelled}
                description="افتح القايمة وفلتر بحالة الإلغاء (عميل/فني/تلقائي/منتهي)"
                href="/orders"
                icon={XCircle}
                tone="danger"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">أداء اليوم</h2>
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
              <StatCard
                title="متوسط التقييم"
                value={stats.average_rating !== null ? stats.average_rating.toFixed(2) : '—'}
              />
              <StatCard
                title="المستخدمين"
                value={String(stats.users.total)}
                description={`جديد النهاردة: ${stats.users.new_today}`}
              />
            </div>
          </section>

          <section className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>
              بنود زي «طلبات متأخرة» و«تصعيد مساعد» و«موافقات KPI معلّقة» و«تغييرات دور/أمان حديثة» مطلوبة
              كمان في قسم «يحتاج انتباه» حسب مواصفة تحسين UI/UX — دلوقتي محتاجة endpoint تجميع جديد في
              الباك-إند (خارج نطاق هذه المرحلة اللي بتاخد بيانات موجودة بالفعل بس)، فموثّقة هنا كفجوة
              صريحة بدل ما تتجاهل.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
