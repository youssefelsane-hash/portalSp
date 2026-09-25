'use client';

import { useState } from 'react';

/**
 * **«احجز الخدمة مع أسطى»** — طلب المالك بالنص (ADR-0113).
 *
 * > «في أي صفحة من دول من أولها من فوق كده، بيكون ظهر فيها بيانات التواصل وظهر فيها بالبنط
 * > العريض كده: احجز الخدمة مع أسطى. مجرد ما يدوس عليها، بيظهر فعلاً زرار كبير: احجز الخدمة
 * > حالًا مع أسطى، واسم الخدمة.»
 *
 * سطر عريض بيتدوس ⇒ زرار كبير. **الزرار موجود في الـHTML من الأول ومخفي بصريًا** مش بيتولّد
 * بجافاسكريبت: الزاحف لازم يشوف الرابط عشان يربط الصفحة بمسار الحجز — وده كل الغرض من الصفحة.
 */
export function BookingCta({
  serviceName,
  bookingHref,
  areaName,
}: {
  serviceName: string;
  bookingHref: string;
  areaName?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = areaName ? `احجز ${serviceName} في ${areaName} حالًا مع أسطى` : `احجز ${serviceName} حالًا مع أسطى`;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="booking-cta-action"
        className="motion-press flex w-full items-center justify-between gap-3 text-start"
        data-testid="booking-cta-toggle"
      >
        <span className="text-lg font-extrabold text-foreground sm:text-xl">احجز الخدمة مع أسطى</span>
        <span aria-hidden className={`text-accent transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {/* `hidden` بدل ما الزرار مايتعرضش خالص: بيفضل في الـDOM فالزاحف يشوف الرابط. */}
      <div id="booking-cta-action" hidden={!open} className="mt-4">
        <a
          href={bookingHref}
          className="motion-press block rounded-xl bg-accent px-5 py-4 text-center text-base font-bold text-accent-foreground transition-opacity hover:opacity-90 sm:text-lg"
          data-testid="booking-cta-link"
        >
          {label}
        </a>
        <p className="mt-2 text-center text-xs text-muted">
          هنوصّلك لتطبيق أسطى تكمّل الحجز وتشوف السعر قبل ما تأكّد.
        </p>
      </div>
    </div>
  );
}
