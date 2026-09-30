import { recurringManualPaymentDeadline } from './recurring-payment-deadline.util';

const utc = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, d, h, m));
const BASE = { windowHours: 24, minimumMinutes: 15, quietHoursStart: '22:00', quietHoursEnd: '08:00' };

// ADR-0116 — الميعاد اللي العميل بيتقاله وبيتطبّق فعلاً.
describe('recurringManualPaymentDeadline', () => {
  it('الحالة العادية: التوليد قبل الموعد بـ96 ساعة ⇒ ميعاد بعد 24 ساعة من التوليد', () => {
    expect(
      recurringManualPaymentDeadline({ ...BASE, generatedAt: utc(1, 10), scheduledAt: utc(5, 10) }),
    ).toEqual(utc(2, 10));
  });

  it('مايعدّيش الموعد − 24 ساعة (نفس حد تحصيل الكارت)', () => {
    expect(
      recurringManualPaymentDeadline({ ...BASE, generatedAt: utc(1, 10), scheduledAt: utc(2, 20) }),
    ).toEqual(utc(1, 20));
  });

  it('وقع جوّه ساعات الهدوء ⇒ بيتقدّم لبدايتها عشان التذكير الأخير يلحق', () => {
    expect(
      recurringManualPaymentDeadline({ ...BASE, generatedAt: utc(1, 23, 30), scheduledAt: utc(6, 12) }),
    ).toEqual(utc(2, 22));
  });

  it('نوبة اتولّدت متأخرة (الموعد بعد أقل من يوم) ⇒ مهلة الطلب العادي زي زمان', () => {
    expect(
      recurringManualPaymentDeadline({ ...BASE, generatedAt: utc(1, 10), scheduledAt: utc(1, 18) }),
    ).toEqual(utc(1, 10, 15));
  });

  it('الإعداد بيتحترم (48 ساعة)', () => {
    expect(
      recurringManualPaymentDeadline({ ...BASE, windowHours: 48, generatedAt: utc(1, 10), scheduledAt: utc(5, 10) }),
    ).toEqual(utc(3, 10));
  });
});
