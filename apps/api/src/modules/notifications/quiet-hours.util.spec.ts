import { isWithinQuietHours, nextTimeOutsideQuietHours } from './quiet-hours.util';

// كل الأوقات UTC (نفس اتفاقية المشروع) — تواريخ 2026-01-01 بس عشان نتحكم في الساعة/الدقيقة.
function utc(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, hour, minute, 0));
}

describe('quiet-hours.util', () => {
  describe('isWithinQuietHours — نطاق عادي (start < end)', () => {
    it('يرجع true لو الوقت جوّه النطاق', () => {
      expect(isWithinQuietHours(utc(10, 30), '09:00', '17:00')).toBe(true);
    });

    it('يرجع false لو الوقت برّه النطاق', () => {
      expect(isWithinQuietHours(utc(20, 0), '09:00', '17:00')).toBe(false);
    });

    it('حد البداية (inclusive) وحد النهاية (exclusive)', () => {
      expect(isWithinQuietHours(utc(9, 0), '09:00', '17:00')).toBe(true);
      expect(isWithinQuietHours(utc(17, 0), '09:00', '17:00')).toBe(false);
    });
  });

  describe('isWithinQuietHours — نطاق عادّي منتصف الليل (start > end، الحالة الافتراضية 22:00→08:00)', () => {
    it('يرجع true بعد نص الليل وقبل النهاية', () => {
      expect(isWithinQuietHours(utc(23, 0), '22:00', '08:00')).toBe(true);
      expect(isWithinQuietHours(utc(2, 0), '22:00', '08:00')).toBe(true);
      expect(isWithinQuietHours(utc(7, 59), '22:00', '08:00')).toBe(true);
    });

    it('يرجع false في نص النهار', () => {
      expect(isWithinQuietHours(utc(14, 0), '22:00', '08:00')).toBe(false);
    });

    it('حد البداية والنهاية', () => {
      expect(isWithinQuietHours(utc(22, 0), '22:00', '08:00')).toBe(true);
      expect(isWithinQuietHours(utc(8, 0), '22:00', '08:00')).toBe(false);
    });
  });

  it('نطاق صفري (start === end) يعني مفيش ساعات هدوء خالص', () => {
    expect(isWithinQuietHours(utc(3, 0), '10:00', '10:00')).toBe(false);
  });

  describe('nextTimeOutsideQuietHours', () => {
    it('لو الوقت أصلاً برّه الهدوء، بترجعه زي ما هو', () => {
      const now = utc(14, 0);
      expect(nextTimeOutsideQuietHours(now, '22:00', '08:00')).toEqual(now);
    });

    it('لو الوقت جوّه الهدوء (بعد نص الليل)، بترجع نفس اليوم عند نهاية الهدوء', () => {
      const now = utc(2, 30);
      const next = nextTimeOutsideQuietHours(now, '22:00', '08:00');
      expect(next.getUTCDate()).toBe(1);
      expect(next.getUTCHours()).toBe(8);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it('لو الوقت جوّه الهدوء (قبل نص الليل)، بترجع بكرة عند نهاية الهدوء', () => {
      const now = utc(23, 0);
      const next = nextTimeOutsideQuietHours(now, '22:00', '08:00');
      expect(next.getUTCDate()).toBe(2); // بكرة
      expect(next.getUTCHours()).toBe(8);
      expect(next.getUTCMinutes()).toBe(0);
    });
  });
});
