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
    const { commissionableBaseCents } = computeCommissionableBase(
      ownerScenario,
      DEFAULT_COMMISSION_BASE_POLICY,
      totalAmountCents,
    );
    expect(commissionableBaseCents).toBe(100_000);

    const split = splitOrderRevenue({ totalAmountCents, commissionableBaseCents, commissionRatePercentage: 15 });
    expect(split.technicianEarningCents).toBe(85_000);
    expect(split.platformCommissionCents).toBe(35_000);
    // السلوك القديم للمقارنة: 1200 × 85% = 1020 — الفني كان بياخد 170ج من الضمان.
    expect(split.technicianEarningCents).not.toBe(102_000);
  });

  it('مضاعف مستوى الفني للفني، ومضاعف المنطقة/التضخم للشركة', () => {
    const components: OrderRevenueComponents = {
      ...ownerScenario,
      levelPriceMultiplier: 1.2,
      // 1000 × 1.2 (مستوى) × 1.1 (تضخم المنطقة) = 1320
      estimatedTotalCents: 132_000,
      warrantyPriceCents: 0,
    };
    const parts = splitEstimatedTotal(components);
    expect(parts.workPriceCents).toBe(100_000);
    expect(parts.levelPremiumCents).toBe(20_000);
    expect(parts.zoneSurgeCents).toBe(12_000);

    const { commissionableBaseCents } = computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY, 132_000);
    // 1000 (شغل) + 200 (مستوى الفني) = 1200 — الـ120ج بتاعت التضخم بره الوعاء.
    expect(commissionableBaseCents).toBe(120_000);
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
  });

  it('رسوم الطوارئ بره الوعاء افتراضيًا، وبتدخل لو الأدمن غيّر السياسة', () => {
    const components: OrderRevenueComponents = { ...ownerScenario, warrantyPriceCents: 0, emergencySurchargeCents: 30_000 };
    expect(computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY, 130_000).commissionableBaseCents).toBe(100_000);
    expect(
      computeCommissionableBase(
        components,
        { ...DEFAULT_COMMISSION_BASE_POLICY, includeEmergencySurcharge: true },
        130_000,
      ).commissionableBaseCents,
    ).toBe(130_000);
  });

  it('الخصم بيتحمّله نصيب الشركة افتراضيًا — الفني بياخد على سعر الشغل الكامل', () => {
    const components: OrderRevenueComponents = { ...ownerScenario, warrantyPriceCents: 0, discountCents: 20_000 };
    const totalAmountCents = 80_000;

    const { commissionableBaseCents } = computeCommissionableBase(components, DEFAULT_COMMISSION_BASE_POLICY, totalAmountCents);
    // الوعاء اتقصّ على الإجمالي — مينفعش نصيب الفني يزيد عن اللي العميل دفعه.
    expect(commissionableBaseCents).toBe(80_000);

    const withFlag = computeCommissionableBase(
      components,
      { ...DEFAULT_COMMISSION_BASE_POLICY, discountReducesTechnicianShare: true },
      totalAmountCents,
    );
    expect(withFlag.commissionableBaseCents).toBe(80_000);
  });

  it('الثابت المحاسبي: نصيب الفني + نصيب الشركة = الإجمالي، في كل الحالات', () => {
    const cases = [
      { totalAmountCents: 120_000, commissionableBaseCents: 100_000, commissionRatePercentage: 15 },
      { totalAmountCents: 0, commissionableBaseCents: 0, commissionRatePercentage: 15 },
      { totalAmountCents: 50_000, commissionableBaseCents: 999_999, commissionRatePercentage: 0 },
      { totalAmountCents: 33_333, commissionableBaseCents: 33_333, commissionRatePercentage: 33 },
      { totalAmountCents: 100_000, commissionableBaseCents: 100_000, commissionRatePercentage: 100 },
    ];
    for (const input of cases) {
      const { technicianEarningCents, platformCommissionCents } = splitOrderRevenue(input);
      expect(technicianEarningCents + platformCommissionCents).toBe(input.totalAmountCents);
      expect(technicianEarningCents).toBeGreaterThanOrEqual(0);
      expect(platformCommissionCents).toBeGreaterThanOrEqual(0);
    }
  });
});
