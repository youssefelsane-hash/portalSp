import {
  assertBreakdownInvariant,
  computeInstallmentBreakdown,
} from './installment-calculator';

// مصفوفة حسابات التقسيط — الثابت الحاكم: مقدم + مجموع الأقساط === الإجمالي الممول بالقرش بالتمام
// (ولا قرش يضيع ولا يتخترع بسبب التقريب). كل الحالات المطلوبة من المالك مغطاة هنا.
describe('installment-calculator — الحسابات المالية المرجعية', () => {
  const plan = (overrides: Partial<Parameters<typeof computeInstallmentBreakdown>[1]> = {}) => ({
    installmentCount: 6,
    financingPercentage: 0,
    fixedFeeCents: 0,
    downPaymentPercentage: 0,
    ...overrides,
  });

  function expectInvariant(priceCents: number, p: Parameters<typeof computeInstallmentBreakdown>[1]) {
    const b = computeInstallmentBreakdown(priceCents, p);
    assertBreakdownInvariant(b); // لو انتهكت بترمي — الاختبار يفشل برسالة واضحة
    expect(b.installmentAmountsCents).toHaveLength(p.installmentCount);
    return b;
  }

  it('مثال المالك المرجعي: 10,000ج، تمويل 12%، مقدم، 6 شهور', () => {
    const b = computeInstallmentBreakdown(1_000_000, plan({ installmentCount: 6, financingPercentage: 12, downPaymentPercentage: 17.86 }));
    expect(b.financingFeeCents).toBe(120_000); // 1,200 ج
    expect(b.totalFinancedCents).toBe(1_120_000); // 11,200 ج
    // المقدم = round(11,200 × 17.86%) = 200,032 ≈ 2,000 ج (النسبة اللي العميل هيشوفها محسوبة من الإجمالي)
    expect(b.downPaymentCents).toBe(toExactCents(1_120_000, 17.86));
    expect(b.financedBalanceCents).toBe(b.totalFinancedCents - b.downPaymentCents);
    // 9,199.68 → 6 أقساط منتظمة floor + الأخير بيستوعب الباقي
    expect(b.regularInstallmentAmountCents).toBe(Math.floor(b.financedBalanceCents / 6));
    const final = b.installmentAmountsCents[5];
    expect(b.downPaymentCents + b.installmentAmountsCents.reduce((s, a) => s + a, 0)).toBe(b.totalFinancedCents);
    expect(final >= b.regularInstallmentAmountCents).toBe(true);
    expectInvariant(1_000_000, plan({ installmentCount: 6, financingPercentage: 12, downPaymentPercentage: 17.86 }));
  });

  function toExactCents(totalCents: number, pct: number): number {
    return Math.round((totalCents * pct) / 100);
  }

  it('تمويل صفر (0%): الإجمالي = السعر بالحرف', () => {
    const b = expectInvariant(500_000, plan({ installmentCount: 3 }));
    expect(b.financingFeeCents).toBe(0);
    expect(b.totalFinancedCents).toBe(500_000);
    expect(b.installmentAmountsCents).toEqual([166_666, 166_666, 166_668]); // 500,000/3 — الباقي على الأخير
  });

  it('نسبة تمويل غير صحيحة (12.5%): تقريب لأقرب قرش', () => {
    const b = expectInvariant(333_333, plan({ installmentCount: 9, financingPercentage: 12.5 }));
    expect(b.financingFeeCents).toBe(Math.round((333_333 * 12.5) / 100));
  });

  it('رسم ثابت فقط (بلا نسبة): fee = fixedFeeCents', () => {
    const b = expectInvariant(100_000, plan({ installmentCount: 4, fixedFeeCents: 5_000 }));
    expect(b.financingFeeCents).toBe(5_000);
    expect(b.totalFinancedCents).toBe(105_000);
  });

  it('نسبة + رسم ثابت مع بعض: بيتجمعوا', () => {
    const b = expectInvariant(200_000, plan({ installmentCount: 6, financingPercentage: 10, fixedFeeCents: 2_500 }));
    expect(b.financingFeeCents).toBe(20_000 + 2_500);
    expect(b.totalFinancedCents).toBe(222_500);
  });

  it('مقدم + أقساط (قسمة غير سليمة): الفرق كله على القسط الأخير', () => {
    const b = expectInvariant(999_999, plan({ installmentCount: 3, downPaymentPercentage: 10 }));
    // 999,999 → total 999,999 → down 100,000 → balance 899,999 → 299,999×2 + 300,001
    expect(b.installmentAmountsCents).toEqual([299_999, 299_999, 300_001]);
    expect(b.downPaymentCents + 299_999 * 2 + 300_001).toBe(999_999);
  });

  it('المبلغ كله مقسوم بالتساوي بلا مقدم', () => {
    const b = expectInvariant(900_000, plan({ installmentCount: 9 }));
    expect(b.installmentAmountsCents).toEqual(Array(9).fill(100_000));
  });

  it('قسط واحد = الدفع دفعة واحدة ممولة', () => {
    const b = expectInvariant(123_457, plan({ installmentCount: 1 }));
    expect(b.installmentAmountsCents).toEqual([123_457]);
  });

  it('مبلغ صغير جدًا (قرشين على قسطين): floor ممكن ينتج صفر منتظم والأخير يحمل الكل', () => {
    // 2 قرش على قسطين: منتظم = 1، الأخير = 1 — سليم
    const twoCents = expectInvariant(2, plan({ installmentCount: 2 }));
    expect(twoCents.installmentAmountsCents).toEqual([1, 1]);
    // قرش واحد على قسطين: الحساب نفسه بينتج [0,1] لكن الثابت الحاكم بيرفضه (قسط بصفر) —
    // الرفض الفعلي بيحصل في السيرفس قبل إنشاء أي صفوف.
    expect(() => assertBreakdownInvariant(computeInstallmentBreakdown(1, plan({ installmentCount: 2 })))).toThrow(/ثابت|صفر/);
  });

  it('مبلغ كبير جدًا (مليار قرش): صفر انحراف في التقريب', () => {
    const b = expectInvariant(1_000_000_007, plan({ installmentCount: 7, financingPercentage: 13.75, downPaymentPercentage: 20 }));
    const sum = b.installmentAmountsCents.reduce((s, a) => s + a, 0);
    expect(b.downPaymentCents + sum).toBe(b.totalFinancedCents);
    expect(Number.isSafeInteger(b.totalFinancedCents)).toBe(true);
  });

  it('حد أدنى/أقصى للأهلية: فحص النطاق منفصل عن الحساب', async () => {
    // eligibility فحص مستقبلًا في السيرفس — هنا بنثبت إن الحساب نفسه محايد والرفض هيكون بالنطاق
    const { isAmountWithinPlanLimits } = await import('./installment-calculator');
    expect(isAmountWithinPlanLimits(50_000, { minOrderAmountCents: 100_000, maxOrderAmountCents: null })).toBe(false);
    expect(isAmountWithinPlanLimits(150_000, { minOrderAmountCents: 100_000, maxOrderAmountCents: null })).toBe(true);
    expect(isAmountWithinPlanLimits(2_000_000, { minOrderAmountCents: 100_000, maxOrderAmountCents: 1_000_000 })).toBe(false);
    expect(isAmountWithinPlanLimits(100_000, { minOrderAmountCents: null, maxOrderAmountCents: null })).toBe(true);
  });

  it('مدخلات مرفوضة: سعر/عدد أقساط غير منطقي', () => {
    expect(() => computeInstallmentBreakdown(0, plan())).toThrow();
    expect(() => computeInstallmentBreakdown(-5, plan())).toThrow();
    expect(() => computeInstallmentBreakdown(1.5 as never, plan())).toThrow();
    expect(() => computeInstallmentBreakdown(100_000, plan({ installmentCount: 0 }))).toThrow();
    expect(() => computeInstallmentBreakdown(100_000, plan({ installmentCount: 61 }))).toThrow();
  });
});
