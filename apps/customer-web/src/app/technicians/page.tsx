'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchCategories } from '@/lib/catalog';
import { ServiceCategoryDto } from '@/lib/api-types';
import { TECHNICIAN_LEVEL_LABELS_AR } from '@/lib/technicians';
import { CategoryTile } from '@/components/catalog/category-tile';
import { useCatalogZone } from '@/lib/catalog-zone';

/// «الفنيون» — كان **404** (بلاغ المالك 2026-09-11: الفوتر بيوديني على صفحة مش موجودة).
///
/// ## ليه مش «قايمة كل الفنيين»؟
///
/// لأن دي ميزة **مش موجودة في المنتج أصلاً، ولا على الأندرويد**. الفني الوحيد اللي العميل
/// بيشوفه بيجي من `GET /services/:id/technicians` — وده بيطلب `service_id` **و**`address_id`
/// عشان يحسب المسافة، يفلتر على منطقة الخدمة، ويحسب السعر النهائي بمضاعف مستوى الفني. مفيش
/// أي endpoint عام بيرجّع فنيين من غير الاتنين دول (اتأكدت من كل الـcontrollers).
///
/// يعني «تصفّح كل الفنيين» كان هيبقى **اختراع ميزة** مش سدّ 404، وكان هيخالف طلب المالك إن
/// الأندرويد والويب والـiOS يبقوا نسخة واحدة.
///
/// فالصفحة دي بتعمل اللي المسار الحقيقي بيعمله: بتشرح إزاي الاختيار بيشتغل، وبتوصّل العميل
/// للخطوة الأولى الحقيقية (اختيار الخدمة). مستويات الفنيين المعروضة هي **نفس ثوابت العقد**
/// (`TECHNICIAN_LEVEL_LABELS_AR`) — مش نص تسويقي مكتوب بالإيد ممكن يتعارض مع الباك-إند.
const HOW_IT_WORKS = [
  {
    title: 'اختار الخدمة',
    body: 'كل فني معتمد على خدمات بعينها — فبنبدأ من الشغلانة اللي محتاجها.',
  },
  {
    title: 'حدّد عنوانك',
    body: 'عشان نعرض لك اللي بيغطّي منطقتك فعلاً، بالمسافة والسعر النهائي قبل ما تأكّد.',
  },
  {
    title: 'قارن واختار',
    body: 'التقييم، عدد الشغلانات المكتملة، الالتزام بالمواعيد، والسعر — كلهم قدامك في كارت واحد.',
  },
];

/// ترتيب السلّم من الأدنى للأعلى — نفس ترتيب `TechnicianLevel` في الباك-إند.
const LEVEL_ORDER = ['new', 'verified', 'professional', 'premium', 'team_leader'];

export default function TechniciansPage() {
  const catalogZone = useCatalogZone();
  const [categories, setCategories] = useState<ServiceCategoryDto[] | null>(null);

  useEffect(() => {
    if (!catalogZone.isReady || !catalogZone.canLoadCatalog) return;
    let cancelled = false;
    fetchCategories(catalogZone.zoneId ?? undefined)
      .then((items) => {
        if (!cancelled) setCategories(items.slice(0, 8));
      })
      .catch(() => {
        // الفئات هنا مدخل مساعد مش المحتوى الأساسي — فشلها مايفضّيش الصفحة.
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">الفنيون</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          كل فني على أسطى معتمد على خدمات بعينها وفي مناطق بعينها. عشان كده بنعرض لك الفنيين
          المتاحين <span className="font-medium text-foreground">جوّه الخدمة اللي محتاجها</span> —
          بالسعر النهائي والمسافة والتقييم قبل ما تأكّد أي حاجة.
        </p>
      </header>

      <section className="mb-10" aria-labelledby="how-title">
        <h2 id="how-title" className="mb-4 text-lg font-semibold">
          إزاي بتختار الفني؟
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-border bg-surface p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {index + 1}
              </span>
              <p className="mt-3 font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-10" aria-labelledby="levels-title">
        <h2 id="levels-title" className="mb-2 text-lg font-semibold">
          مستويات الفنيين
        </h2>
        <p className="mb-4 text-sm text-muted">
          المستوى بيتحدّد من سجل شغل حقيقي — عدد الشغلانات المكتملة، التقييمات، والالتزام
          بالمواعيد. وبيظهر على كارت كل فني وقت الاختيار.
        </p>
        <div className="flex flex-wrap gap-2">
          {LEVEL_ORDER.map((level) => (
            <span
              key={level}
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-foreground"
            >
              {TECHNICIAN_LEVEL_LABELS_AR[level] ?? level}
            </span>
          ))}
        </div>
      </section>

      <section aria-labelledby="start-title">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 id="start-title" className="text-lg font-semibold">
            ابدأ من الخدمة
          </h2>
          <Link href="/search" className="text-sm font-medium text-primary hover:underline">
            كل الخدمات
          </Link>
        </div>
        {categories === null ? (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-variant" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
            مفيش فئات متاحة دلوقتي — جرّب{' '}
            <Link href="/search" className="text-primary hover:underline">
              كل الخدمات
            </Link>
            .
          </p>
        ) : (
          <div className="motion-list grid grid-cols-3 gap-3 sm:grid-cols-4">
            {categories.map((c) => (
              <CategoryTile key={c.id} category={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
