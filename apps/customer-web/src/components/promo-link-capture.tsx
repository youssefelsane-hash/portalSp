'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { rememberPendingPromoLinkCode } from '@/lib/promo-link';

/** يلتقط `?p=CODE` من رابط QR مرة واحدة ويحفظه طوال رحلة العميل داخل التبويب الحالي. */
export function PromoLinkCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('p');
    if (code) rememberPendingPromoLinkCode(code, searchParams.get('pd') !== '0');
  }, [searchParams]);

  return null;
}
