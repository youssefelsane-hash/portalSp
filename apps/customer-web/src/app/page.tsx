'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchCategories } from '@/lib/catalog';
import { fetchHeroBackground, fetchHomepageContent, fetchSupportContact } from '@/lib/settings';
import { HomepageTipDto, ServiceCategoryDto, SupportContactDto } from '@/lib/api-types';

// Script 3 §2/§3/§5 — أول شاشة، بتقود بوصف المشكلة مش بسؤال تشغيلي (فرد/فريق) — مطابقة تمامًا
// لـHomeScreen في customer-app (apps/customer-app/lib/features/catalog/home_screen.dart)، نفس
// الـAPIs بالضبط (§59: مفيش محرك اكتشاف خدمة منفصل للويب).

// خلفية hero (طلب مالك صريح 2026-08-22، مبني على تصميم مرجعي — Angi.com). الشكل بس، صفر تغيير
// على منطق البحث/الفئات تحت.
//
// بَقّة حقيقية تانية (2026-08-23، ملاحظة مالك: "رفعت صورة من البراندنج، الأبليكيشن مش بيتغيّر")
// — الأدمن كان عنده أصل براندنج اسمه "شاشة البداية (Splash)" مرفوع بالفعل ونجاح واضح، بس الصفحة
// دي أصلاً مكانت بتستهلكهوش خالص (فجوة استهلاك، مش بَقّة تخزين — تخزين البراندنج نفسه اتصلح
// قبل كده). دلوقتي `fetchHeroBackground()` (`GET /branding`'s `splash` asset) بيتجاب، ولو الأدمن
// رفع صورة حقيقية (`is_default=false`) بتحل محل التدرّجات تمامًا كخلفية hero ثابتة. `HERO_SLIDES`
// فضلت **fallback** بس لحد ما الأدمن يرفع صورة — تدرّجات لونية بهوية العلامة + نمط نقطي خفيف
// عشان الخلفية متبقاش مسطّحة، بتدور كل 6 ثواني زي الأول بالظبط.
const HERO_SLIDES = [
  { background: 'linear-gradient(135deg, #1c3a6e 0%, #2f5aa6 55%, #4d78c4 100%)' },
  { background: 'linear-gradient(135deg, #0f1115 0%, #22314f 45%, #2f5aa6 100%)' },
  { background: 'linear-gradient(135deg, #2f5aa6 0%, #4d78c4 50%, #7fa6e0 100%)' },
];

const HERO_SLIDE_DURATION_MS = 6000;

// نمط نقطي خفيف جدًا (data URI، صفر طلب شبكة إضافي) — نفس فلسفة placeholderSvgDataUri في
// apps/api/src/modules/branding/branding-defaults.ts (أصل مضمّن في الكود، مش ملف خارجي).
const HERO_PATTERN =
  "url(\"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEuMiIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1vcGFjaXR5PSIwLjA5Ii8+PC9zdmc+\")";

// قسم "نصايح مفيدة" أسفل الصفحة (طلب مالك صريح 2026-08-22، تصميم مرجعي: كارت "Popular cost
// guides" في Angi.com) — **كان placeholder بصري بس** (محتوى ثابت في الكود، `HOME_TIPS` قديمًا) —
// بقى مُدار من الأدمن بالكامل (`homepage.tips` setting، بلاغ مالك صريح 2026-08-23: "مش لاقي له
// مكان أرفع منه الصور") عبر `fetchHomepageContent()` تحت، إدارة كاملة من `/homepage-content` في
// apps/admin. `image_url` لسه اختياري — لو الأدمن ما حطش رابط صورة، بيرجع للتدرّج اللوني الافتراضي
// (نفس الشكل القديم بالحرف، مُتسلسل حسب index) بدل ما يفضل مكان الصورة فاضي.
const TIP_FALLBACK_BACKGROUNDS = [
  'linear-gradient(135deg, #2f5aa6 0%, #4d78c4 100%)',
  'linear-gradient(135deg, #3c8b4a 0%, #6fbf7a 100%)',
  'linear-gradient(135deg, #c98a1f 0%, #e0ac4e 100%)',
];

