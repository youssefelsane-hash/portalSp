'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchCategories } from '@/lib/catalog';
import { ServiceCategoryDto } from '@/lib/api-types';

// Script 3 §2/§3/§5 — أول شاشة، بتقود بوصف المشكلة مش بسؤال تشغيلي (فرد/فريق) — مطابقة تمامًا
// لـHomeScreen في customer-app (apps/customer-app/lib/features/catalog/home_screen.dart)، نفس
// الـAPIs بالضبط (§59: مفيش محرك اكتشاف خدمة منفصل للويب).

// خلفية hero دوّارة (طلب مالك صريح 2026-08-22، مبني على تصميم مرجعي — Angi.com). الشكل بس، صفر
// تغيير على منطق البحث/الفئات تحت. **مؤقتة عمدًا**: لسه مفيش صور فوتوغرافية حقيقية للفنيين في
// الشغل في المشروع (اتفحص — مفيش أي أصل صورة في apps/customer-web/public غير أيقونة التطبيق)،
// فبدلها تدرّجات لونية بهوية العلامة (--primary وتوابعها) + نمط نقطي خفيف عشان الخلفية متبقاش
// مسطّحة. لما الصور الحقيقية تتجهّز، استبدال المصفوفة دي بروابط الصور الفعلية كفاية — الكاروسيل
// والتلاشي (fade) جاهزين بالفعل.
const HERO_SLIDES = [
  { background: 'linear-gradient(135deg, #1c3a6e 0%, #2f5aa6 55%, #4d78c4 100%)' },
  { background: 'linear-gradient(135deg, #0f1115 0%, #22314f 45%, #2f5aa6 100%)' },
  { background: 'linear-gradient(135deg, #24476e 0%, #3d62a6 50%, #6f93c9 100%)' },
];

const HERO_SLIDE_DURATION_MS = 6000;

// نمط نقطي خفيف جدًا (data URI، صفر طلب شبكة إضافي) — نفس فلسفة placeholderSvgDataUri في
// apps/api/src/modules/branding/branding-defaults.ts (أصل مضمّن في الكود، مش ملف خارجي).
const HERO_PATTERN =
  "url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuMiIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjA5Ii8+PC9zdmc+\")";

export default function HomePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<ServiceCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setError('تعذّر تحميل الفئات — حاول تاني'));
  }, []);

  useEffect(() => {
    if (HERO_SLIDES.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((current) => (current + 1) % HERO_SLIDES.length);
    }, HERO_SLIDE_DURATION_MS);
    return () => clearInterval(timer);
  }, []);

  const featured = categories?.filter((c) => c.is_featured) ?? [];

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div>
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="absolute inset-0">
          {HERO_SLIDES.map((slide, i) => (
            <div
              key={i}
              className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
              style={{ background: slide.background, backgroundImage: `${HERO_PATTERN}, ${slide.background}`, opacity: i === activeSlide ? 1 : 0 }}
            />
          ))}
          {/* تدرّج غامق أسفل الصورة لضمان وضوح النص/الفورم فوقها في أي slide */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="mx-auto max-w-xl rounded-2xl bg-black/35 p-6 text-center text-white shadow-xl backdrop-blur-sm sm:p-8">
            <p className="text-sm font-medium text-white/80">أساعدك إزاي؟</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">محتاج مساعدة في إيه؟</h1>
            <p className="mt-2 text-sm text-white/80 sm:text-base">قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت</p>

            <form onSubmit={submitSearch} className="mt-6">
              <div className="flex items-center gap-2 rounded-xl bg-surface p-2 shadow-sm">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder='وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"'
                  className="flex-1 bg-transparent px-3 py-2 text-foreground outline-none"
                  autoFocus
                />
                <button type="submit" className="rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground hover:opacity-90">
                  بحث
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-4 pb-10">
        {featured.length > 0 && (
          <div className="mt-10">
            <h2 className="mb-4 text-lg font-semibold">الأكثر طلبًا</h2>
            <div className="flex flex-wrap gap-x-6 gap-y-4">
              {featured.map((c) => (
                <Link
                  key={c.id}
                  href={`/categories/${c.id}`}
                  className="group flex w-20 flex-col items-center gap-2 text-center"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-variant transition-colors group-hover:bg-primary/10">
                    {c.icon_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.icon_url} alt="" className="h-8 w-8 object-contain" />
                    ) : (
                      <span className="text-lg font-semibold text-primary">{c.name_ar.charAt(0)}</span>
                    )}
                  </span>
                  <span className="text-xs font-medium leading-tight text-foreground group-hover:text-primary">{c.name_ar}</span>
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
    </div>
  );
}
