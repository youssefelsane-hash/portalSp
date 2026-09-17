import { buildOrderPriceTrail, OrderPriceTrailExtras } from './order-price-trail';
import { Order } from './entities/order.entity';

/**
 * **مسار تكوين سعر العميل** (ADR-0107، بلاغ مالك 2026-09-17).
 *
 * المطلوب صراحةً: «يجب أن توجد اختبارات تثبت أن خطوات الـbreakdown تعيد بالضبط السعر المخزن،
 * وأن تعديل settings لاحقًا لا يغيّر طلبًا تاريخيًا، وأن manual selection وauto-match premium
 * لا يضاعفان نفس الزيادة مرتين».
 *
 * `buildOrderPriceTrail` **دالة نقية** بتقرا لقطة الطلب بس — مفيش استعلام ولا إعدادات. فده
 * الاختبار الصح ليها: وحدي، بلا قاعدة، بمدخلات صريحة. التحقق الحي إن اللقطة بتتكتب صح موجود
 * في `scripts/verify-order-price-trail.js`.
 */
const NO_EXTRAS: OrderPriceTrailExtras = { addonsTotalCents: 0, additionalItemsTotalCents: 0 };

/** طلب بأقل الحقول اللي الدالة بتقراها — الباقي مش داخل الحساب فمش محتاج يتزيّف. */
function orderWith(overrides: Partial<Order>): Order {
  return {
    id: 'order-1',
    estimatedPriceCents: 0,
    inspectionFeeCents: 0,
    surgeAmountCents: 0,
    warrantyPriceCents: 0,
    discountAmountCents: 0,
    totalAmountCents: 0,
    levelPremiumCents: 0,
    instapayDiscountCents: 0,
    assessmentFeeCreditCents: 0,
    pricingEngineRawCents: null,
    pricingZoneModifierPercentage: null,
    pricingZoneAdjustmentCents: null,
    pricingTierSnapshot: null,
    pricingMultiplierSource: null,
    pricingMultiplierSnapshot: null,
    pricingTierAdjustmentCents: null,
    pricingClampApplied: null,
    pricingClampDeltaCents: null,
    pricingWorkPriceCents: null,
    ...overrides,
  } as Order;
}

/** لقطة واقعية: 1000 ج ناتج محرك، +10% منطقة، ×1.25 فئة خبير، بلا قصّ. */
const REALISTIC_SNAPSHOT = {
  pricingEngineRawCents: 100_000,
  pricingZoneModifierPercentage: '10.00',
  pricingZoneAdjustmentCents: 10_000,
  pricingTierSnapshot: 'expert',
  pricingMultiplierSource: 'pricing_tier',
  pricingMultiplierSnapshot: '1.2500',
  pricingTierAdjustmentCents: 27_500, // 110000 × 1.25 = 137500 ⇒ +27500
  pricingClampApplied: null,
  pricingClampDeltaCents: 0,
  pricingWorkPriceCents: 137_500,
};

