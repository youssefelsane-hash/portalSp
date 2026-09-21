import { arDate, arDateTime, egp, ltr, orderRef } from './notification-format.util';

describe('تنسيق نصوص الإشعارات (تدقيق 2026-09-21)', () => {
  describe('الفلوس', () => {
    it('فاصل آلاف + أرقام لاتينية', () => {
      expect(egp(1_250_000)).toBe('12,500 ج.م');
    });

    it('**مابيقرّبش** — القروش بتظهر لما تكون موجودة', () => {
      // toFixed(0)/Math.round كانوا بيطلّعوا «12501 ج.م» لنفس المبلغ — رقم فلوس غلط في رسالة.
      expect(egp(1_250_050)).toBe('12,500.50 ج.م');
    });

    it('مبلغ صحيح مابيتكتبش بكسور صفرية', () => {
      expect(egp(15_000)).toBe('150 ج.م');
      expect(egp(0)).toBe('0 ج.م');
    });

    it('«ج.م» بلا نقطة — صيغة واحدة في المنتج كله', () => {
      expect(egp(5_000)).toBe('50 ج.م');
      expect(egp(5_000).endsWith('ج.م')).toBe(true);
    });

    it('مدخل فاسد مابيطلّعش NaN في رسالة للمستخدم', () => {
      expect(egp(Number.NaN)).toBe('0 ج.م');
    });
  });

  describe('التواريخ', () => {
    // 19:30 UTC = 22:30 بتوقيت القاهرة (UTC+3 صيفًا).
    const at = new Date('2026-09-21T19:30:00Z');

    it('بتوقيت القاهرة مش توقيت السيرفر', () => {
      const out = arDateTime(at);
      expect(out).toContain('10:30');
      expect(out).not.toContain('7:30');
    });

    it('أرقام لاتينية مش عربية-هندية', () => {
      const out = arDateTime(at);
      expect(out).toMatch(/[0-9]/);
      expect(out).not.toMatch(/[٠-٩]/);
    });

    it('تاريخ بلا وقت للمواعيد اليومية', () => {
      expect(arDate(at)).toContain('2026');
      expect(arDate(at)).not.toContain('10:30');
    });

    it('تاريخ فاسد بيرجع فاضي بدل "Invalid Date"', () => {
      expect(arDateTime('مش تاريخ')).toBe('');
      expect(arDate(Number.NaN)).toBe('');
    });
  });

  describe('عزل الاتجاه (bidi)', () => {
    it('التوكن اللاتيني بيتلف في FSI/PDI', () => {
      expect(ltr('P7-000123')).toBe('⁨P7-000123⁩');
    });

    it('الفاضي مابيسيبش محارف عزل يتيمة', () => {
      expect(ltr('')).toBe('');
      expect(ltr(null)).toBe('');
      expect(ltr(undefined)).toBe('');
      expect(ltr('   ')).toBe('');
    });

    it('رقم الطلب في جملة عربية معزول', () => {
      expect(orderRef('P7-000123')).toBe('طلب رقم ⁨P7-000123⁩');
    });

    it('طلب بلا رقم بيتقال «الطلب» بدل «طلب رقم» فاضية', () => {
      expect(orderRef(null)).toBe('الطلب');
      expect(orderRef('')).toBe('الطلب');
    });

    it('محارف العزل غير مرئية — مابتزوّدش طول مقروء', () => {
      const withIsolates = orderRef('P7-1');
      expect(withIsolates.replace(/[⁨⁩]/g, '')).toBe('طلب رقم P7-1');
    });
  });
});
