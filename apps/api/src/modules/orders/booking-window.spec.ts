import {
  DEFAULT_BOOKING_WINDOW,
  bookingWindowApplies,
  isBareDayPlaceholder,
  bookingWindowMessageAr,
  isWithinBookingWindow,
  normalizeBookingWindow,
  platformMinutesOfDay,
  resolveBookingWindowSetting,
} from './booking-window';

/**
 * **نافذة اختيار الموعد** (طلب مالك 2026-09-15، docs/08 §151، ADR-0097).
 *
 * > «مواعيد الشغل عندنا الـcustomer ينفع يختارها بتكون من الساعة ٥ صباحًا إلى الساعة ٧ مساءً…
 * >  الشغل عادي بقى في أي وقت… ولكن هو الاختيار نفسه مش مسموح له يختار حاجة برا الحدود دي.»
 */
describe('نافذة اختيار الموعد (ADR-0097)', () => {
  // القاهرة صيفًا UTC+3 (التوقيت الصيفي شغّال في مصر من ٢٠٢٣)، وشتاءً UTC+2. التواريخ هنا
  // مكتوبة بإزاحة صريحة عشان الاختبار مايتغيّرش بتغيّر التوقيت الصيفي.
  const cairo = (iso: string) => new Date(iso);

  describe('الحدود نفسها', () => {
    it('٥:٠٠ ص بالظبط مقبولة — أول لحظة في النافذة', () => {
      expect(isWithinBookingWindow(cairo('2027-06-10T05:00:00+03:00'), DEFAULT_BOOKING_WINDOW)).toBe(true);
    });

    it('٧:٠٠ م بالظبط مقبولة — الساعة الأخيرة **شاملة**', () => {
      expect(isWithinBookingWindow(cairo('2027-06-10T19:00:00+03:00'), DEFAULT_BOOKING_WINDOW)).toBe(true);
    });

    it('٧:٣٠ م مرفوضة — بعد آخر ساعة مسموحة', () => {
      expect(isWithinBookingWindow(cairo('2027-06-10T19:30:00+03:00'), DEFAULT_BOOKING_WINDOW)).toBe(false);
    });

    it('٤:٥٩ ص مرفوضة — قبل النافذة بدقيقة', () => {
      expect(isWithinBookingWindow(cairo('2027-06-10T04:59:00+03:00'), DEFAULT_BOOKING_WINDOW)).toBe(false);
    });

    it('نص الليل مرفوض', () => {
      expect(isWithinBookingWindow(cairo('2027-06-10T00:30:00+03:00'), DEFAULT_BOOKING_WINDOW)).toBe(false);
    });
  });

  /**
   * **ده جوهر الطلب**: العميل بيختار **بتوقيت القاهرة**، والقيمة بتتبعت UTC. المقارنة بالساعة
   * الـUTC الخام كانت هتزحزح النافذة ساعتين/تلاتة وتقبل وترفض في أوقات غلط.
   */
  describe('الحساب بتوقيت المنصّة مش UTC', () => {
    it('٦ ص بتوقيت القاهرة (٣ ص UTC صيفًا) مقبولة', () => {
      const date = cairo('2027-06-10T03:00:00Z'); // = 06:00 القاهرة
      expect(platformMinutesOfDay(date)).toBe(6 * 60);
      expect(isWithinBookingWindow(date, DEFAULT_BOOKING_WINDOW)).toBe(true);
    });

    it('٣ ص بتوقيت القاهرة (منتصف الليل UTC) مرفوضة — واللي بيقيس UTC كان هيقبلها غلط', () => {
      const date = cairo('2027-06-10T00:00:00Z'); // = 03:00 القاهرة
      expect(platformMinutesOfDay(date)).toBe(3 * 60);
      expect(isWithinBookingWindow(date, DEFAULT_BOOKING_WINDOW)).toBe(false);
    });

    it('٩ م بتوقيت القاهرة (٦ م UTC) مرفوضة — واللي بيقيس UTC كان هيقبلها غلط', () => {
      const date = cairo('2027-06-10T18:00:00Z'); // = 21:00 القاهرة
      expect(platformMinutesOfDay(date)).toBe(21 * 60);
      expect(isWithinBookingWindow(date, DEFAULT_BOOKING_WINDOW)).toBe(false);
    });
  });

  describe('إعداد مكسور مايقفلش المنصّة', () => {
    it('نافذة مقلوبة (بداية بعد نهاية) بترجع للافتراضي بدل ما ترفض كل الطلبات', () => {
      expect(normalizeBookingWindow({ startHour: 20, endHour: 4 })).toEqual(DEFAULT_BOOKING_WINDOW);
    });

    it('قيم خارج ٠..٢٣ بتتحصر', () => {
      expect(normalizeBookingWindow({ startHour: -5, endHour: 99 })).toEqual({ startHour: 0, endHour: 23 });
    });

    it('نافذة من ساعة واحدة صالحة — مش حالة خطأ', () => {
      const window = normalizeBookingWindow({ startHour: 10, endHour: 10 });
      expect(window).toEqual({ startHour: 10, endHour: 10 });
      expect(isWithinBookingWindow(cairo('2027-06-10T10:00:00+03:00'), window)).toBe(true);
      expect(isWithinBookingWindow(cairo('2027-06-10T10:01:00+03:00'), window)).toBe(false);
    });
  });

  describe('القراءة من الإعدادات', () => {
    it('بتقرا المفتاحين وبتطبّع الناتج', async () => {
      const settings = {
        getNumber: jest.fn(async (key: string) => (key === 'booking.selectable_start_hour' ? 7 : 22)),
      };
      expect(await resolveBookingWindowSetting(settings)).toEqual({ startHour: 7, endHour: 22 });
    });

    it('الافتراضي لما المفتاح مش موجود هو ٥–١٩ — نفس رقم المالك بالحرف', async () => {
      const settings = { getNumber: jest.fn(async (_k: string, fallback: number) => fallback) };
      expect(await resolveBookingWindowSetting(settings)).toEqual({ startHour: 5, endHour: 19 });
    });
  });

  /**
   * **الاستثناء ده اتكتب بعد ما ١٤ اختبار قايم فشلوا** أول ما الحارس اتضاف: اتفاقية «اليوم
   * المجرّد» في المنصّة كلها هي `T00:00:00.000Z`، وهي بتوقيت القاهرة ٢ أو ٣ الفجر — يعني
   * برّه النافذة. الحارس كان هيرفض كل حجز «يوم بس» على المنصّة.
   */
  describe('بيتطبّق على اختيار ساعة حقيقي بس', () => {
    it('«اليوم المجرّد» (منتصف الليل UTC) مش اختيار ساعة — الحارس مابيتطبّقش', () => {
      const bareDay = new Date('2027-06-10T00:00:00.000Z');
      expect(isBareDayPlaceholder(bareDay)).toBe(true);
      // بتوقيت القاهرة دي ٣ الفجر، يعني برّه النافذة فعلاً — ولولا الاستثناء كانت هتترفض.
      expect(isWithinBookingWindow(bareDay, DEFAULT_BOOKING_WINDOW)).toBe(false);
      expect(bookingWindowApplies({ scheduledAt: bareDay, serviceRequiresStartTime: true })).toBe(false);
    });

    it('خدمة مابتطلبش ساعة بداية ⇒ الحارس مابيتطبّقش حتى لو الوقت برّه النافذة', () => {
      const lateNight = new Date('2027-06-10T23:00:00+03:00');
      expect(bookingWindowApplies({ scheduledAt: lateNight, serviceRequiresStartTime: false })).toBe(false);
    });

    it('خدمة بتطلب ساعة + وقت حقيقي ⇒ الحارس بيتطبّق (الضابط)', () => {
      const chosen = new Date('2027-06-10T23:00:00+03:00');
      expect(isBareDayPlaceholder(chosen)).toBe(false);
      expect(bookingWindowApplies({ scheduledAt: chosen, serviceRequiresStartTime: true })).toBe(true);
    });
  });

  it('الرسالة بتقول الحدود وبتقول إن الشغل بيكمّل بعدها — مش «غلط» مبهمة', () => {
    const message = bookingWindowMessageAr(DEFAULT_BOOKING_WINDOW);
    // أرقام لاتينية زي باقي رسايل المنصّة (رسايل البراندنج/التحقق كلها كده) — الاتساق أهم
    // من الشكل، وأي اختلاف هنا بيبان للعميل في نص واحد جنب نصوص تانية.
    expect(message).toContain('5 ص');
    expect(message).toContain('7 م');
    expect(message).toContain('الشغل نفسه ممكن يكمّل بعدها');
  });
});
