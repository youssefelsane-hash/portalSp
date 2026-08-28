import { BookingMode } from './entities/order.entity';
import { canAcceptSameDay, isSameDayUrgent, platformDayOf, resolveBookingMode } from './booking-mode-resolver';

// ADR-0048 / docs/08 §85 — اشتقاق وضع الحجز. دوال نقية، فالاختبار هنا بلا DB عمدًا (السلوك
// المتكامل مع التسعير والتوزيع مغطّى في `booking-mode-derivation.spec.ts` الحي).
describe('booking-mode-resolver — وضع الحجز مشتق مش مختار (ADR-0048)', () => {
  const anyService = { allowsIndividual: true, allowsTeam: true, allowsEmergency: true };

  describe('platformDayOf — يوم القاهرة', () => {
    // **الاختبار ده هو اللي بيحمي من البَقّة اللي اتوثّقت في `orders.service.ts` (CAIRO_DAY_EXPR)**:
    // 22:30 UTC في القاهرة (UTC+2/+3) هو **اليوم اللي بعده** خلاص. أي حساب بيقرا اليوم من توقيت
    // السيرفر هيقول اليوم اللي فات، وطلب "بكرة" يتحسب "النهارده" (أو العكس) وتتحسب رسوم غلط.
    it('بعد منتصف الليل بتوقيت القاهرة بيرجّع اليوم الجديد مش يوم UTC', () => {
      expect(platformDayOf(new Date('2026-08-28T22:30:00Z'))).toBe('2026-08-29');
    });

    it('قبلها بشوية لسه اليوم القديم', () => {
      expect(platformDayOf(new Date('2026-08-28T20:30:00Z'))).toBe('2026-08-28');
    });
  });

  describe('isSameDayUrgent', () => {
    const now = new Date('2026-08-28T09:00:00Z'); // 11:00 صباحًا بتوقيت القاهرة

    it('نفس اليوم = مستعجل', () => {
      expect(isSameDayUrgent({ scheduledAt: new Date('2026-08-28T14:00:00Z'), now })).toBe(true);
    });

    it('بكرة = مش مستعجل', () => {
      expect(isSameDayUrgent({ scheduledAt: new Date('2026-08-29T08:00:00Z'), now })).toBe(false);
    });

    // **قرار مقصود اتاخد بعد ما السويت الكاملة كشفت المشكلة** — الشرح الكامل في الدالة نفسها:
    // رسوم استعجال على طلب محدش شاف تنبيهها = مفاجأة في الفاتورة، وبوابة `allows_emergency`
    // كانت بترفض طلبات مالهاش علاقة بنفس اليوم أصلاً.
    it('من غير تاريخ = مش مستعجل (مفيش رسوم على حد ما اتخطرش)', () => {
      expect(isSameDayUrgent({ scheduledAt: null, now })).toBe(false);
    });

    it('يوم فات = مستعجل (أأمن من معالجته كشغل بعيد يتأجل بثه)', () => {
      expect(isSameDayUrgent({ scheduledAt: new Date('2026-08-20T08:00:00Z'), now })).toBe(true);
    });

    // الحالة الحدّية اللي بتكسر أي حساب بيعتمد على توقيت السيرفر: الساعة 23:00 بتوقيت القاهرة
    // (21:00 UTC)، وحجز "بكرة" = 29 أغسطس. لو الحساب أخد يوم UTC كان هيقول 28 وهو صح بالصدفة،
    // لكن لو الساعة بقت 22:30 UTC (00:30 بتوقيت القاهرة يوم 29) فحجز 29 بقى **النهارده**.
    it('00:30 بتوقيت القاهرة: حجز نفس اليوم المصري بيتحسب مستعجل', () => {
      expect(
        isSameDayUrgent({
          scheduledAt: new Date('2026-08-29T06:00:00Z'),
          now: new Date('2026-08-28T22:30:00Z'),
        }),
      ).toBe(true);
    });
  });

  describe('resolveBookingMode', () => {
    it('مستعجل = طوارئ مهما كان عدد العمال (طلب مالك صريح)', () => {
      expect(
        resolveBookingMode({ urgent: true, requiredTechnicians: 5, requiredAssistants: 3, service: anyService }),
      ).toBe(BookingMode.EMERGENCY);
    });

    it('مش مستعجل + فرد واحد = فردي', () => {
      expect(
        resolveBookingMode({ urgent: false, requiredTechnicians: 1, requiredAssistants: 0, service: anyService }),
      ).toBe(BookingMode.INDIVIDUAL);
    });

    it('مش مستعجل + أكتر من فني = فريق', () => {
      expect(
        resolveBookingMode({ urgent: false, requiredTechnicians: 3, requiredAssistants: 0, service: anyService }),
      ).toBe(BookingMode.TEAM);
    });

    it('فني واحد + مساعد = فريق برضه', () => {
      expect(
        resolveBookingMode({ urgent: false, requiredTechnicians: 1, requiredAssistants: 1, service: anyService }),
      ).toBe(BookingMode.TEAM);
    });

    it('تقدير مش معروف (null) بيتعامل كفرد واحد', () => {
      expect(
        resolveBookingMode({ urgent: false, requiredTechnicians: null, requiredAssistants: null, service: anyService }),
      ).toBe(BookingMode.INDIVIDUAL);
    });

    // ADR-0048 §3 — إعداد الأدمن حاكم في الاتجاهين.
    it('الخدمة مش بتدعم فريق: بتفضل فردي حتى لو التقدير طلب أكتر', () => {
      expect(
        resolveBookingMode({
          urgent: false,
          requiredTechnicians: 4,
          requiredAssistants: 0,
          service: { ...anyService, allowsTeam: false },
        }),
      ).toBe(BookingMode.INDIVIDUAL);
    });

    it('خدمة شغل-فريق-بحت: بتفضل فريق حتى لو فرد واحد كفاية', () => {
      expect(
        resolveBookingMode({
          urgent: false,
          requiredTechnicians: 1,
          requiredAssistants: 0,
          service: { ...anyService, allowsIndividual: false },
        }),
      ).toBe(BookingMode.TEAM);
    });
  });

  describe('canAcceptSameDay', () => {
    it('بيتبع allows_emergency بتاع الخدمة', () => {
      expect(canAcceptSameDay({ ...anyService, allowsEmergency: false })).toBe(false);
      expect(canAcceptSameDay(anyService)).toBe(true);
    });
  });
});