export default function HomePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<ServiceCategoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);
  const [heroBackgroundUrl, setHeroBackgroundUrl] = useState<string | null>(null);
  const [trustMessage, setTrustMessage] = useState('');
  const [tips, setTips] = useState<HomepageTipDto[]>([]);
  const [supportContact, setSupportContact] = useState<SupportContactDto | null>(null);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch(() => setError('تعذّر تحميل الفئات — حاول تاني'));
    // رسالة الثقة/الضمان ونصايح مفيدة ودعم العملاء — نص/بيانات إدارية بتتغيّر، صفر تأثير على باقي
    // الصفحة لو الجلب فشل (بيسيبوا فاضيين، الأقسام المعتمدة عليهم بتختفي بهدوء تحت).
    fetchHomepageContent()
      .then((content) => {
        setTrustMessage(content.trust_message);
        setTips(content.tips);
      })
      .catch(() => {});
    fetchSupportContact()
      .then(setSupportContact)
      .catch(() => {});
    // خلفية الـhero (splash) — لو الأدمن رفع صورة حقيقية بتحل محل تدرّجات HERO_SLIDES تمامًا.
    fetchHeroBackground()
      .then((asset) => setHeroBackgroundUrl(asset.is_default ? null : asset.url))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (heroBackgroundUrl || HERO_SLIDES.length <= 1) return;
    const timer = setInterval(() => {
      setActiveSlide((current) => (current + 1) % HERO_SLIDES.length);
    }, HERO_SLIDE_DURATION_MS);
    return () => clearInterval(timer);
  }, [heroBackgroundUrl]);

  const featured = categories?.filter((c) => c.is_featured) ?? [];

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  return (
    <div>
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="absolute inset-0">
          {heroBackgroundUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- رابط ديناميكي من البراندنج (محلي/S3)، مش أصل static معروف وقت البناء
            <img
              src={heroBackgroundUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              // فشل تحميل الصورة (شبكة، رابط اترفض) بيرجّع للتدرّج الدوّار بدل خلفية فاضية —
              // نفس فلسفة onError في apps/customer-app's DecorationImage بالحرف.
              onError={() => setHeroBackgroundUrl(null)}
            />
          ) : (
            HERO_SLIDES.map((slide, i) => (
              <div
                key={i}
                className="absolute inset-0 transition-opacity duration-1000 ease-in-out"
                style={{ background: slide.background, backgroundImage: `${HERO_PATTERN}, ${slide.background}`, opacity: i === activeSlide ? 1 : 0 }}
              />
            ))
          )}
          {/* تدرّج غامق أسفل الصورة لضمان وضوح النص/الفورم فوقها، سواء صورة حقيقية أو تدرّج fallback */}
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

          {/* رسالة الثقة/الضمان (طلب مالك صريح 2026-08-22) — نص إداري قابل للتعديل من الأدمن
              (settings.homepage.trust_message)، مش ثابت في الكود. بلا صندوق/إطار عمدًا — ظاهرة
              مباشرة فوق صورة الـhero نفسها (مش فوق اللوحة الشفافة اللي فيها البحث)، نص واضح غير
              شفاف مع ظل خفيف يضمن وضوحه فوق أي slide. */}
          {trustMessage && (
            <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm font-medium text-white drop-shadow-md sm:text-base">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0" aria-hidden>
                <path
                  d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {trustMessage}
            </p>
          )}
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

        {/* "نصايح مفيدة" — مُدارة من الأدمن دلوقتي (homepage.tips)، تفاصيل في التعليق فوق
            TIP_FALLBACK_BACKGROUNDS. مبتظهرش خالص لو الأدمن مسحها كلها (نفس فلسفة trustMessage/
            supportContact — بيختفي بهدوء بدل قسم فاضي). */}
        {tips.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-1 text-lg font-semibold">نصايح مفيدة</h2>
            <p className="mb-4 text-sm text-muted">حاجات كويس تعرفها قبل ما تحجز أي شغلانة</p>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {tips.map((tip, i) => (
                <div key={i} className="w-64 shrink-0 overflow-hidden rounded-xl border border-border bg-surface">
                  {tip.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- رابط خارجي حر بيحطه الأدمن، مش أصل static معروف وقت البناء
                    <img src={tip.image_url} alt={tip.title} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="h-32 w-full" style={{ background: TIP_FALLBACK_BACKGROUNDS[i % TIP_FALLBACK_BACKGROUNDS.length] }} />
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold">{tip.title}</h3>
                    <p className="mt-1 text-sm text-muted">{tip.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* الدعم — طلب مالك صريح 2026-08-22: نفس بيانات تواصل خدمة العملاء المعروضة بالفعل في
            apps/customer-app/apps/technician-app (GET /settings/support-contact)، دلوقتي متاحة
            في الويب كمان. مبيظهرش خالص لو enabled=false أو مفيش رقم حقيقي متسجّل (نفس شرط التطبيقات). */}
        {supportContact?.enabled && (supportContact.phone_number || supportContact.whatsapp_url) && (
          <div className="mt-12 border-t border-border pt-8 text-center">
            <h2 className="text-lg font-semibold">الدعم</h2>
            <p className="mt-1 text-sm text-muted">محتاج مساعدة؟ إحنا هنا</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {supportContact.phone_number && (
                <a
                  href={`tel:${supportContact.phone_number}`}
                  className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium hover:border-primary hover:text-primary"
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
                  className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-medium hover:border-primary hover:text-primary"
                >
                  واتساب
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
