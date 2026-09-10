'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchServices } from '@/lib/catalog';
import { ServiceDto } from '@/lib/api-types';
import { formatEgp } from '@/lib/orders';
import { useCatalogZone } from '@/lib/catalog-zone';

function SearchResults() {
  const catalogZone = useCatalogZone();
  const params = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ServiceDto[] | null>(null);
  const [searched, setSearched] = useState(initialQuery.trim().length >= 2);
  const [resultContextKey, setResultContextKey] = useState<string | null>(null);

  useEffect(() => {
    if (!catalogZone.isReady) return;
    if (!catalogZone.canLoadCatalog) return;
    if (initialQuery.trim().length >= 2) {
      const contextKey = `${catalogZone.zoneId ?? 'public'}:${initialQuery.trim()}`;
      searchServices(initialQuery, catalogZone.zoneId ?? undefined).then(setResults)
        .then(() => setResultContextKey(contextKey))
        // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
        .catch((err: unknown) => console.error('فشل تحميل بيانات', err));
    }
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId, initialQuery]);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearched(true);
    if (!catalogZone.canLoadCatalog) {
      return;
    }
    const contextKey = `${catalogZone.zoneId ?? 'public'}:${query.trim()}`;
    searchServices(query, catalogZone.zoneId ?? undefined).then(setResults)
      .then(() => setResultContextKey(contextKey))
      // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
      .catch((err: unknown) => console.error('فشل تحميل بيانات', err));
  }

  const activeContextKey = `${catalogZone.zoneId ?? 'public'}:${query.trim()}`;
  const visibleResults = catalogZone.canLoadCatalog && resultContextKey === activeContextKey ? results : null;
  const catalogUnavailable = catalogZone.isReady && !catalogZone.canLoadCatalog;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <form onSubmit={runSearch} className="flex items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="قول لينا محتاج مساعدة في إيه..."
          className="flex-1 bg-transparent px-3 py-2 outline-none"
          autoFocus
        />
        <button type="submit" className="rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground hover:opacity-90">
          بحث
        </button>
      </form>

      <div className="mt-6">
        {catalogUnavailable ? (
          <p className="text-center text-danger">أضف عنوانًا داخل منطقة خدمة عشان نعرض لك الخدمات المتاحة</p>
        ) : !searched ? (
          <p className="text-center text-muted">اكتب وصف مشكلتك (زي: &quot;المياه بتنزل من تحت الحوض&quot;)</p>
        ) : visibleResults === null ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-variant" />
            ))}
          </div>
        ) : visibleResults.length === 0 ? (
          <p className="text-center text-muted">مفيش خدمات مطابقة — جرّب توصيف مختلف أو تصفّح الفئات من الرئيسية</p>
        ) : (
          <div className="space-y-3">
            {visibleResults.map((s) => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 hover:border-primary"
              >
                <div className="flex items-center gap-4">
                  {s.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- صور خدمات خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
                    <img
                      src={s.icon_url}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="h-14 w-14 shrink-0 rounded-lg bg-surface-variant object-cover"
                    />
                  ) : (
                    <div className="h-14 w-14 shrink-0 rounded-lg bg-surface-variant" />
                  )}
                  <div>
                    <p className="font-medium">{s.name_ar}</p>
                    {s.short_description_ar && <p className="text-sm text-muted">{s.short_description_ar}</p>}
                  </div>
                </div>
                <span className="shrink-0 font-semibold text-primary">
                  {s.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(s.base_price_cents)}
                </span>
              </Link>
            ))}
          </div>
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
