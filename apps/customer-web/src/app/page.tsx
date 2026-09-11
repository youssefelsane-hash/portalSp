'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchCategories, fetchMostRequestedServices } from '@/lib/catalog';
import { fetchHeroBackground, fetchHomepageContent, fetchSupportContact } from '@/lib/settings';
import { HomepageTipDto, ServiceCategoryDto, ServiceDto, SupportContactDto } from '@/lib/api-types';
import { CategoryTile } from '@/components/catalog/category-tile';
import { useCatalogZone } from '@/lib/catalog-zone';

// Script 3 §2/§3/§5 — أول شاشة، بتقود بوصف المشكلة مش بسؤال تشغيلي (فرد/فريق) — مطابقة تمامًا
// لـHomeScreen في customer-app (apps/customer-app/lib/features/catalog/home_screen.dart)، نفس
// الـAPIs بالضبط (§59: مفيش محرك اكتشاف خدمة منفصل للويب).
//
// ── إعادة تخطيط 2026-09-11 (طلب مالك: «الهيرو ياخد الشاشة كلها») ──────────────────────────
// الهيرو كان `section` بعرض الشاشة الكامل وارتفاع ~٤٥٠px، فالفئات — اللي هي **الغرض** من
// الصفحة — مكانتش بتبان غير بعد scroll. دلوقتي الهيرو كارت مضغوط بيقعد **جنب** شبكة الفئات
// على الشاشات الكبيرة (٥ أعمدة مقابل ٧)، وفوقها على الموبايل. نفس المحتوى بالحرف (نفس الـeyebrow
// والعنوان والوصف والبحث ورسالة الثقة) — التغيير في الحجم والمكان بس.
const HERO_SLIDES = [
  'linear-gradient(135deg, #1c3a6e 0%, #2f5aa6 55%, #4d78c4 100%)',
  'linear-gradient(135deg, #0f1115 0%, #22314f 45%, #2f5aa6 100%)',
  'linear-gradient(135deg, #2f5aa6 0%, #4d78c4 50%, #7fa6e0 100%)',
];

const HERO_SLIDE_DURATION_MS = 6000;

// عدد الفئات الظاهرة قبل «عرض الكل». **مش قيمة تجميلية**: الكتالوج مفتوح العدد (بيئة التطوير
// عندها مئات الفئات فعلاً)، وطباعتها كلها في الصفحة الرئيسية بتحوّل أول شاشة لجدار بلا معنى
// وبتكسر التوازن مع الهيرو اللي جنبها. ١٢ = أربع صفوف × ٣ أعمدة على الشاشة الكبيرة، وده تقريبًا
// نفس ارتفاع الهيرو بالظبط.
const VISIBLE_CATEGORIES = 12;
const DEFAULT_SEARCH_CONTENT = {
  eyebrow: 'أساعدك إزاي؟',
  title: 'محتاج مساعدة في إيه؟',
  description: 'قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات جنبها',
  placeholder: 'وصّف مشكلتك... زي "المياه بتنزل من تحت الحوض"',
};

// نمط نقطي خفيف جدًا (data URI، صفر طلب شبكة إضافي) — نفس فلسفة placeholderSvgDataUri في
// apps/api/src/modules/branding/branding-defaults.ts (أصل مضمّن في الكود، مش ملف خارجي).
const HERO_PATTERN =
  'url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuMiIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjA5Ii8+PC9zdmc+")';

// لون محايد غامق تحت الهيرو دايمًا. **ده إصلاح «الوميض الأزرق»** اللي المالك بلّغ عنه: قبل كده
// التدرّجات الزرقاء كانت بتترسم فورًا كـfallback بينما إعدادات الصفحة لسه بتتجاب، فالمستخدم كان
// بيشوف أزرق ساطع ثم الصورة الحقيقية تحل محله. دلوقتي الأساس محايد، والتدرّجات مابتظهرش غير لما
// نتأكد فعلاً إن مفيش صورة مرفوعة.
const HERO_NEUTRAL = '#111820';

