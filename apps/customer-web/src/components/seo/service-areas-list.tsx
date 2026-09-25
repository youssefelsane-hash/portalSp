import Link from 'next/link';
import type { SeoAreaRef } from '@/lib/seo';

/**
 * روابط «الخدمة دي في المناطق التانية» — **ربط داخلي** بين الصفحات.
 *
 * ده مش حشو: الزاحف بيكتشف صفحات المناطق من هنا ومن الـsitemap، والزائر اللي دخل على منطقة غلط
 * بيلاقي منطقته بدوسة بدل ما يرجع للبحث.
 */
export function ServiceAreasList({
  serviceSlug,
  areas,
  currentAreaSlug,
}: {
  serviceSlug: string;
  areas: SeoAreaRef[];
  currentAreaSlug?: string;
}) {
  const others = areas.filter((a) => a.slug !== currentAreaSlug);
  if (others.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby="areas-heading">
      <h2 id="areas-heading" className="text-lg font-bold text-foreground">
        المناطق اللي بنخدمها
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {others.map((area) => (
          <li key={area.slug}>
            <Link
              href={`/services/${serviceSlug}/${area.slug}`}
              className="inline-block rounded-full border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {area.name_ar}
              <span className="text-muted"> — {area.city_name_ar}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
