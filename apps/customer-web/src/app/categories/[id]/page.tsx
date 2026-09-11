'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { fetchCategories, fetchServices } from '@/lib/catalog';
import { ServiceCategoryDto, ServiceDto } from '@/lib/api-types';
import { useCatalogZone } from '@/lib/catalog-zone';
import { ServiceCard } from '@/components/catalog/service-card';

// نفس ServicesScreen في customer-app (Script 3 Phase 2) — بيعرض كل خدمات الفئة، وضع الحجز بيتقرر
// بعدين في شاشة الخدمة نفسها لو الخدمة فعلاً بتدعم أكتر من وضع.
export default function CategoryServicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const catalogZone = useCatalogZone();
  const [services, setServices] = useState<ServiceDto[] | null>(null);
  // الأندرويد بيعرض اسم الفئة في شريط العنوان (`ServicesScreen`) لأنه بيستقبل الكائن كامل.
  // الويب بيوصله `id` بس من الرابط، فبنجيب الفئة بالاسم — من غيرها العنوان بيفضل «الخدمات»
  // في كل فئة، والمستخدم اللي فتح لينك مباشر مش عارف هو فين.
  const [category, setCategory] = useState<ServiceCategoryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedZoneKey, setLoadedZoneKey] = useState<string | null>(null);

  useEffect(() => {
    if (!catalogZone.isReady) return;
    if (!catalogZone.canLoadCatalog) return;
    const loadKey = catalogZone.zoneId ?? 'public';
    fetchServices(id, catalogZone.zoneId ?? undefined)
      .then((items) => {
        setServices(items);
        setError(null);
        setLoadedZoneKey(loadKey);
      })
      .catch(() => {
        setError('تعذّر تحميل الخدمات');
        setLoadedZoneKey(loadKey);
      });
    // فشل ده مش بيأثر على الصفحة — العنوان بيرجع للنص العام وخلاص.
    fetchCategories(catalogZone.zoneId ?? undefined)
      .then((items) => setCategory(items.find((c) => c.id === id) ?? null))
      .catch(() => setCategory(null));
  }, [catalogZone.canLoadCatalog, catalogZone.isReady, catalogZone.zoneId, id]);

  const activeZoneKey = catalogZone.zoneId ?? 'public';
  const catalogCurrent = catalogZone.canLoadCatalog && loadedZoneKey === activeZoneKey;
  const visibleServices = catalogZone.canLoadCatalog ? (catalogCurrent ? services : null) : [];
  const visibleError = catalogZone.canLoadCatalog
    ? catalogCurrent
      ? error
      : null
    : catalogZone.isReady
      ? 'أضف عنوانًا داخل منطقة خدمة عشان نعرض لك الخدمات المتاحة'
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">{category?.name_ar ?? 'الخدمات'}</h1>
      {visibleError ? (
        <p className="text-danger">{visibleError}</p>
      ) : visibleServices === null ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className="aspect-[3/1] animate-pulse bg-surface-variant" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-variant" />
                <div className="h-3 w-full animate-pulse rounded bg-surface-variant" />
                <div className="h-4 w-24 animate-pulse rounded bg-surface-variant" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleServices.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-muted">مفيش خدمات في الفئة دي دلوقتي</p>
          <Link href="/support" className="mt-3 inline-block text-primary hover:underline">
            مشكلتك مش من ضمن اللي فوق؟ كلّمنا
          </Link>
        </div>
      ) : (
        // شبكة مش قايمة عمودية: الكارت دلوقتي بصورة عريضة، وعمود واحد على الديسكتوب
        // بيخلّي الكارت الواحد عرضه 768px وصورته شريط ضخم بلا داعي.
        <div className="motion-list grid gap-4 sm:grid-cols-2">
          {visibleServices.map((s) => (
            <ServiceCard key={s.id} service={s} />
          ))}
        </div>
      )}
    </div>
  );
}
