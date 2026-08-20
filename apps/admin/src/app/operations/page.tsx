'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminServiceCategoryResponseDto, OperationsOverview } from '@baytak/shared-types';
import { AlertTriangle, ClipboardList, Radio, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SelectNative } from '@/components/ui/select-native';
import { Label } from '@/components/ui/label';

function KpiCard({
  title,
  value,
  description,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardDescription>{title}</CardDescription>
            <Icon className="size-4 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </CardHeader>
        {description && (
          <CardContent>
            <p className="text-sm text-muted-foreground">{description}</p>
          </CardContent>
        )}
      </Card>
    </Link>
  );
}

// كارت توزيع القدرة الاستيعابية اليوم — نفس الألوان المعتمدة لمستويات التصنيف في باقي الشاشات
// (LIGHT/MEANINGFUL/HEAVY/BLOCKED)، معروضة كأربع قيم مجاورة بدل رسم بياني كامل — مقياس واحد
// بسيط مايستاهلش مكوّن رسم منفصل (راجع dataviz skill: "هل ده أصلاً رسم بياني؟").
function CapacityTierRow({ label, value, tone }: { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'muted' }) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-muted-foreground';
  return (
    <div className="flex flex-1 flex-col items-center gap-1 rounded-lg border p-3">
      <span className={`text-2xl font-semibold ${toneClass}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default function OperationsOverviewPage() {
  const { isLoading, authedFetch } = useAuth();
  const [categories, setCategories] = useState<AdminServiceCategoryResponseDto[] | null>(null);
  const [categoryId, setCategoryId] = useState<string>('');
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    authedFetch<AdminServiceCategoryResponseDto[]>('/admin/service-categories').then(setCategories).catch(() => undefined);
  }, [isLoading, authedFetch]);

  useEffect(() => {
    if (isLoading) return;
    setOverview(null);
    setError(null);
    const query = categoryId ? `?category_id=${categoryId}` : '';
    authedFetch<OperationsOverview>(`/admin/operations/overview${query}`)
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'حصل خطأ في تحميل نظرة العمليات'));
  }, [isLoading, authedFetch, categoryId]);

  return (
    <AppShell>
      <PageHeader
        title="مركز العمليات"
        description="نظرة تشغيلية لحظية على التوزيع والطاقم والقدرة الاستيعابية — بداية مركز عمليات موسّع (docs/08 §36)"
      />

      <div className="mb-6 flex items-center gap-2">
        <Label htmlFor="ops_category" className="text-sm text-muted-foreground">
          فلترة بالفئة
        </Label>
        <SelectNative id="ops_category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="max-w-xs">
          <option value="">كل الفئات</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_ar}
            </option>
          ))}
        </SelectNative>
      </div>

      {error && <p className="text-destructive">{error}</p>}
      {!error && !overview && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}

      {overview && (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">مؤشرات لحظية</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                title="طلبات محتاجة توزيع"
                value={String(overview.dispatch_pending_count)}
                description="لسه بتدوّر على فني (بيبحث/محتاجة إعادة اختيار)"
                icon={ClipboardList}
                href="/orders"
              />
              <KpiCard
                title="نقص طاقم مفتوح"
                value={String(overview.crew_shortage_open_count)}
                description="طلبات فريق اتصعّدت ولسه ناقصة أعضاء"
                icon={AlertTriangle}
                href="/orders"
              />
              <KpiCard
                title="فنيين أونلاين دلوقتي"
                value={String(overview.technicians_online_count)}
                description="متصلين فعليًا الآن (observability بس، مش شرط أهلية)"
                icon={Radio}
                href="/technicians"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="size-4" />
              توزيع القدرة الاستيعابية اليوم
            </h2>
            <div className="flex flex-wrap gap-3">
              <CapacityTierRow label="خفيف (LIGHT)" value={overview.capacity_today.light} tone="success" />
              <CapacityTierRow label="متوسط (MEANINGFUL)" value={overview.capacity_today.meaningful} tone="muted" />
              <CapacityTierRow label="مشغول (HEAVY)" value={overview.capacity_today.heavy} tone="warning" />
              <CapacityTierRow label="محظور (BLOCKED)" value={overview.capacity_today.blocked} tone="danger" />
            </div>
          </section>

          <section className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>
              دي بداية "مركز العمليات" — بنية أساسية بس (docs/08 §36.2). الأقسام الجاية (مصفوفة القوى العاملة،
              مفتّش المطابقة، تايم لاين، مركز التنبيهات، ذكاء التغطية...) هتتضاف هنا مرحلة بمرحلة فوق نفس الصفحة دي،
              مش صفحات منفصلة متفرقة.
            </p>
          </section>
        </div>
      )}
    </AppShell>
  );
}
