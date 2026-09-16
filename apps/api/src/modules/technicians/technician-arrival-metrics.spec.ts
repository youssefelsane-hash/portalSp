import {
  MIN_PUNCTUALITY_SAMPLE_FALLBACK,
  NEAR_TERM_ARRIVAL_HOURS_FALLBACK,
  isExpectedArrivalDisplayable,
  isPunctualityDisplayable,
  resolveArrivalMetric,
  resolveArrivalMetricMode,
} from './technician-arrival-metrics';

/**
 * **مؤشر الوصول: مفهومين حسب أفق الطلب** (طلب مالك 2026-09-16، docs/08 §153، ADR-0099).
 *
 * > «ETA بمعنى "الفني هيوصل بعد كام دقيقة دلوقتي" مش دايمًا له قيمة… لو الطلب مجدول بعد فترة،
 * >  المسافة تفضل عامل في الاختيار، لكن بدل ETA لحظي نستخدم متوسط التزام الفني بالمواعيد.»
 */
describe('مؤشر الوصول (ADR-0099)', () => {
  const now = new Date('2027-06-10T12:00:00Z');
  const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  describe('اختيار المفهوم حسب الأفق', () => {
    it('طلب بلا موعد (فوري/طوارئ) ⇒ مدة الوصول — هو أقرب ما يكون', () => {
      expect(resolveArrivalMetricMode(null, 48, now)).toBe('expected_arrival');
      expect(resolveArrivalMetricMode(undefined, 48, now)).toBe('expected_arrival');
    });

    it('طلب خلال النافذة ⇒ مدة الوصول', () => {
      expect(resolveArrivalMetricMode(hoursFromNow(2), 48, now)).toBe('expected_arrival');
      expect(resolveArrivalMetricMode(hoursFromNow(47), 48, now)).toBe('expected_arrival');
    });

    it('طلب بعد النافذة ⇒ الالتزام بالمواعيد — «هيوصل بعد كام دقيقة» مالوش معنى لشغل الأسبوع الجاي', () => {
      expect(resolveArrivalMetricMode(hoursFromNow(49), 48, now)).toBe('punctuality');
      expect(resolveArrivalMetricMode(hoursFromNow(24 * 7), 48, now)).toBe('punctuality');
    });

    it('الحد نفسه (٤٨ ساعة بالظبط) لسه «قريب»', () => {
      expect(resolveArrivalMetricMode(hoursFromNow(48), 48, now)).toBe('expected_arrival');
    });

    it('عتبة صفر = تعطيل مدة الوصول بالكامل', () => {
      expect(resolveArrivalMetricMode(null, 0, now)).toBe('punctuality');
    });

    it('تاريخ غير صالح مايكسرش الحساب — بيرجع للالتزام', () => {
      expect(resolveArrivalMetricMode('مش تاريخ', 48, now)).toBe('punctuality');
    });
  });

  it('العتبة بتتقري من **نفس مفتاح** التوزيع — مش رقم تاني', async () => {
    const settings = { getNumber: jest.fn(async (_k: string, f: number) => f) };
    const decision = await resolveArrivalMetric(settings, null, now);
    expect(settings.getNumber).toHaveBeenCalledWith(
      'matching.near_term_request_hours',
      NEAR_TERM_ARRIVAL_HOURS_FALLBACK,
    );
    expect(decision).toEqual({ mode: 'expected_arrival', nearTermHours: 48 });
  });

  /**
   * **الحالة اللي ظهرت في لقطة المالك**: «وصول متوقع ~0 د» جنب «2713.7 كم». الصفر ناتج بيانات
   * ناقصة (`departed_at = arrived_at`)، وعرضه بيخلّي الكارت يكذب.
   */
  describe('إخفاء الأرقام اللي بتكذب', () => {
    it('صفر دقيقة مش قيمة صالحة — دي البَقّة اللي ظهرت في اللقطة', () => {
      expect(isExpectedArrivalDisplayable(0)).toBe(false);
      expect(isExpectedArrivalDisplayable(null)).toBe(false);
      expect(isExpectedArrivalDisplayable(18)).toBe(true);
    });

    it('نسبة التزام من عيّنة صغيرة مابتتعرضش — «١٠٠٪ من زيارة واحدة» بتضلّل', () => {
      const oneVisit = { onTimeRatePercent: 100, averageLateMinutes: null, sampleCount: 1 };
      expect(isPunctualityDisplayable(oneVisit, MIN_PUNCTUALITY_SAMPLE_FALLBACK)).toBe(false);
      const enough = { onTimeRatePercent: 89, averageLateMinutes: 12, sampleCount: 9 };
      expect(isPunctualityDisplayable(enough, MIN_PUNCTUALITY_SAMPLE_FALLBACK)).toBe(true);
    });

    it('صفر بالمية التزام **بيتعرض** لو العيّنة كفاية — ده خبر حقيقي للعميل مش رقم ناقص', () => {
      const late = { onTimeRatePercent: 0, averageLateMinutes: 40, sampleCount: 12 };
      expect(isPunctualityDisplayable(late, MIN_PUNCTUALITY_SAMPLE_FALLBACK)).toBe(true);
    });

    it('مفيش نسبة أصلاً (مفيش زيارات) ⇒ مابيتعرضش', () => {
      const none = { onTimeRatePercent: null, averageLateMinutes: null, sampleCount: 0 };
      expect(isPunctualityDisplayable(none, MIN_PUNCTUALITY_SAMPLE_FALLBACK)).toBe(false);
    });
  });
});
