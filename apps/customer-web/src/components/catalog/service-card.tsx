import Link from 'next/link';
import { ServiceDto } from '@/lib/api-types';
import { formatEgp } from '@/lib/orders';
import { CatalogImage } from './catalog-image';

/// نظير `apps/customer-app/lib/features/catalog/service_card.dart` بالحرف.
///
/// بلاغ المالك 2026-09-11: «لما أدوس على الفئة، المفروض يعرض الخدمات بصورة كبيرة واضحة
/// والوصف تحتها — نفس تصميم الأندرويد».
///
/// الويب كان لسه على الشكل القديم اللي **الأندرويد نفسه اترفض عليه واتعاد بناؤه** (docs/08 §72):
/// صورة 56×56 على الجنب، فالعنوان والوصف محصورين في عمود ضيّق بين الصورة والسعر. بلاغ المالك
/// وقتها بالحرف: «الكلام كله متركز… الكلام مش متاخد بالطول». الأندرويد اتصلح، والويب فضل
/// على الشكل المرفوض — فجوة توازي مش قرار تصميم.
///
/// دلوقتي: **شريط صورة 3:1 بعرض الكارت كله فوق**، بعده الاسم (سطرين) والوصف (تلات أسطر)
/// والسعر في سطر مستقل — نفس نِسَب وحدود الأندرويد بالرقم.
export function ServiceCard({ service }: { service: ServiceDto }) {
  const description = service.short_description_ar?.trim();
  const priceLabel =
    service.pricing_model === 'formula' ? 'يُحسب حسب التفاصيل' : formatEgp(service.base_price_cents);

  return (
    <Link
      href={`/services/${service.id}`}
      className="motion-rise motion-press group block overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-primary"
    >
      {/* الصورة ملزوقة في حواف الكارت من فوق، فمالهاش حواف مدوّرة خاصة بيها — نفس الأندرويد. */}
      <CatalogImage
        src={service.icon_url}
        aspect="3 / 1"
        rounded="rounded-none"
        icon="service"
        sizeHint="(max-width: 768px) 100vw, 720px"
      />
      <div className="p-4">
        <p className="line-clamp-2 font-semibold leading-snug text-foreground group-hover:text-primary">
          {service.name_ar}
        </p>
        {description && <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted">{description}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="truncate font-bold text-primary">{priceLabel}</span>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
