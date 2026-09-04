'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchServices } from '@/lib/catalog';
import { ServiceDto } from '@/lib/api-types';
import { formatEgp } from '@/lib/orders';

function SearchResults() {
  const params = useSearchParams();
  const initialQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ServiceDto[] | null>(null);
  const [searched, setSearched] = useState(initialQuery.trim().length >= 2);

  useEffect(() => {
    if (initialQuery.trim().length >= 2) {
      searchServices(initialQuery).then(setResults)
        // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
        .catch((err: unknown) => console.error('فشل تحميل بيانات', err));
    }
    // مقصود مرة واحدة بس مع query الأولي من الرابط.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearched(true);
    searchServices(query).then(setResults)
      // نفس القاعدة: الرفض يتسجّل بدل ما يضيع في صمت (docs/08 §133).
      .catch((err: unknown) => console.error('فشل تحميل بيانات', err));
  }

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
        {!searched ? (
          <p className="text-center text-muted">اكتب وصف مشكلتك (زي: &quot;المياه بتنزل من تحت الحوض&quot;)</p>
        ) : results === null ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-variant" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <p className="text-center text-muted">مفيش خدمات مطابقة — جرّب توصيف مختلف أو تصفّح الفئات من الرئيسية</p>
        ) : (
          <div className="space-y-3">
            {results.map((s) => (
              <Link
                key={s.id}
                href={`/services/${s.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 hover:border-primary"
              >
                <div className="flex items-center gap-4">
                  {s.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- صور خدمات خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
                    <img src={s.icon_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
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
