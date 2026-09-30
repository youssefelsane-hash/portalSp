import { recurringOccurrenceCancelNotice } from './recurring-occurrence-notice.util';

// D-1: الإلغاء لازم يقول «النوبة دي بس» + حالة الخطة + الجاية امتى — مش «إلغاء تلقائي» وخلاص.
describe('recurringOccurrenceCancelNotice', () => {
  const next = new Date(Date.UTC(2026, 9, 12, 10, 0));
  const deadline = new Date(Date.UTC(2026, 9, 6, 10, 0));

  it('دفع يدوي ماتمّش والخطة شغّالة ⇒ النوبة دي بس + الخطة شغّالة + ميعاد الجاية', () => {
    const text = recurringOccurrenceCancelNotice({ kind: 'unpaid', deadline }, { active: true, nextRunAt: next });
    expect(text).toContain('النوبة دي بس اتلغت');
    expect(text).toContain('آخر ميعاد');
    expect(text).toContain('حجزك المتكرر لسه شغّال');
    expect(text).toContain('والنوبة الجاية');
    expect(text).not.toContain('حدّث بطاقتك');
  });

  it('الخطة متوقفة ⇒ بيقول صراحةً مفيش نوبات جاية', () => {
    const text = recurringOccurrenceCancelNotice({ kind: 'unpaid', deadline }, { active: false, nextRunAt: next });
    expect(text).toContain('والحجز المتكرر نفسه متوقف');
    expect(text).not.toContain('لسه شغّال');
  });

  it('الكارت اترفض ٣ مرات ⇒ عدد المحاولات + «حدّث بطاقتك» + الخطة لسه شغّالة', () => {
    const text = recurringOccurrenceCancelNotice({ kind: 'card_declined', attempts: 3 }, { active: true, nextRunAt: next });
    expect(text).toContain('3 محاولات سحب فاشلة');
    expect(text).toContain('حدّث بطاقتك');
    expect(text).toContain('لسه شغّال');
  });

  it('نوبة قديمة بلا ميعاد متخزّن ⇒ نص سليم من غير تاريخ فاضي', () => {
    const text = recurringOccurrenceCancelNotice({ kind: 'unpaid', deadline: null }, { active: true, nextRunAt: null });
    expect(text).toBe('النوبة دي بس اتلغت لأن الدفع ماتمّش في المهلة. حجزك المتكرر لسه شغّال.');
  });
});
