'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchServices, searchServices } from '@/lib/catalog';
import { ServiceDto } from '@/lib/api-types';
import { useCatalogZone } from '@/lib/catalog-zone';
import { ServiceCard } from '@/components/catalog/service-card';

/// المهلة بين آخر حرف والطلب اللي بيروح للسيرفر.
///
/// طلب المالك صراحةً (2026-09-11): «نخلي فيه ثانية واحدة بين كل حرف والتاني عشان الموقع
/// ما يسحبش requests كتير… ما يبقاش فيه تهنيج ولا لاج ولا تقطيع».
///
/// المهلة دي **مابتأخّرش اللي المستخدم بيشوفه**: القايمة الكاملة محمّلة أصلاً والفلترة
/// بتحصل محليًا على كل حرف. نفس الرقم ونفس المبدأ بالظبط في
/// `apps/customer-app/lib/features/catalog/search_results_screen.dart`.
const SEARCH_DEBOUNCE_MS = 1000;

/// «كل الخدمات» — **بتعرض كل حاجة من أول ما تفتح**، وبتفلتر مع الكتابة.
///
/// بلاغ المالك (2026-09-11): «لما أدوس على كل الخدمات بيوديني على صفحة البحث… المفروض
/// يعرض كل الخدمات افتراضيًا ويفلتر لما أكتب، عشان البحث يبقى احترافي شوية».
///
/// كان: صفحة فاضية مكتوب فيها «اكتب وصف مشكلتك» لحد ما المستخدم يكتب حرفين ويدوس «بحث».
function SearchResults() {
  const catalogZone = useCatalogZone();
  const params = useSearchParams();
  const initialQuery = params.get('q') ?? '';

  const [query, setQuery] = useState(initialQuery);
  /// القايمة الكاملة — بتتحمّل مرة واحدة وبتفضل أساس الفلترة المحلية.
  const [allServices, setAllServices] = useState<ServiceDto[] | null>(null);
  /// رد السيرفر لآخر استعلام **ومعاه الاستعلام اللي اتعمل عليه**.
  ///
  /// الاستعلام محفوظ جنب النتيجة عمدًا مش في `state` تاني: كده «هل إحنا لسه بندوّر؟» و«هل
  /// النتيجة دي بتاعة اللي مكتوب دلوقتي؟» بيتحسبوا **اشتقاقًا** وقت الرسم، فمفيش `setState`
  /// جوّه جسم الـeffect خالص (قاعدة `react-hooks/set-state-in-effect` مسكت النسخة الأولى).
  /// `items: null` = الطلب فشل — بنرجع للفلترة المحلية بدل ما نفضل «بندوّر» للأبد.
  const [serverHit, setServerHit] = useState<{ query: string; items: ServiceDto[] | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedZoneKey, setLoadedZoneKey] = useState<string | null>(null);

  /// بيمنع رد بطيء لاستعلام قديم إنه يحلّ محل رد أحدث (سباق حقيقي مع مهلة ثانية كاملة).
  const requestSeq = useRef(0);

  const zoneKey = catalogZone.zoneId ?? 'public';

  // ── تحميل القايمة الكاملة ───────────────────────────────────────────────────
  useEffect(() => {
    if (!catalogZone.isReady || !catalogZone.canLoadCatalog) return;
    let cancelled = false;
    fetchServices(undefined, catalogZone.zoneId ?? undefined)
      .then((items) => {
        if (cancelled) return;
        setAllServices(items);
        setError(null);
        setLoadedZoneKey(zoneKey);
      })
      .catch(() => {
        if (cancelled) return;
        // فشل القايمة الكاملة مش لازم يقفل البحث — الكتابة لسه بتشتغل عن طريق السيرفر.
        setAllServices([]);
        setError('تعذّر تحميل الخدمات');
        setLoadedZoneKey(zoneKey);
      });
    return () => {
      cancelled = true;
    };
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId, zoneKey]);

  // ── طلب السيرفر المؤجّل ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!catalogZone.isReady || !catalogZone.canLoadCatalog) return;
    const trimmed = query.trim();
    // أقل من حرفين = فلترة محلية بس، مفيش طلب أصلاً (نفس فحص الباك-إند بالظبط).
    if (trimmed.length < 2) return;
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      searchServices(trimmed, catalogZone.zoneId ?? undefined)
        .then((items) => {
          if (seq !== requestSeq.current) return;
          setServerHit({ query: trimmed, items });
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          setServerHit({ query: trimmed, items: null });
          // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
          console.error('فشل تحميل بيانات', err);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId, query]);

  const catalogCurrent = catalogZone.canLoadCatalog && loadedZoneKey === zoneKey;
  const catalogUnavailable = catalogZone.isReady && !catalogZone.canLoadCatalog;
  const trimmedQuery = query.trim();
  /// رد السيرفر صالح بس لو بتاع اللي مكتوب دلوقتي — أي حرف جديد بيلغيه فورًا في نفس الرسم.
  const currentHit = serverHit?.query === trimmedQuery ? serverHit : null;
  const searching = trimmedQuery.length >= 2 && currentHit === null;

  /// الفلترة المحلية — نفس الحقول اللي الباك-إند بيطابق عليها، ناقص الكلمات المفتاحية
  /// (مش موجودة في عقد `ServiceDto` أصلاً) — وده بالظبط اللي طلب السيرفر بيكمّله.
  const visible = useMemo(() => {
    if (!catalogCurrent) return null;
    if (currentHit?.items) return currentHit.items;
    const all = allServices ?? [];
    const needle = trimmedQuery.toLowerCase();
    if (!needle) return all;
    return all.filter(
      (s) =>
        s.name_ar.toLowerCase().includes(needle) ||
        (s.short_description_ar ?? '').toLowerCase().includes(needle),
    );
  }, [allServices, catalogCurrent, currentHit, trimmedQuery]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-4 text-2xl font-bold">كل الخدمات</h1>

      <div className="relative flex items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm focus-within:border-primary">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="mr-2 shrink-0 text-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="دوّر على خدمة..."
          aria-label="ابحث في الخدمات"
          className="flex-1 bg-transparent px-1 py-2 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="مسح البحث"
            className="shrink-0 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            مسح
          </button>
        )}
      </div>
      {/* شريط رفيع بدل تبديل المحتوى كله بهيكل تحميل — النتايج المحلية ظاهرة بالفعل تحته،
          فتبديلها بهيكل عظمي كان هيبقى «تقطيع» بالظبط زي ما المالك بيوصف. */}
      <div className="mt-1 h-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {searching && <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />}
      </div>

      <div className="mt-5">
        {catalogUnavailable ? (
          <p className="text-center text-danger">أضف عنوانًا داخل منطقة خدمة عشان نعرض لك الخدمات المتاحة</p>
        ) : visible === null ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
                <div className="aspect-[3/1] animate-pulse bg-surface-variant" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-surface-variant" />
                  <div className="h-3 w-full animate-pulse rounded bg-surface-variant" />
                  <div className="h-4 w-24 animate-pulse rounded bg-surface-variant" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center text-muted">
            {error ??
              (trimmedQuery
                ? `مفيش خدمات مطابقة لـ"${trimmedQuery}" — جرّب كلمة تانية`
                : 'مفيش خدمات متاحة في منطقتك دلوقتي')}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {trimmedQuery ? `${visible.length} نتيجة` : `${visible.length} خدمة متاحة`}
            </p>
            <div className="motion-list grid gap-4 sm:grid-cols-2">
              {visible.map((s) => (
                <ServiceCard key={s.id} service={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
