'use client';

import type { PhoneRoutingState } from '@/lib/phone-registration-routing';

/** سطر التوجيه (docs/08 §189 UX-2): بيقول هيحصل إيه، وبيدّي اختيارين واضحين بدل انتقال مفاجئ. */
export function PhoneRoutingNotice({ routing, goLabel }: { routing: PhoneRoutingState; goLabel: string }) {
  if (!routing.notice) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="phone-routing-notice"
      className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 text-sm"
    >
      <p>{routing.notice}</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="phone-routing-go"
          onClick={routing.goNow}
          className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
        >
          {goLabel}
        </button>
        <button
          type="button"
          data-testid="phone-routing-stay"
          onClick={routing.stay}
          className="px-2 py-1.5 text-muted underline-offset-4 hover:underline"
        >
          لا، خليني هنا
        </button>
      </div>
    </div>
  );
}
