'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { fetchServices } from '@/lib/catalog';
import { ServiceDto } from '@/lib/api-types';
import { formatEgp } from '@/lib/orders';
import { useCatalogZone } from '@/lib/catalog-zone';

// نفس ServicesScreen في customer-app (Script 3 Phase 2) — بيعرض كل خدمات الفئة، وضع الحجز بيتقرر
// بعدين في شاشة الخدمة نفسها لو الخدمة فعلاً بتدعم أكتر من وضع.
export default function CategoryServicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const catalogZone = useCatalogZone();
  const [services, setServices] = useState<ServiceDto[] | null>(null);
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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">الخدمات</h1>
      {visibleError ? (
        <p className="text-danger">{visibleError}</p>
      ) : visibleServices === null ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-variant" />
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
        <div className="space-y-3">
          {visibleServices.map((s) => (
            <Link
              key={s.id}
              href={`/services/${s.id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4 hover:border-primary"
            >
              <div className="flex items-center gap-4">
                {s.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- صور خدمات خارجية من التخزين، مش أصول ثابتة معروفة وقت الـbuild
                  <img src={s.icon_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-lg bg-surface-variant" />
                )}
                <div>
                  <p className="font-medium">{s.name_ar}</p>
                  {s.short_description_ar && <p className="text-sm text-muted">{s.short_description_ar}</p>}
                </div>
              </div>
              <span className="shrink-0 font-semibold text-primary">
                {s.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(s.base_price_cents)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
