import Link from 'next/link';

/**
 * زر الحجز ظاهر من أول تحميل الصفحة، وينقل مباشرة إلى مسار الحجز على الويب.
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
  const label = areaName ? `احجز ${serviceName} في ${areaName} حالًا مع أسطى` : `احجز ${serviceName} حالًا مع أسطى`;

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4 sm:p-5">
      <p className="mb-3 text-lg font-extrabold text-foreground sm:text-xl">احجز الخدمة مع أسطى</p>
      <Link
        href={bookingHref}
        className="motion-press block rounded-xl bg-accent px-5 py-4 text-center text-base font-bold text-accent-foreground transition-opacity hover:opacity-90 sm:text-lg"
        data-testid="booking-cta-link"
        aria-label={label}
      >
        احجز الآن
      </Link>
      <p className="mt-2 text-center text-xs text-muted">
        اختَر تفاصيل الخدمة وشوف السعر على الموقع قبل تأكيد الحجز.
      </p>
    </div>
  );
}
