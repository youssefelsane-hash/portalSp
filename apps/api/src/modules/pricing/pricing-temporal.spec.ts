import { cairoDayString, cairoMidnight, dateDiff, haversineKm, monthsBetween, parseFieldDate, parseGeoPoint } from './pricing-temporal';

/**
 * ADR-0050 §2/§3 — حسابات التواريخ والمسافات. دوال نقية، فالاختبار هنا بلا DB عمدًا.
 *
 * الملف ده بيحمي **فلوس على فاتورة**: كل حالة هنا كانت هتطلع رقم مختلف لو الحسبة اتعملت
 * بالطريقة "البديهية" (قسمة على 30، منتصف ليل JS، 24 ساعة = يوم).
 */
describe('pricing-temporal — حساب التواريخ والمسافات (ADR-0050)', () => {
  describe('monthsBetween — تقويم مش قسمة', () => {
    it('من 1 مارس لـ1 أبريل = شهر واحد بالظبط (مش 31/30.44)', () => {
      expect(monthsBetween(new Date('2026-03-01T09:00:00Z'), new Date('2026-04-01T09:00:00Z'))).toBe(1);
    });

    it('من 1 يناير لـ1 يناير السنة اللي بعدها = 12 شهر', () => {
      expect(monthsBetween(new Date('2026-01-01T09:00:00Z'), new Date('2027-01-01T09:00:00Z'))).toBe(12);
    });

    it('فبراير القصير برضه شهر كامل', () => {
      expect(monthsBetween(new Date('2026-02-01T09:00:00Z'), new Date('2026-03-01T09:00:00Z'))).toBe(1);
    });

    it('نص شهر بيطلع كسر', () => {
      const value = monthsBetween(new Date('2026-01-01T09:00:00Z'), new Date('2026-01-16T09:00:00Z'));
      expect(value).toBeCloseTo(15 / 31, 6);
    });
  });

  describe('dateDiff', () => {
    it('الأيام تقويمية مش وحدات 24 ساعة', () => {
      // 11 مساءً النهارده → 1 صباحًا بكرة = ساعتين، بس **يوم تقويمي واحد**.
      const from = new Date('2026-05-10T20:00:00Z'); // 23:00 بتوقيت القاهرة
      const to = new Date('2026-05-10T22:00:00Z'); //  01:00 بتوقيت القاهرة يوم 11
      expect(dateDiff(from, to, { unit: 'hours' })).toBe(2);
      expect(dateDiff(from, to, { unit: 'days' })).toBe(1);
    });

    it('الشمول بيزوّد يوم — «من 1 لـ 5» = 5 أيام', () => {
      const from = new Date('2026-05-01T09:00:00Z');
      const to = new Date('2026-05-05T09:00:00Z');
      expect(dateDiff(from, to, { unit: 'days' })).toBe(4);
      expect(dateDiff(from, to, { unit: 'days', inclusive: true })).toBe(5);
    });

    it('ceil على الشهور = عدد شهور الفوترة', () => {
      const from = new Date('2026-01-01T09:00:00Z');
      const to = new Date('2026-03-10T09:00:00Z');
      expect(dateDiff(from, to, { unit: 'months', rounding: 'ceil' })).toBe(3);
    });

    it('أسبوع = 7 أيام تقويمية', () => {
      expect(
        dateDiff(new Date('2026-05-01T09:00:00Z'), new Date('2026-05-15T09:00:00Z'), { unit: 'weeks' }),
      ).toBe(2);
    });

    it('absolute بيمنع الناتج السالب لو الأدمن عكس الطرفين', () => {
      const later = new Date('2026-05-05T09:00:00Z');
      const earlier = new Date('2026-05-01T09:00:00Z');
      expect(dateDiff(later, earlier, { unit: 'days' })).toBe(-4);
      expect(dateDiff(later, earlier, { unit: 'days', absolute: true })).toBe(4);
    });

    // نفس الحالة الحدّية اللي `booking-mode-resolver.spec.ts` بيحمي منها: بعد منتصف الليل
    // المصري وقبل منتصف ليل UTC، أي حسبة بتوقيت السيرفر بتغلط بيوم كامل.
    it('حوالين منتصف الليل المصري: العدّ بالتقويم المصري مش UTC', () => {
      expect(cairoDayString(new Date('2026-08-28T22:30:00Z'))).toBe('2026-08-29');
      expect(
        dateDiff(new Date('2026-08-28T22:30:00Z'), new Date('2026-08-29T06:00:00Z'), { unit: 'days' }),
      ).toBe(0);
    });
  });

  describe('cairoMidnight', () => {
    it('بداية اليوم المصري مش بداية اليوم بتوقيت UTC', () => {
      // مصر UTC+3 صيفًا → منتصف الليل المحلي = 21:00 UTC اليوم اللي قبله.
      const midnight = cairoMidnight('2026-07-15');
      expect(cairoDayString(midnight)).toBe('2026-07-15');
      expect(cairoDayString(new Date(midnight.getTime() - 1))).toBe('2026-07-14');
    });

    it('شتاءً كمان (إزاحة مختلفة، نفس النتيجة)', () => {
      const midnight = cairoMidnight('2026-01-15');
      expect(cairoDayString(midnight)).toBe('2026-01-15');
      expect(cairoDayString(new Date(midnight.getTime() - 1))).toBe('2026-01-14');
    });
  });

  describe('parseFieldDate', () => {
    it('تاريخ بس بيترسّى على بداية اليوم المصري', () => {
      const parsed = parseFieldDate('2026-07-15');
      expect(parsed && cairoDayString(parsed)).toBe('2026-07-15');
    });

    it('وقت بس بيترسّى على 1970 — الفرق بين وقتين بيطلع صح', () => {
      const a = parseFieldDate('09:00')!;
      const b = parseFieldDate('17:30')!;
      expect(dateDiff(a, b, { unit: 'hours' })).toBe(8.5);
    });

    it('نص مش تاريخ بيرجّع null (مش Invalid Date بتتسرّب)', () => {
      expect(parseFieldDate('كبير')).toBeNull();
      expect(parseFieldDate('')).toBeNull();
    });
  });

  describe('haversineKm + parseGeoPoint', () => {
    it('المسافة بين ميدان التحرير والقلعة ≈ 3 كم', () => {
      const km = haversineKm({ lat: 30.0444, lng: 31.2357 }, { lat: 30.0287, lng: 31.2599 });
      expect(km).toBeGreaterThan(2.5);
      expect(km).toBeLessThan(3.5);
    });

    it('نفس النقطة = صفر', () => {
      expect(haversineKm({ lat: 30, lng: 31 }, { lat: 30, lng: 31 })).toBe(0);
    });

    it('parseGeoPoint بيرفض الإحداثيات المستحيلة بدل ما يحسب مسافة خيالية', () => {
      expect(parseGeoPoint('30.0444,31.2357')).toEqual({ lat: 30.0444, lng: 31.2357 });
      expect(parseGeoPoint('200,31')).toBeNull();
      expect(parseGeoPoint('مش إحداثيات')).toBeNull();
    });
  });
});