// "نصايح مفيدة" — مُدارة من الأدمن (homepage.tips). لو الأدمن ما حطش صورة، بيرجع لتدرّج افتراضي
// مُتسلسل حسب index بدل مكان فاضي.
const TIP_FALLBACK_BACKGROUNDS = [
  'linear-gradient(135deg, #2f5aa6 0%, #4d78c4 100%)',
  'linear-gradient(135deg, #3c8b4a 0%, #6fbf7a 100%)',
  'linear-gradient(135deg, #c98a1f 0%, #e0ac4e 100%)',
];

export default function HomePage() {
  const router = useRouter();
  const catalogZone = useCatalogZone();
  const heroMediaRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<ServiceCategoryDto[] | null>(null);
  const [mostRequested, setMostRequested] = useState<ServiceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catalogLoadKey, setCatalogLoadKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [heroImages, setHeroImages] = useState<string[]>([]);
  const [heroBackgroundUrl, setHeroBackgroundUrl] = useState<string | null>(null);
  // كل نداء من التنين بيرفع بِتّه — التدرّج الاحتياطي مابيتعرضش غير لما **الاتنين** يخلصوا،
  // وإلا بيرجع الوميض من الشباك تاني (صورة splash موجودة بس ردّها وصل متأخر شوية).
  const [heroSettled, setHeroSettled] = useState({ content: false, branding: false });
  const [loadedHeroImages, setLoadedHeroImages] = useState<string[]>([]);
  const [trustMessage, setTrustMessage] = useState('');
  const [searchContent, setSearchContent] = useState(DEFAULT_SEARCH_CONTENT);
  const [tips, setTips] = useState<HomepageTipDto[]>([]);
  const [supportContact, setSupportContact] = useState<SupportContactDto | null>(null);

  useEffect(() => {
    fetchHomepageContent()
      .then((content) => {
        setTrustMessage(content.trust_message);
        setHeroImages(content.hero_images ?? []);
        setSearchContent(content.search ?? DEFAULT_SEARCH_CONTENT);
        setActiveSlide(0);
        setTips(content.tips);
      })
      .catch(() => {})
      .finally(() => setHeroSettled((s) => ({ ...s, content: true })));
    fetchSupportContact()
      .then(setSupportContact)
      .catch(() => {});
    fetchHeroBackground()
      .then((asset) => setHeroBackgroundUrl(asset.is_default ? null : asset.url))
      .catch(() => {})
      .finally(() => setHeroSettled((s) => ({ ...s, branding: true })));
  }, []);

  useEffect(() => {
    if (!catalogZone.isReady) return;
    if (!catalogZone.canLoadCatalog) return;

    let active = true;
    const loadKey = catalogZone.zoneId ?? 'public';
    Promise.all([
      fetchCategories(catalogZone.zoneId ?? undefined),
      fetchMostRequestedServices(catalogZone.zoneId ?? undefined),
    ])
      .then(([nextCategories, nextMostRequested]) => {
        if (!active) return;
        setCategories(nextCategories);
        setMostRequested(nextMostRequested);
        setError(null);
        setCatalogLoadKey(loadKey);
      })
      .catch(() => {
        if (!active) return;
        setError('تعذّر تحميل الفئات — حاول تاني');
        setCatalogLoadKey(loadKey);
      });
    return () => {
      active = false;
    };
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId]);

  const effectiveHeroImages = useMemo(
    () => (heroImages.length > 0 ? heroImages : heroBackgroundUrl ? [heroBackgroundUrl] : []),
    [heroBackgroundUrl, heroImages],
  );
  const heroResolved = heroSettled.content && heroSettled.branding;
  const showGradientFallback = heroResolved && effectiveHeroImages.length === 0;

  useEffect(() => {
    const slideCount = effectiveHeroImages.length || (showGradientFallback ? HERO_SLIDES.length : 1);
    if (slideCount <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((current) => (current + 1) % slideCount);
    }, HERO_SLIDE_DURATION_MS);
    return () => clearInterval(timer);
  }, [effectiveHeroImages.length, showGradientFallback]);

  useEffect(() => {
    const media = heroMediaRef.current;
    if (!media || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    // الهيرو بقى كارت مضغوط، فحركة الـparallax اتخفّت (٤٪ بدل ٩٪ وتكبير ١.٠٦ بدل ١.١٤) — نفس
    // الحركة على مساحة أصغر كانت بتبان اهتزاز مش عمق.
    const updateParallax = () => {
      frame = 0;
      const offset = Math.min(window.scrollY, 200) * -0.04;
      media.style.transform = `translate3d(0, ${offset}px, 0) scale(1.06)`;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(updateParallax);
    };
    updateParallax();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const activeCatalogKey = catalogZone.zoneId ?? 'public';
  const catalogCurrent = catalogZone.canLoadCatalog && catalogLoadKey === activeCatalogKey;
  const visibleCategories = catalogZone.canLoadCatalog ? (catalogCurrent ? categories : null) : [];
  const visibleError = catalogZone.canLoadCatalog
    ? catalogCurrent
      ? error
      : null
    : catalogZone.isReady
      ? 'أضف عنوانًا داخل منطقة خدمة عشان نعرض لك الخدمات المتاحة'
      : null;
  const featured = catalogCurrent ? mostRequested : [];
  const shownCategories = visibleCategories
    ? showAllCategories
      ? visibleCategories
      : visibleCategories.slice(0, VISIBLE_CATEGORIES)
    : null;
  const hiddenCategoryCount = visibleCategories ? visibleCategories.length - (shownCategories?.length ?? 0) : 0;

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-5 sm:pt-8">
      {/* ── الهيرو + الفئات جنب بعض ────────────────────────────────────────────────────────
          على lg: خمسة أعمدة للهيرو وسبعة للفئات. تحت كده: الهيرو فوق بارتفاع محدود، والفئات
          تحته مباشرة — من غير ما أي واحد فيهم ياخد الشاشة كلها. */}
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <section className="relative isolate overflow-hidden rounded-3xl lg:col-span-5" aria-labelledby="hero-title">
          <div aria-hidden className="absolute inset-0" style={{ backgroundColor: HERO_NEUTRAL }}>
            <div
              ref={heroMediaRef}
              className="absolute inset-[-4%] origin-center will-change-transform"
              style={{ transform: 'translate3d(0, 0, 0) scale(1.06)' }}
            >
              {effectiveHeroImages.map((url, index) => (
                // eslint-disable-next-line @next/next/no-img-element -- admin-managed local/S3/CDN URL
                <img
                  key={url}
                  src={url}
                  alt=""
                  // أول صورة بس هي اللي فوق الطية — الباقي بيتحمّل كسول عشان مايزاحمش أول رسم.
                  loading={index === 0 ? 'eager' : 'lazy'}
                  fetchPriority={index === 0 ? 'high' : 'low'}
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out"
                  // الصورة مابتتعرضش قبل ما تتحمّل فعلاً — العرض المبكّر كان بيدّي إطار أبيض/فاضي
                  // بين اللحظة اللي الـ<img> بتتضاف فيها واللحظة اللي البكسلات بتوصل فيها.
                  style={{ opacity: index === activeSlide && loadedHeroImages.includes(url) ? 1 : 0 }}
                  onLoad={() => setLoadedHeroImages((current) => (current.includes(url) ? current : [...current, url]))}
                  onError={() => {
                    if (heroImages.length > 0) setHeroImages((current) => current.filter((item) => item !== url));
                    else setHeroBackgroundUrl(null);
                    setActiveSlide(0);
                  }}
                />
              ))}
              {showGradientFallback &&
                HERO_SLIDES.map((background, i) => (
                  <div
                    key={background}
                    className="absolute inset-0 transition-opacity duration-700 ease-out"
                    style={{
                      backgroundImage: `${HERO_PATTERN}, ${background}`,
                      opacity: i === activeSlide ? 1 : 0,
                    }}
                  />
                ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
          </div>

          <div className="relative flex min-h-[260px] flex-col justify-end gap-3 p-5 sm:min-h-[340px] sm:gap-4 sm:p-8 lg:min-h-[420px]">
            <div className="text-white [text-shadow:0_2px_18px_rgb(0_0_0/0.45)]">
              <p className="inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90 backdrop-blur-sm">
                {searchContent.eyebrow}
              </p>
              <h1 id="hero-title" className="mt-2.5 text-xl font-bold leading-tight sm:mt-3 sm:text-3xl">
                {searchContent.title}
              </h1>
              <p className="mt-1.5 line-clamp-2 max-w-md text-[13px] leading-5 text-white/85 sm:mt-2 sm:text-sm sm:leading-6">{searchContent.description}</p>
            </div>

            <form onSubmit={submitSearch}>
              <div className="flex items-center gap-1 rounded-full border border-white/30 bg-surface/95 p-1 shadow-[0_12px_35px_rgb(0_0_0/0.28)] backdrop-blur-md transition-shadow duration-300 focus-within:shadow-[0_16px_45px_rgb(0_0_0/0.36)]">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchContent.placeholder}
                  aria-label={searchContent.title}
                  className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted"
                />
                <button
                  type="submit"
                  className="motion-press shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  بحث
                </button>
              </div>
            </form>

            {trustMessage && (
              <p className="flex items-start gap-2 text-xs font-medium leading-5 text-white drop-shadow-md sm:items-center sm:text-sm">
                <svg viewBox="0 0 24 24" fill="none" className="mt-0.5 h-4 w-4 shrink-0 sm:mt-0 sm:h-5 sm:w-5" aria-hidden>
                  <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {trustMessage}
              </p>
            )}

            {effectiveHeroImages.length > 1 && (
              <div className="flex gap-2" aria-label="صور الواجهة الرئيسية">
                {effectiveHeroImages.map((url, index) => (
                  <span
                    key={url}
                    className={`h-1.5 rounded-full bg-white transition-all duration-300 ${index === activeSlide ? 'w-6' : 'w-1.5 opacity-55'}`}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-7" aria-labelledby="categories-title">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 id="categories-title" className="text-lg font-semibold">
              كل الفئات
            </h2>
            <Link href="/search" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              تصفّح كل الخدمات
            </Link>
          </div>

          {visibleError ? (
            <p className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{visibleError}</p>
          ) : visibleCategories === null ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-xl bg-surface-variant" />
              ))}
            </div>
          ) : visibleCategories.length === 0 ? (
            <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
              مفيش فئات خدمات متاحة دلوقتي
            </p>
          ) : (
            <div className="motion-list grid grid-cols-3 gap-3 sm:grid-cols-4">
              {(shownCategories ?? []).map((c) => (
                <CategoryTile key={c.id} category={c} />
              ))}
            </div>
          )}

          {hiddenCategoryCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllCategories(true)}
              className="motion-press mt-3 w-full rounded-2xl border border-border bg-surface-variant/50 py-3 text-sm font-medium text-primary transition-colors hover:border-primary"
            >
              عرض كل الفئات ({visibleCategories?.length})
            </button>
          )}
          {showAllCategories && visibleCategories && visibleCategories.length > VISIBLE_CATEGORIES && (
            <button
              type="button"
              onClick={() => setShowAllCategories(false)}
              className="motion-press mt-3 w-full rounded-2xl border border-border bg-surface-variant/50 py-3 text-sm font-medium text-muted transition-colors hover:border-primary hover:text-primary"
            >
              عرض أقل
            </button>
          )}
        </section>
      </div>

      {/* ── الأكثر طلبًا ───────────────────────────────────────────────────────────────────
          كان `flex flex-wrap` بعناصر `w-20`: العناصر بتتوزّع بمسافات غير منتظمة والأسماء
          بأطوال مختلفة بتخلي خطوط الأساس مش متساوية (بلاغ المالك عن التناسق). شبكة بخلايا
          متساوية + ارتفاع ثابت للنص = كل الأيقونات على خط واحد وكل الأسماء على خط واحد. */}
      {featured.length > 0 && (
        <section className="mt-12" aria-labelledby="featured-title">
          <h2 id="featured-title" className="mb-4 text-lg font-semibold">
            الأكثر طلبًا
          </h2>
          <div className="motion-list grid grid-cols-4 gap-x-3 gap-y-5 sm:grid-cols-6 lg:grid-cols-8">
            {featured.map((service) => (
              <Link
                key={service.id}
                href={`/services/${service.id}`}
                className="motion-rise motion-press group flex flex-col items-center gap-2 text-center"
              >
                {/* **بلا إطار وبلا خلفية** — بلاغ المالك 2026-09-11: «ما يبقاش باين إطار
                    الصورة، والـPNG اللي خلفيته شفافة تبان عليها خلفية الموقع». الأندرويد
                    (`FeaturedServiceItem`) بيرسم الصورة على طول من غير صندوق، والويب كان
                    لافّها في `border border-border bg-surface`. دايرة القص هنا شكل مش صندوق:
                    مفيش لون خلفه، فالشفافية بتوصل لخلفية الصفحة زي ما هي. */}
                <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full transition-transform duration-200 group-hover:-translate-y-0.5">
                  {service.featured_icon_url || service.icon_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={service.featured_icon_url || service.icon_url || ''}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    // نفس `_FeaturedInitial` في الأندرويد بالحرف — دايرة بلون أساسي خفيف
                    // وأول حرف. ده الاحتياطي الوحيد اللي الأندرويد بيعرضه هنا.
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                      {(service.featured_name_ar || service.name_ar).charAt(0)}
                    </span>
                  )}
                </span>
                {/* ارتفاع ثابت لسطرين: اسم من سطر واحد واسم من سطرين بيفضلوا على نفس الخط. */}
                <span className="line-clamp-2 flex h-8 items-start justify-center text-xs font-medium leading-4 text-foreground group-hover:text-primary">
                  {service.featured_name_ar || service.name_ar}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {tips.length > 0 && (
        <section className="mt-14" aria-labelledby="tips-title">
          <h2 id="tips-title" className="text-lg font-semibold">
            نصايح مفيدة
          </h2>
          <p className="mb-4 mt-1 text-sm text-muted">حاجات كويس تعرفها قبل ما تحجز أي شغلانة</p>
          {/* scroll-snap بيخلي التمرير الأفقي بيقف على كارت كامل بدل ما يسيب نص كارت مقصوص. */}
          <div className="motion-list -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
            {tips.map((tip, i) => (
              <article
                key={`${tip.title}-${i}`}
                className="motion-rise w-64 shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-surface transition-shadow duration-200 hover:shadow-[0_10px_30px_rgb(0_0_0/0.08)]"
              >
                {tip.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- رابط خارجي حر بيحطه الأدمن، مش أصل static معروف وقت البناء
                  <img
                    src={tip.image_url}
                    alt=""
                    width={256}
                    height={128}
                    loading="lazy"
                    decoding="async"
                    className="h-32 w-full bg-surface-variant object-cover"
                  />
                ) : (
                  <div
                    className="h-32 w-full"
                    style={{ background: TIP_FALLBACK_BACKGROUNDS[i % TIP_FALLBACK_BACKGROUNDS.length] }}
                  />
                )}
                <div className="p-4">
                  <h3 className="font-semibold leading-snug">{tip.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{tip.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {supportContact?.enabled && (supportContact.phone_number || supportContact.whatsapp_url) && (
        <section className="mt-14 rounded-3xl border border-border bg-surface-variant/50 p-8 text-center" aria-labelledby="support-title">
          <h2 id="support-title" className="text-lg font-semibold">
            محتاج مساعدة؟
          </h2>
          <p className="mt-1 text-sm text-muted">فريق الدعم موجود يرد عليك</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {supportContact.phone_number && (
              <a
                href={`tel:${supportContact.phone_number}`}
                className="motion-press rounded-full border border-border bg-surface px-6 py-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
                dir="ltr"
              >
                {supportContact.phone_number}
              </a>
            )}
            {supportContact.whatsapp_url && (
              <a
                href={supportContact.whatsapp_url}
                target="_blank"
                rel="noopener noreferrer"
                className="motion-press rounded-full border border-border bg-surface px-6 py-3 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                واتساب
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
