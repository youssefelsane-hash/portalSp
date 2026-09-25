'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { SeoServiceListItem } from '@/lib/seo';

/** كام خدمة تبان في كل خطوة — طلب المالك: «عادي يعرض لك خمسة بخمسة بخمسة وهكذا». */
const STEP = 5;

/**
 * **قايمة خدمات الفوتر** (ADR-0113 §6).
 *
 * > «هم ممكن مع الوقت يبقوا كتير، فعايزين حاجة كأنهم ما يبقوش الفوتر طويل أوي… لازم تخش جواهم
 * > وتقعد مثلًا See More See More.»
 *
 * **كل الروابط في الـHTML من أول رندر، والمخفي مخفي بـ`hidden` بس.** لو كانوا بيتضافوا
 * بجافاسكريبت عند الدوس، الزاحف اللي مش بيشغّل JS مش هيشوف غير خمسة — وتبقى الميزة بتشتغل عكس
 * هدفها بالظبط. `hidden` بيشيلهم من العرض ومن شجرة الوصولية، وبيسيبهم في المصدر للزاحف.
 */
export function FooterServices({ services }: { services: SeoServiceListItem[] }) {
  const [visible, setVisible] = useState(STEP);
  const remaining = services.length - visible;

  if (services.length === 0) return null;

  return (
    <>
      <ul className="mt-4 space-y-3 text-sm" data-testid="footer-services">
        {services.map((service, index) => (
          <li key={service.slug} hidden={index >= visible}>
            <Link
              href={`/services/${service.slug}`}
              className="text-foreground/85 transition-colors hover:text-primary"
            >
              {service.name_ar}
            </Link>
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + STEP)}
          className="motion-press mt-3 text-sm font-semibold text-primary transition-opacity hover:opacity-80"
          data-testid="footer-services-more"
        >
          عرض المزيد ({remaining})
        </button>
      )}
    </>
  );
}
