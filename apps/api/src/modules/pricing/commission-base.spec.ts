import {
  computeCommissionableBase,
  DEFAULT_COMMISSION_BASE_POLICY,
  OrderRevenueComponents,
  splitEstimatedTotal,
  splitOrderRevenue,
} from './commission-base';

// السيناريو اللي المالك بلّغ عنه بالحرف (docs/08 §60.1): خدمة 1000ج، ضمان 200ج، عمولة 15%.
// قبل ADR-0037 الفني كان بياخد 85% من الـ1200 كلهم = 1020 (يعني 170ج من الضمان). المطلوب:
// الضمان 100% للشركة، فالفني ياخد 850 بس والشركة تاخد 350 (150 عمولة + 200 ضمان كامل).
const ownerScenario: OrderRevenueComponents = {
  basePriceCents: 100_000,
  levelPriceMultiplier: 1,
  estimatedTotalCents: 100_000,
  zoneSurgeCents: 0,
  inspectionFeeCents: 0,
  emergencySurchargeCents: 0,
  addonsTotalCents: 0,
  discountCents: 0,
  warrantyPriceCents: 20_000,
  installmentInterestCents: 0,
};

describe('أساس العمولة (ADR-0037)', () => {
  it('بلاغ المالك: الضمان بقى 100% للشركة، والفني بياخد على سعر الشغل بس', () => {
    const totalAmountCents = 120_000;
    const { commissionableBaseCents } = computeCommissionableBase(ownerScenario, DEFAULT_COMMISSION_BASE_POLICY);
    expect(commissionableBaseCents).toBe(100_000);

    const split = splitOrderRevenue({ totalAmountCents, commissionableBaseCents, commissionRatePercentage: 15 });
    expect(split.technicianEarningCents).toBe(85_000);
    expect(split.platformCommissionCents).toBe(35_000);
    // السلوك القديم للمقارنة: 1200 × 85% = 1020 — الفني كان بياخد 170ج من الضمان.
    expect(split.technicianEarningCents).not.toBe(102_000);
  });

  // **الاختبار ده كان بيقفل على خط أنابيب مش موجود** (docs/08 §145): كان مفترض إن زيادة
  // المنطقة بتتضرب **بعد** الإجمالي، فكان بيمرّر `estimatedTotalCents` أكبر ويستنتج الزيادة
  // بالطرح. الحقيقة إن `catalog.service.ts` بيطبّق زيادة المنطقة **جوّه** `base_price_cents`
  // نفسه. النتيجة إن الاختبار كان بيعدّي وهو بيوصف حاجة تانية خالص، والبقّة الحقيقية (قصّ
  // الحد الأدنى بيتحسب «زيادة منطقة» ويتشال من مستحق الفني) عدّت من تحته.
  it('زيادة المنطقة معلنة صراحةً وبتتشال من الوعاء، ومضاعف المستوى بيفضل للفني', () => {
    const components: OrderRevenueComponents = {
      ...ownerScenario,
      // 1000 × 1.1 (منطقة) = 1100 هو base_price_cents، وزيادة المنطقة 100 معلنة لوحدها.
      basePriceCents: 110_000,
      zoneSurgeCents: 10_000,
      levelPriceMultiplier: 1.2,
      // 1100 × 1.2 = 1320
      estimatedTotalCents: 132_000,
      warrantyPriceCents: 0,
    };
    const parts = splitEstimatedTotal(components);
    expect(parts.workPriceCents).toBe(100_000);
    expect(parts.levelPremiumCents).toBe(22_000);
    expect(parts.zoneSurgeCents).toBe(10_000);
    expect(parts.workPriceCents + parts.levelPremiumCents + parts.zoneSurgeCents).toBe(132_000);

    const { commissionableBaseCents } = computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY);
    // 1000 (شغل) + 220 (مستوى الفني) = 1220 — الـ100ج بتاعت المنطقة بره الوعاء.
    expect(commissionableBaseCents).toBe(122_000);
  });

  // بلاغ المالك بالحرف (ORD-2026-000683): خدمة سعر معادلتها صفر وحدها الأدنى 120ج.
  it('السعر اللي كله جاي من الحد الأدنى بيفضل مستحق فني — مش عمولة منصة', () => {
    const components: OrderRevenueComponents = {
      ...ownerScenario,
      basePriceCents: 0,
      estimatedTotalCents: 12_000,
      warrantyPriceCents: 0,
    };
    const parts = splitEstimatedTotal(components);
    expect(parts.workPriceCents).toBe(12_000);
    expect(parts.zoneSurgeCents).toBe(0);

    const { commissionableBaseCents } = computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY);
    expect(commissionableBaseCents).toBe(12_000);

    const split = splitOrderRevenue({ totalAmountCents: 12_000, commissionableBaseCents, commissionRatePercentage: 20 });
    expect(split.technicianEarningCents).toBe(9_600);
    expect(split.platformCommissionCents).toBe(2_400);
    // السلوك المكسور اللي المالك شافه: الفني صفر والمنصة بتاخد الـ120 كلها.
    expect(split.technicianEarningCents).not.toBe(0);
  });

  it('تفكيك الإجمالي بيجمع للإجمالي بالظبط حتى لما حدود min/max تقصّ الناتج', () => {
    // مسار FORMULA: 1000 × 1.5 = 1500 بس max_price_cents قصّها على 1100.
    const parts = splitEstimatedTotal({
      ...ownerScenario,
      levelPriceMultiplier: 1.5,
      estimatedTotalCents: 110_000,
    });
    expect(parts.workPriceCents + parts.levelPremiumCents + parts.zoneSurgeCents).toBe(110_000);
    expect(parts.zoneSurgeCents).toBe(0);
    expect(parts.levelPremiumCents).toBe(10_000);
    // القصّ بينقص من زيادة المستوى، وسعر الشغل بيفضل كامل — الفني مايتحاسبش على قصّ إداري.
    expect(parts.workPriceCents).toBe(100_000);
  });

  it('رسوم الطوارئ بره الوعاء افتراضيًا، وبتدخل لو الأدمن غيّر السياسة', () => {
    const components: OrderRevenueComponents = { ...ownerScenario, warrantyPriceCents: 0, emergencySurchargeCents: 30_000 };
    expect(computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY).commissionableBaseCents).toBe(100_000);
    expect(
      computeCommissionableBase(components, { ...DEFAULT_COMMISSION_BASE_POLICY, includeEmergencySurcharge: true })
        .commissionableBaseCents,
    ).toBe(130_000);
  });

  it('بلاغ المالك (ADR-0038): كوبون 50% — الفني بياخد مستحقه من السعر الأصلي، مش من اللي العميل دفعه', () => {
    // خدمة 1000، كوبون 50% → العميل يدفع 500. عمولة 15%.
    const components: OrderRevenueComponents = { ...ownerScenario, warrantyPriceCents: 0, discountCents: 50_000 };
    const totalAmountCents = 50_000;

    const { commissionableBaseCents } = computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY);
    // الوعاء = 1000 كامل، **مش** 500. الخصم تكلفة تسويق على المنصة.
    expect(commissionableBaseCents).toBe(100_000);

    const split = splitOrderRevenue({ totalAmountCents, commissionableBaseCents, commissionRatePercentage: 15 });
    expect(split.technicianEarningCents).toBe(85_000);
    // نصيب المنصة سالب — دفعت 350ج من جيبها. رقم صحيح ومقصود، مش خطأ بيانات.
    expect(split.platformCommissionCents).toBe(-35_000);
    // الثابت الجبري لسه محفوظ، وده اللي بيخلّي حركة المحفظة تشتغل صح بلا أي تعديل.
    expect(split.technicianEarningCents + split.platformCommissionCents).toBe(totalAmountCents);
  });

  it('الخصم لا يغيّر وعاء الفني تحت أي إعدادات أخرى', () => {
    const components: OrderRevenueComponents = { ...ownerScenario, warrantyPriceCents: 0, discountCents: 50_000 };
    const base = computeCommissionableBase(components, {
      ...DEFAULT_COMMISSION_BASE_POLICY,
      includeEmergencySurcharge: true,
    });
    expect(base.commissionableBaseCents).toBe(100_000);
  });

  it('الثابت المحاسبي: نصيب الفني + نصيب الشركة = الإجمالي، في كل الحالات', () => {
    const cases = [
      { totalAmountCents: 120_000, commissionableBaseCents: 100_000, commissionRatePercentage: 15 },
      { totalAmountCents: 0, commissionableBaseCents: 0, commissionRatePercentage: 15 },
      { totalAmountCents: 33_333, commissionableBaseCents: 33_333, commissionRatePercentage: 33 },
      { totalAmountCents: 100_000, commissionableBaseCents: 100_000, commissionRatePercentage: 100 },
    ];
    for (const input of cases) {
      const { technicianEarningCents, platformCommissionCents } = splitOrderRevenue(input);
      expect(technicianEarningCents + platformCommissionCents).toBe(input.totalAmountCents);
      expect(technicianEarningCents).toBeGreaterThanOrEqual(0);
    }
  });
});
