'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchCategories } from '@/lib/catalog';
import { ServiceCategoryDto } from '@/lib/api-types';

// Script 3 §2/§3/§5 — أول شاشة، بتقود بوصف المشكلة مش بسؤال تشغيلي (فرد/فريق) — مطابقة تمامًا
// لـHomeScreen في customer-app (apps/customer-app/lib/features/catalog/home_screen.dart)، نفس
// الـAPIs بالضبط (§59: مفيش محرك اكتشاف خدمة منفصل للويب).
export default function HomePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<ServiceCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setError('تعذّر تحميل الفئات — حاول تاني'));
  }, []);

  const featured = categories?.filter((c) => c.is_featured) ?? [];

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-center text-3xl font-bold">محتاج مساعدة في إيه؟</h1>
      <p className="mt-2 text-center text-muted">قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت</p>

      <form onSubmit={submitSearch} className="mx-auto mt-8 max-w-2xl">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface p-2 shadow-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"'
            className="flex-1 bg-transparent px-3 py-2 outline-none"
            autoFocus
          />
          <button type="submit" className="rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground hover:opacity-90">
            بحث
          </button>
        </div>
      </form>

      {featured.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">الأكثر طلبًا</h2>
          <div className="flex flex-wrap gap-2">
            {featured.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.id}`}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm hover:border-primary hover:text-primary"
              >
                {c.name_ar}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">كل الفئات</h2>
        {error ? (
          <p className="text-danger">{error}</p>
        ) : categories === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-variant" />
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="text-muted">مفيش فئات خدمات متاحة دلوقتي</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/categories/${c.id}`}
                className="flex h-24 items-center justify-center rounded-xl border border-border bg-surface p-3 text-center font-medium hover:border-primary hover:text-primary"
              >
                {c.name_ar}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
