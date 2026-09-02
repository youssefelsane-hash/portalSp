import { PriceCertaintyMode, Service } from './entities/service.entity';
import { estimatedDisplayRange } from './estimated-display-range';

type RangeInput = Parameters<typeof estimatedDisplayRange>[0];

function svc(over: Partial<RangeInput> = {}): RangeInput {
  return {
    priceCertaintyMode: PriceCertaintyMode.ESTIMATED_RANGE,
    rangePercentBelow: null,
    rangePercentAbove: null,
    displayPriceMinCents: null,
    displayPriceMaxCents: null,
    ...over,
  } as Service;
}

/**
 * بند 10 — النطاق التقديري لازم يتحرّك مع السعر المحسوب، مش يفضل رقمين ثابتين.
 *
 * وبند 29 — النطاق ده **مش** حدود القصّ: بيتحسب على السعر **بعد** ما القصّ اتطبّق، فبيفضل
 * جوّه الحدود دايمًا.
 */
describe('النطاق التقديري المعروض (بند 10/29/30)', () => {
  it('بيتحسب حوالين السعر المحسوب فعلاً — فبيتغيّر مع حجم الشغل', () => {
    const service = svc({ rangePercentBelow: '10', rangePercentAbove: '20' });

    expect(estimatedDisplayRange(service, 100_000)).toEqual({
      display_price_min_cents: 90_000,
      display_price_max_cents: 120_000,
    });
    // نفس الخدمة، شغل أكبر → نطاق أكبر. ده بالظبط اللي الحقول الثابتة ماكانتش بتعمله.
    expect(estimatedDisplayRange(service, 300_000)).toEqual({
      display_price_min_cents: 270_000,
      display_price_max_cents: 360_000,
    });
  });

  it('من غير نسب بيرجع للحقول الثابتة — صفر تغيير سلوك للخدمات القايمة', () => {
    expect(
      estimatedDisplayRange(svc({ displayPriceMinCents: 50_000, displayPriceMaxCents: 80_000 }), 100_000),
    ).toEqual({ display_price_min_cents: 50_000, display_price_max_cents: 80_000 });
  });

  it('نسبة واحدة بس بتترفض للاحتياطي — نص نطاق مش نطاق', () => {
    expect(
      estimatedDisplayRange(
        svc({ rangePercentBelow: '10', rangePercentAbove: null, displayPriceMinCents: 1, displayPriceMaxCents: 2 }),
        100_000,
      ),
    ).toEqual({ display_price_min_cents: 1, display_price_max_cents: 2 });
  });

  it('خدمة سعرها مؤكد مالهاش نطاق خالص — حتى لو النسب متظبطة', () => {
    expect(
      estimatedDisplayRange(
        svc({ priceCertaintyMode: PriceCertaintyMode.CONFIRMED_PRICE, rangePercentBelow: '10', rangePercentAbove: '20' }),
        100_000,
      ),
    ).toEqual({ display_price_min_cents: null, display_price_max_cents: null });
  });

  it('خدمة «يحتاج تقييم» مالهاش نطاق — مفيش سعر محسوب أصلاً', () => {
    expect(
      estimatedDisplayRange(
        svc({ priceCertaintyMode: PriceCertaintyMode.ASSESSMENT_REQUIRED, rangePercentBelow: '10', rangePercentAbove: '20' }),
        0,
      ),
    ).toEqual({ display_price_min_cents: null, display_price_max_cents: null });
  });

  it('النطاق مابينزلش تحت الصفر مهما كانت النسبة', () => {
    expect(
      estimatedDisplayRange(svc({ rangePercentBelow: '99.99', rangePercentAbove: '0' }), 100),
    ).toEqual({ display_price_min_cents: 0, display_price_max_cents: 100 });
  });

  it('السعر المُقصّ هو المدخل — فالنطاق بيفضل جوّه حدود القصّ (بند 29)', () => {
    // السعر الخام كان 500000 والقصّ نزّله لـ200000؛ الدالة بتاخد المُقصّ.
    const clampedTotal = 200_000;
    const range = estimatedDisplayRange(svc({ rangePercentBelow: '10', rangePercentAbove: '10' }), clampedTotal);
    expect(range.display_price_min_cents).toBe(180_000);
    expect(range.display_price_max_cents).toBe(220_000);
  });
});