describe('مسار تكوين سعر العميل — كل جنيه مفسَّر من البيانات التاريخية (ADR-0107)', () => {
  it('مجموع المراحل = السعر المخزّن بالظبط، والتراكمي بيوصل للإجمالي', () => {
    const order = orderWith({
      ...REALISTIC_SNAPSHOT,
      estimatedPriceCents: 137_500,
      inspectionFeeCents: 15_000,
      surgeAmountCents: 0,
      warrantyPriceCents: 5_000,
      discountAmountCents: 7_500,
      totalAmountCents: 137_500 + 15_000 + 5_000 - 7_500,
    });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);

    // كل مرحلة تراكمية بالترتيب — أي انحراف في الترتيب بيكسر ده.
    expect(trail.stages.map((s) => [s.key, s.applied, s.amount_cents])).toEqual([
      ['engine_raw', true, 100_000],
      ['zone_adjustment', true, 10_000],
      ['pricing_tier_multiplier', true, 27_500],
      ['price_clamp', false, 0],
      ['inspection_fee', true, 15_000],
      ['emergency_surcharge', false, 0],
      ['addons', false, 0],
      ['warranty', true, 5_000],
      ['discount', true, -7_500],
    ]);
    expect(trail.total_at_booking_cents).toBe(150_000);
    expect(trail.current_total_cents).toBe(150_000);
    expect(trail.reconciles).toBe(true);
    expect(trail.unexplained_cents).toBe(0);
    // ومجموع المراحل المطبّقة = آخر تراكمي.
    const appliedSum = trail.stages.filter((s) => s.applied).reduce((a, s) => a + s.amount_cents, 0);
    expect(appliedSum).toBe(trail.total_at_booking_cents);
    expect(trail.stages[trail.stages.length - 1].running_total_cents).toBe(trail.total_at_booking_cents);
  });

  it('المراحل التلاتة التجارية بتجمع لسعر الشغل المخزّن (ما ينفعش الشرح يخالف اللقطة)', () => {
    const order = orderWith({ ...REALISTIC_SNAPSHOT, totalAmountCents: 137_500, estimatedPriceCents: 137_500 });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);
    const commercial = trail.stages
      .filter((s) => ['engine_raw', 'zone_adjustment', 'pricing_tier_multiplier', 'price_clamp'].includes(s.key))
      .filter((s) => s.applied)
      .reduce((a, s) => a + s.amount_cents, 0);
    expect(commercial).toBe(order.pricingWorkPriceCents);
  });

  it('**قصّ الحد الأدنى** بيظهر كمرحلة بقيمتها، مش مدفون في السعر', () => {
    // 100 ج ناتج، بلا منطقة، ×1، والحد الأدنى للخدمة 200 ج ⇒ القصّ رفع 100 ج.
    const order = orderWith({
      pricingEngineRawCents: 10_000,
      pricingZoneModifierPercentage: null,
      pricingZoneAdjustmentCents: 0,
      pricingMultiplierSource: 'none',
      pricingMultiplierSnapshot: '1.0000',
      pricingTierAdjustmentCents: 0,
      pricingClampApplied: 'min',
      pricingClampDeltaCents: 10_000,
      pricingWorkPriceCents: 20_000,
      estimatedPriceCents: 20_000,
      totalAmountCents: 20_000,
    });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);
    const clamp = trail.stages.find((s) => s.key === 'price_clamp')!;
    expect(clamp.applied).toBe(true);
    expect(clamp.amount_cents).toBe(10_000);
    expect(clamp.detail_ar).toContain('أقل من الحد الأدنى');
    expect(trail.reconciles).toBe(true);
  });

  it('**قصّ الحد الأقصى** بيظهر كمرحلة سالبة', () => {
    const order = orderWith({
      pricingEngineRawCents: 100_000,
      pricingZoneAdjustmentCents: 0,
      pricingMultiplierSource: 'pricing_tier',
      pricingMultiplierSnapshot: '2.0000',
      pricingTierSnapshot: 'expert',
      pricingTierAdjustmentCents: 100_000,
      pricingClampApplied: 'max',
      pricingClampDeltaCents: -50_000,
      pricingWorkPriceCents: 150_000,
      estimatedPriceCents: 150_000,
      totalAmountCents: 150_000,
    });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);
    const clamp = trail.stages.find((s) => s.key === 'price_clamp')!;
    expect(clamp.amount_cents).toBe(-50_000);
    expect(clamp.detail_ar).toContain('أعلى من الحد الأقصى');
    expect(trail.reconciles).toBe(true);
  });

  it('**الشرح تاريخي**: نفس اللقطة بتدي نفس الشرح مهما الإعدادات الحالية بقت إيه', () => {
    // الدالة نقية ومالهاش أي مصدر غير الطلب — فالإثبات إن نفس المدخل بيدي نفس المخرج بالظبط،
    // ومفيش أي مسار يقرا إعداد. (الإثبات الحي على القاعدة في verify-order-price-trail.js.)
    const order = orderWith({ ...REALISTIC_SNAPSHOT, estimatedPriceCents: 137_500, totalAmountCents: 137_500 });
    const first = buildOrderPriceTrail(order, NO_EXTRAS);
    const second = buildOrderPriceTrail(order, NO_EXTRAS);
    expect(second).toEqual(first);
    // والقيم في الشرح جايّة من اللقطة مش من أي مكان تاني:
    expect(first.stages.find((s) => s.key === 'zone_adjustment')!.detail_ar).toContain('10%');
    expect(first.stages.find((s) => s.key === 'pricing_tier_multiplier')!.detail_ar).toContain('×1.25');
    expect(first.stages.find((s) => s.key === 'pricing_tier_multiplier')!.detail_ar).toContain('خبير');
  });

  it('**مفيش تحصيل مزدوج**: الاختيار اليدوي مضاعفه في السعر، وبلا علاوة بعد الحجز', () => {
    const manual = orderWith({
      ...REALISTIC_SNAPSHOT,
      estimatedPriceCents: 137_500,
      totalAmountCents: 137_500,
      levelPremiumCents: 0, // مفيش علاوة — المضاعف داخل السعر من الأول
    });
    const trail = buildOrderPriceTrail(manual, NO_EXTRAS);
    expect(trail.stages.find((s) => s.key === 'pricing_tier_multiplier')!.applied).toBe(true);
    expect(trail.post_booking.find((c) => c.key === 'level_premium')).toBeUndefined();
    expect(trail.reconciles).toBe(true);
  });

  it('**مفيش تحصيل مزدوج**: التوزيع التلقائي بلا مضاعف في السعر، والعلاوة بعد الحجز', () => {
    // الفني مكانش معروف وقت التسعير ⇒ `multiplier_source = 'none'` و`tier_adjustment = 0`،
    // والزيادة جِت بعدين كـ`level_premium_cents`. لو الاتنين اتطبّقوا يبقى تحصيل مزدوج.
    const auto = orderWith({
      pricingEngineRawCents: 100_000,
      pricingZoneModifierPercentage: '10.00',
      pricingZoneAdjustmentCents: 10_000,
      pricingMultiplierSource: 'none',
      pricingMultiplierSnapshot: '1.0000',
      pricingTierAdjustmentCents: 0,
      pricingClampDeltaCents: 0,
      pricingWorkPriceCents: 110_000,
      estimatedPriceCents: 110_000,
      levelPremiumCents: 27_500,
      totalAmountCents: 110_000 + 27_500,
    });
    const trail = buildOrderPriceTrail(auto, NO_EXTRAS);

    const tierStage = trail.stages.find((s) => s.key === 'pricing_tier_multiplier')!;
    expect(tierStage.applied).toBe(false);
    expect(tierStage.amount_cents).toBe(0);
    expect(tierStage.detail_ar).toContain('مكانش معروف');

    const premium = trail.post_booking.find((c) => c.key === 'level_premium')!;
    expect(premium.amount_cents).toBe(27_500);
    expect(premium.source_ar).toContain('تحصيل مزدوج');

    // والإجمالي بيتفسّر بالكامل: سعر الحجز + العلاوة.
    expect(trail.total_at_booking_cents).toBe(110_000);
    expect(trail.reconciles).toBe(true);
    expect(trail.unexplained_cents).toBe(0);
  });

  it('توزيع المستحقات **مش** في المسار — معاملات أجر الفني مش عوامل رفعت سعر العميل', () => {
    const order = orderWith({ ...REALISTIC_SNAPSHOT, estimatedPriceCents: 137_500, totalAmountCents: 137_500 });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);
    const keys = [...trail.stages.map((s) => s.key), ...trail.post_booking.map((c) => c.key)].join(',');
    for (const forbidden of ['earning', 'assistant', 'worker_pool', 'commission']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('فرق غير مفسَّر بيتعلّم عليه صراحةً بدل ما الجدول يبان متماسك وهو ناقص', () => {
    const order = orderWith({
      ...REALISTIC_SNAPSHOT,
      estimatedPriceCents: 137_500,
      totalAmountCents: 200_000, // عرض سعر/شغل إضافي مش متسجّل كبند
    });
    const trail = buildOrderPriceTrail(order, NO_EXTRAS);
    expect(trail.reconciles).toBe(false);
    expect(trail.unexplained_cents).toBe(62_500);
    expect(trail.notes_ar.join(' ')).toContain('فرق بين مجموع المراحل والإجمالي المسجّل');
  });

  it('بنود الشغل الإضافي بتظهر كتغيير **بعد** الحجز، والإضافات كمرحلة حجز', () => {
    const order = orderWith({
      ...REALISTIC_SNAPSHOT,
      estimatedPriceCents: 137_500,
      totalAmountCents: 137_500 + 3_000 + 12_000,
    });
    const trail = buildOrderPriceTrail(order, { addonsTotalCents: 3_000, additionalItemsTotalCents: 12_000 });
    expect(trail.stages.find((s) => s.key === 'addons')!.amount_cents).toBe(3_000);
    expect(trail.total_at_booking_cents).toBe(137_500 + 3_000);
    expect(trail.post_booking.find((c) => c.key === 'additional_items')!.amount_cents).toBe(12_000);
    expect(trail.reconciles).toBe(true);
  });

  it('طلب قديم بلا لقطة: بيتعلّم عليه بوضوح، والرسوم لسه مفسَّرة', () => {
    const legacy = orderWith({
      estimatedPriceCents: 90_000,
      inspectionFeeCents: 10_000,
      totalAmountCents: 100_000,
    });
    const trail = buildOrderPriceTrail(legacy, NO_EXTRAS);
    expect(trail.formation_snapshot_available).toBe(false);
    expect(trail.notes_ar.join(' ')).toContain('قبل تسجيل لقطة مراحل التسعير');
    expect(trail.stages.find((s) => s.key === 'engine_raw')!.amount_cents).toBe(90_000);
    expect(trail.total_at_booking_cents).toBe(100_000);
  });
});
