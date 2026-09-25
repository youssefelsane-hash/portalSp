import type { MetadataRoute } from 'next';
import { SITE_URL, fetchSeoSitemap } from '@/lib/seo';

/**
 * **خريطة الموقع** (ADR-0113 §7) — مكانتش موجودة خالص، وده كان أكبر فجوة ظهور في الموقع: مفيش
 * ملف واحد بيقول للزاحف إيه الصفحات الموجودة.
 *
 * الصفحات الثابتة مكتوبة هنا، وصفحات الخدمة × المنطقة بتتولّد من **نفس** المصدر اللي الصفحات
 * نفسها بتقرا منه (`/seo/sitemap`) — فمستحيل الخريطة تعلن صفحة بترجّع 404.
 */
export const revalidate = 3600;

const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
  { path: '/', priority: 1, changeFrequency: 'daily' },
  { path: '/search', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/about', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/join', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await fetchSeoSitemap();
  const now = new Date();

  return [
    ...STATIC_PATHS.map((s) => ({
      url: `${SITE_URL}${s.path}`,
      lastModified: now,
      changeFrequency: s.changeFrequency,
      priority: s.priority,
    })),
    ...entries.map((entry) => ({
      url: `${SITE_URL}${entry.path}`,
      lastModified: new Date(entry.updated_at),
      changeFrequency: 'weekly' as const,
      // صفحة الخدمة الأم أعلى من صفحة المنطقة: الأم بتغطي كل المناطق، والمنطقة تخصيص منها.
      priority: entry.path.split('/').length > 3 ? 0.7 : 0.9,
    })),
  ];
}
