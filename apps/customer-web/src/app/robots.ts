import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

/**
 * **robots.txt** (ADR-0113 §7) — مكانش موجود خالص.
 *
 * المسارات المستثناة كلها **شخصية أو لحساب داخل** (حسابي، طلباتي، الدخول، مشاريعي): مالهاش أي
 * قيمة في الفهرسة، وبتستهلك حصة زحف، وبعضها بيحتاج توكن فبترجع تحويل للدخول — الزاحف بيسجّلها
 * كصفحات مكسورة. الصفحات العامة (الخدمات، البحث، القانوني) مفتوحة عن قصد.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/account', '/orders', '/login', '/register', '/pin-reset', '/projects', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
