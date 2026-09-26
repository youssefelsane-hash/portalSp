/**
 * **صفحات الظهور في البحث** (ADR-0113) — مطابق لـ`apps/api/src/modules/seo/seo.controller.ts`.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

/** عنوان الموقع العام — بيتستخدم في `sitemap`/`robots`/`canonical`. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ostahome.com').replace(/\/$/, '');

/**
 * **أسماء البراند البديلة** — طلب المالك بالنص: «لما حد يكتب Osta بس، الدومين يكون OstaHome…
 * تكون بتساوي أسطى بالعربي، أسطى هوم…».
 *
 * بتروح في `alternateName` جوّه JSON-LD `WebSite` و`Organization`. الاسم الأساسي «أسطى» بيتكتب
 * في `name`، ومش بيتكرر هنا. وسم `meta keywords` مش عامل ترتيب في Google.
 *
 * **مصدر واحد**: تكرار القايمة في كل صفحة معناه إن إضافة اسم جديد بتتنسى في نص المواضع.
 */
export const BRAND_ALTERNATE_NAMES = [
  'Osta',
  'OstaHome',
  'Osta Home',
  'اسطى',
  'أسطى هوم',
  'اسطى هوم',
] as const;

/** كلمات الخدمات اللي الناس بتدوّر بيها فعلاً — بتتحط مع اسم الخدمة في `keywords`. */
export const BRAND_SERVICE_KEYWORDS = [
  'سباكة',
  'كهرباء',
  'نظافة',
  'تنظيف منزل',
  'تكييف',
  'نجارة',
  'دهانات',
  'صنايعي',
  'فني',
  'خدمات منزلية',
] as const;

export interface SeoServiceListItem {
  slug: string;
  name_ar: string;
  short_description_ar: string | null;
}

export interface SeoAreaRef {
  slug: string;
  name_ar: string;
  city_name_ar: string;
}

export interface SeoServiceDetail {
  /** لازم لزرار الحجز: صفحة الحجز على الموقع هي `/services/{id}`. */
  id: string;
  slug: string;
  name_ar: string;
  short_description_ar: string | null;
  seo_content_ar: string;
  updated_at: string;
  /** المنطقة المطلوبة لو موجودة **ومُطلَقة**؛ `null` غير كده (الصفحة بترجّع 404 ساعتها). */
  area: SeoAreaRef | null;
  areas: SeoAreaRef[];
  area_requested: string | null;
}

/**
 * الخدمات المنشورة. فشل الشبكة **ما ينفعش يكسر كل صفحة في الموقع** (الفوتر بيتشاف من كل صفحة)،
 * فبيرجّع قايمة فاضية وقسم الخدمات يختفي — نفس فلسفة `fetchSocialLinks` بالحرف.
 */
export async function fetchSeoServices(): Promise<SeoServiceListItem[]> {
  try {
    const res = await fetch(`${API_BASE}/seo/services`, { next: { revalidate: 600 } });
    if (!res.ok) return [];
    const envelope = (await res.json()) as { data?: SeoServiceListItem[] };
    return envelope.data ?? [];
  } catch {
    return [];
  }
}

/**
 * تفاصيل صفحة واحدة. بيرجّع `null` للغياب **وللفشل** — الصفحة بتتحوّل `notFound()` في الحالتين.
 *
 * عرض صفحة نصها فاضي وقت عطل مؤقت أسوأ من 404: الزاحف بيفهرس الصفحة الفاضية ويفضل فاكرها كده.
 */
export async function fetchSeoService(slug: string, areaSlug?: string): Promise<SeoServiceDetail | null> {
  const query = areaSlug ? `?area=${encodeURIComponent(areaSlug)}` : '';
  try {
    const res = await fetch(`${API_BASE}/seo/services/${encodeURIComponent(slug)}${query}`, {
      next: { revalidate: 600 },
    });
    if (!res.ok) return null;
    const envelope = (await res.json()) as { data?: SeoServiceDetail };
    return envelope.data ?? null;
  } catch {
    return null;
  }
}

export interface SitemapEntry {
  path: string;
  updated_at: string;
}

export async function fetchSeoSitemap(): Promise<SitemapEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/seo/sitemap`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const envelope = (await res.json()) as { data?: SitemapEntry[] };
    return envelope.data ?? [];
  } catch {
    return [];
  }
}

/** عنوان الصفحة — مصدر واحد عشان `metadata` و`h1` و`JSON-LD` مايختلفوش. */
export function seoPageTitle(serviceName: string, area: SeoAreaRef | null): string {
  return area ? `${serviceName} في ${area.name_ar}، ${area.city_name_ar}` : serviceName;
}

/**
 * **رابط زرار الحجز — صفحة الحجز على نفس الموقع** (ADR-0113 §5).
 *
 * `/services/{id}` هي فلو الحجز الكامل على الويب (تسعير، عنوان، اختيار فني، دفع). فالزائر الجاي
 * من جوجل بيكمّل حجزه **من غير ما يطلع من الموقع ولا ينزّل تطبيق** — وده أقل احتكاك ممكن،
 * وبيشتغل على الديسكتوب كمان.
 *
 * وسم المصدر بيتمرّر عشان الزيارة تبقى مميّزة في القياس بدل ما تتلخبط مع الزيارات المباشرة.
 */
export function bookingLinkFor(serviceId: string, areaSlug?: string): string {
  const query = new URLSearchParams({ utm_source: 'seo_page' });
  if (areaSlug) query.set('utm_content', areaSlug);
  return `/services/${serviceId}?${query.toString()}`;
}
