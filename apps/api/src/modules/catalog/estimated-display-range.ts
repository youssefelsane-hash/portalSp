import { PriceCertaintyMode, Service } from './entities/service.entity';

export interface EstimatedDisplayRange {
  display_price_min_cents: number | null;
  display_price_max_cents: number | null;
}

/**
 * النطاق التقديري اللي بيتعرض للعميل (بند 10/30، ADR-0063).
 *
 * **مش حدود قصّ.** `min_price_cents`/`max_price_cents` فاضلين قصّ صلب بيتطبّق على السعر نفسه
 * (بند 29 بيمنع إعادة استخدامهم كنطاق عرض). الدالة دي بتشتغل على `estimatedTotalCents` **بعد**
 * ما القصّ اتطبّق، فالنطاق الناتج بيفضل جوّه الحدود دايمًا.
 *
 * ترتيب المصادر:
 *   1. نسبة حوالين السعر المحسوب فعلاً للمدخلات دي — النطاق «الديناميكي» اللي ADR-0063 طالب بيه.
 *   2. الحقول الثابتة `display_price_min/max_cents` — fallback بالحرف زي ما الـADR بيقول.
 *   3. `null` — الخدمة مش «نطاق تقديري» أصلاً، فمفيش نطاق يتعرض.
 *
 * النطاق للخدمات `estimated_range` بس: خدمة سعرها مؤكد لو عرضت نطاق تبقى بتقلّل ثقة العميل في
 * رقم هو أصلاً نهائي.
 */
export function estimatedDisplayRange(
  service: Pick<
    Service,
    'priceCertaintyMode' | 'rangePercentBelow' | 'rangePercentAbove' | 'displayPriceMinCents' | 'displayPriceMaxCents'
  >,
  estimatedTotalCents: number,
): EstimatedDisplayRange {
  if (service.priceCertaintyMode !== PriceCertaintyMode.ESTIMATED_RANGE) {
    return { display_price_min_cents: null, display_price_max_cents: null };
  }

  const below = service.rangePercentBelow === null ? null : Number(service.rangePercentBelow);
  const above = service.rangePercentAbove === null ? null : Number(service.rangePercentAbove);
  // القيد في الداتابيز بيضمن إن الاتنين موجودين أو ولا واحد، بس الفحص هنا برضه عشان الدالة
  // تفضل صح لو اتنادت على بيانات جاية من غير الجدول (اختبار، seed، استيراد).
  if (below === null || above === null || !Number.isFinite(below) || !Number.isFinite(above)) {
    return {
      display_price_min_cents: service.displayPriceMinCents,
      display_price_max_cents: service.displayPriceMaxCents,
    };
  }

  return {
    display_price_min_cents: Math.max(0, Math.round(estimatedTotalCents * (1 - below / 100))),
    display_price_max_cents: Math.round(estimatedTotalCents * (1 + above / 100)),
  };
}
