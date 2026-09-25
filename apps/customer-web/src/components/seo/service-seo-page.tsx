import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchSupportContact } from '@/lib/support-contact';
import { SupportContactBlock } from './support-contact-block';
import {
  BRAND_ALTERNATE_NAMES,
  BRAND_SERVICE_KEYWORDS,
  SITE_URL,
  bookingLinkFor,
  fetchSeoService,
  seoPageTitle,
} from '@/lib/seo';
import { BookingCta } from './booking-cta';
import { ServiceAreasList } from './service-areas-list';

/**
 * **الصفحة الواحدة اللي المسارين بيستخدموها** (ADR-0113).
 *
 * `/services/[serviceSlug]` و`/services/[serviceSlug]/[areaSlug]` نفس المحتوى بالظبط، والفرق هو
 * المنطقة في العنوان وفي `h1`. نسختين من الملف كانوا هيفترقوا أول تعديل، والنتيجة صفحتين بيقولوا
 * حاجتين مختلفتين لنفس الخدمة — وده بالظبط «جزء معمول في مكان ومش كامل في التاني».
 */

function canonicalFor(slug: string, areaSlug?: string): string {
  return areaSlug ? `${SITE_URL}/services/${slug}/${areaSlug}` : `${SITE_URL}/services/${slug}`;
}

/** `metadata` و`<main>` بيقروا **نفس** النداء — Next بيجمّع الطلبين في واحد على نفس الـrequest. */
export async function buildServiceSeoMetadata(slug: string, areaSlug?: string): Promise<Metadata> {
  const detail = await fetchSeoService(slug, areaSlug);
  // **مفيش metadata لصفحة مش موجودة**: الـ`<main>` بيرمي `notFound()` بعدها، والعنوان الافتراضي
  // أحسن من عنوان بيوصف حاجة مش هتتعرض.
  if (!detail || (areaSlug && !detail.area)) return {};

  const title = `${seoPageTitle(detail.name_ar, detail.area)} — أسطى`;
  const description =
    detail.short_description_ar?.trim() ||
    `${seoPageTitle(detail.name_ar, detail.area)} مع أسطى — فني معتمد، سعر واضح قبل الحجز، وضمان على الشغل.`;
  const canonical = canonicalFor(slug, areaSlug);

  return {
    title,
    description,
    keywords: [
      detail.name_ar,
      ...(detail.area ? [`${detail.name_ar} ${detail.area.name_ar}`, `${detail.name_ar} ${detail.area.city_name_ar}`] : []),
      ...BRAND_ALTERNATE_NAMES,
      ...BRAND_SERVICE_KEYWORDS,
    ],
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website', locale: 'ar_EG', siteName: 'أسطى' },
  };
}

export async function ServiceSeoPage({ slug, areaSlug }: { slug: string; areaSlug?: string }) {
  const [detail, contact] = await Promise.all([fetchSeoService(slug, areaSlug), fetchSupportContact()]);
  // **منطقة مطلوبة ومش مُطلَقة ⇒ 404**، مش صفحة بتتكلم عن منطقة إحنا مش بنخدمها. صفحة كده وعد
  // مكسور للزائر ومحتوى رقيق للزاحف (ADR-0113 §4).
  if (!detail || (areaSlug && !detail.area)) notFound();

  const heading = seoPageTitle(detail.name_ar, detail.area);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: heading,
    description: detail.short_description_ar ?? heading,
    serviceType: detail.name_ar,
    url: canonicalFor(slug, areaSlug),
    provider: {
      '@type': 'Organization',
      name: 'أسطى',
      alternateName: [...BRAND_ALTERNATE_NAMES],
      url: SITE_URL,
      // الرقم في البيانات المنظّمة كمان — ده اللي بيخلي نتيجة البحث نفسها تعرض وسيلة تواصل.
      ...(contact?.phone_number ? { telephone: contact.phone_number } : {}),
    },
    ...(detail.area
      ? { areaServed: { '@type': 'Place', name: `${detail.area.name_ar}، ${detail.area.city_name_ar}` } }
      : { areaServed: detail.areas.map((a) => ({ '@type': 'Place', name: `${a.name_ar}، ${a.city_name_ar}` })) }),
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      {/* JSON-LD هو اللي بيدي محركات البحث وأدوات الـAI بيانات منظّمة بدل ما تستنتجها من النص. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <h1 className="text-2xl font-extrabold leading-snug text-foreground sm:text-3xl">{heading}</h1>
      {detail.short_description_ar && (
        <p className="mt-3 text-base leading-7 text-muted">{detail.short_description_ar}</p>
      )}

      {/* **بيانات التواصل والحجز فوق الطية** — طلب المالك: «من أولها من فوق كده». */}
      <div className="mt-6 flex flex-col gap-3">
        <SupportContactBlock />
        <BookingCta
          serviceName={detail.name_ar}
          areaName={detail.area?.name_ar}
          bookingHref={bookingLinkFor(detail.id, detail.area?.slug)}
        />
      </div>

      {/* المحتوى اللي الأدمن كتبه. `whitespace-pre-line` بيحترم فواصل السطور اللي كتبها بلا ما
          نسمح بأي HTML — المحتوى بيتعرض كنص، فمفيش سطح XSS من حقل إداري. */}
      <article className="mt-8 whitespace-pre-line text-base leading-8 text-foreground">
        {detail.seo_content_ar}
      </article>

      <ServiceAreasList serviceSlug={slug} areas={detail.areas} currentAreaSlug={detail.area?.slug} />
    </main>
  );
}
