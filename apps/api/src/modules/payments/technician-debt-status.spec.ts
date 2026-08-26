import { assessTechnicianDebt, DEFAULT_DEBT_POLICY } from './technician-debt-status';

// ADR-0041 / docs/08 §63.أ2 — نص المالك: «الفلوس دول مفتوحة كده عنده في الظل بين إن الراجل ده
// عايز فلوس وما بيدفعهاش، عشان لو كان بياخد فلوس الشركة نعمله وضع إنذار».

const NOW = new Date('2026-08-26T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('حالة مديونية الفني (ADR-0041)', () => {
  it('رصيد موجب: مفيش دَين خالص', () => {
    const a = assessTechnicianDebt(120_000, null, DEFAULT_DEBT_POLICY, NOW);
    expect(a.status).toBe('none');
    expect(a.debtCents).toBe(0);
  });

  it('رصيد صفر: مفيش دَين (مش دَين بصفر)', () => {
    expect(assessTechnicianDebt(0, null, DEFAULT_DEBT_POLICY, NOW).status).toBe('none');
  });

  it('مبلغ صغير من يومين: طبيعي تمامًا — ok', () => {
    const a = assessTechnicianDebt(-20_000, daysAgo(2), DEFAULT_DEBT_POLICY, NOW);
    expect(a.status).toBe('ok');
    expect(a.debtCents).toBe(20_000);
    expect(a.ageDays).toBe(2);
  });

  it('مبلغ كبير بس من ساعة (فني لسه مخلّص طلب كاش كبير): watch مش alert', () => {
    const a = assessTechnicianDebt(-300_000, daysAgo(0), DEFAULT_DEBT_POLICY, NOW);
    expect(a.status).toBe('watch');
    expect(a.exceedsAmount).toBe(true);
    expect(a.exceedsAge).toBe(false);
  });

  it('مبلغ صغير بس من شهرين: watch — قديم لكن مش كبير', () => {
    const a = assessTechnicianDebt(-15_000, daysAgo(60), DEFAULT_DEBT_POLICY, NOW);
    expect(a.status).toBe('watch');
    expect(a.exceedsAmount).toBe(false);
    expect(a.exceedsAge).toBe(true);
  });

  it('**الحالة اللي المالك قلق منها**: مبلغ كبير + قديم = alert', () => {
    const a = assessTechnicianDebt(-300_000, daysAgo(45), DEFAULT_DEBT_POLICY, NOW);
    expect(a.status).toBe('alert');
    expect(a.exceedsAmount).toBe(true);
    expect(a.exceedsAge).toBe(true);
    expect(a.ageDays).toBe(45);
  });

  it('العتبات من إعدادات الأدمن مش ثوابت في الكود', () => {
    const strict = { alertThresholdCents: 1_000, alertAgeDays: 1 };
    // نفس الحالة اللي كانت ok بالعتبات الافتراضية بتبقى alert بعتبات أصرم
    expect(assessTechnicianDebt(-20_000, daysAgo(2), strict, NOW).status).toBe('alert');
  });

  it('دَين بلا تاريخ بداية معروف: بيتقيّم بالمبلغ بس بلا ما يرمي', () => {
    const a = assessTechnicianDebt(-300_000, null, DEFAULT_DEBT_POLICY, NOW);
    expect(a.ageDays).toBeNull();
    expect(a.exceedsAge).toBe(false);
    expect(a.status).toBe('watch');
  });

  it('على العتبة بالظبط مش فوقها: لسه ok (المقارنة صارمة)', () => {
    const a = assessTechnicianDebt(-DEFAULT_DEBT_POLICY.alertThresholdCents, daysAgo(1), DEFAULT_DEBT_POLICY, NOW);
    expect(a.exceedsAmount).toBe(false);
    expect(a.status).toBe('ok');
  });

  it('تاريخ بداية في المستقبل (ساعة سيرفر ملخبطة): العمر صفر مش سالب', () => {
    const a = assessTechnicianDebt(-20_000, new Date(NOW.getTime() + 86_400_000), DEFAULT_DEBT_POLICY, NOW);
    expect(a.ageDays).toBe(0);
  });
});
