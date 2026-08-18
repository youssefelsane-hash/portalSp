'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { fetchServices } from '@/lib/catalog';
import { ServiceDto } from '@/lib/api-types';
import { formatEgp } from '@/lib/orders';

// نفس ServicesScreen في customer-app (Script 3 Phase 2) — بيعرض كل خدمات الفئة، وضع الحجز بيتقرر
// بعدين في شاشة الخدمة نفسها لو الخدمة فعلاً بتدعم أكتر من وضع.
export default function CategoryServicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchServices(id)
      .then(setServices)
      .catch(() => setError('تعذّر تحميل الخدمات'));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">الخدمات</h1>
      {error ? (
        <p className="text-danger">{error}</p>
      ) : services === null ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-variant" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-muted">مفيش خدمات في الفئة دي دلوقتي</p>
          <Link href="/support" className="mt-3 inline-block text-primary hover:underline">
            مشكلتك مش من ضمن اللي فوق؟ كلّمنا
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <Link
              key={s.id}
              href={`/services/${s.id}`}
              className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 hover:border-primary"
            >
              <div>
                <p className="font-medium">{s.name_ar}</p>
                {s.short_description_ar && <p className="text-sm text-muted">{s.short_description_ar}</p>}
              </div>
              <span className="font-semibold text-primary">
                {s.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(s.base_price_cents)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
