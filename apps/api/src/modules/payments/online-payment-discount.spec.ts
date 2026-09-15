import { OnlineDiscountPolicy, onlineDiscountLabelAr, resolveOnlineDiscountCents } from './online-payment-discount';

/**
 * بوابات خصم الدفع الإلكتروني وصياغة وسمه (ADR-0085، طلب مالك §141 بند ٥).
 *
 * التغطية الحية (`scripts/verify-online-payment-discount.js`) بتثبت إن **الفاتورة** بتتخصم
 * فعلاً. الملف ده بيثبت البوابات اللي صعب توليدها حيًا (وسيلة مش مؤهّلة، إعداد سالب، خصم أكبر
 * من الطلب) وصياغة الرقم في النص.
 */
describe('خصم الدفع الإلكتروني', () => {
  const policy = (overrides: Partial<OnlineDiscountPolicy> = {}): OnlineDiscountPolicy => ({
    enabled: true,
    amountCents: 3000,
    minOrderCents: 0,
    methods: new Set(['instapay', 'card']),
    labelTemplateAr: 'وفّر {discount} ج.م لما تدفع دلوقتي',
    ...overrides,
  });

  describe('resolveOnlineDiscountCents', () => {
    it('وسيلة مؤهّلة وطلب فوق الحد ⇒ الخصم كامل', () => {
      expect(resolveOnlineDiscountCents(policy(), 'instapay', 50_000)).toBe(3000);
    });

    it('الحروف الكبيرة والمسافات مابتكسرش المطابقة', () => {
      expect(resolveOnlineDiscountCents(policy(), '  InstaPay ', 50_000)).toBe(3000);
    });

    it('المفتاح مقفول ⇒ صفر مهما كانت الوسيلة', () => {
      expect(resolveOnlineDiscountCents(policy({ enabled: false }), 'instapay', 50_000)).toBe(0);
    });

    it('وسيلة مش في القايمة (كاش) ⇒ صفر', () => {
      expect(resolveOnlineDiscountCents(policy(), 'cash', 50_000)).toBe(0);
    });

    it('بلا وسيلة (الدفع بعد الخدمة) ⇒ صفر', () => {
      expect(resolveOnlineDiscountCents(policy(), null, 50_000)).toBe(0);
      expect(resolveOnlineDiscountCents(policy(), undefined, 50_000)).toBe(0);
    });

    it('طلب تحت الحد الأدنى ⇒ صفر', () => {
      expect(resolveOnlineDiscountCents(policy({ minOrderCents: 100_000 }), 'instapay', 50_000)).toBe(0);
    });

    it('الطلب مساوي للحد الأدنى بالظبط ⇒ الخصم بيسري (الحد شامل)', () => {
      expect(resolveOnlineDiscountCents(policy({ minOrderCents: 50_000 }), 'instapay', 50_000)).toBe(3000);
    });

    /**
     * الحارس الأهم ماليًا: إعداد خصم أكبر من الطلب نفسه كان هيطلّع **إجمالي سالب**. الأسعار كلها
     * `integer` بالقرش (مفيش float يمتص الغلط)، والسالب بيتسرّب لتسوية الفني وللتقارير.
     */
    it('خصم أكبر من الطلب بيتسقّف عند قيمة الطلب — مفيش إجمالي سالب', () => {
      expect(resolveOnlineDiscountCents(policy({ amountCents: 90_000 }), 'instapay', 50_000)).toBe(50_000);
    });

    it('إعداد سالب أو صفر بيتقرا كـ«مفيش خصم»، مش كزيادة على العميل', () => {
      expect(resolveOnlineDiscountCents(policy({ amountCents: 0 }), 'instapay', 50_000)).toBe(0);
      expect(resolveOnlineDiscountCents(policy({ amountCents: -5000 }), 'instapay', 50_000)).toBe(0);
    });
  });

  describe('onlineDiscountLabelAr', () => {
    it('بيحط الرقم بالجنيه بلا كسور لما يكون صحيحًا', () => {
      expect(onlineDiscountLabelAr(policy(), 3000)).toBe('وفّر 30 ج.م لما تدفع دلوقتي');
    });

    it('وبكسرين لما المبلغ مش جنيهات صحيحة', () => {
      expect(onlineDiscountLabelAr(policy(), 3050)).toBe('وفّر 30.50 ج.م لما تدفع دلوقتي');
    });

    it('مفيش خصم ⇒ مفيش وسم (ممنوع «وفّر 0 ج.م»)', () => {
      expect(onlineDiscountLabelAr(policy(), 0)).toBeNull();
    });

    it('قالب فاضي ⇒ مفيش وسم بدل نص مكسور', () => {
      expect(onlineDiscountLabelAr(policy({ labelTemplateAr: '   ' }), 3000)).toBeNull();
    });

    it('بيبدّل كل مرات {discount} مش أول واحدة بس', () => {
      expect(onlineDiscountLabelAr(policy({ labelTemplateAr: '{discount} ج.م خصم — أيوه {discount} ج.م' }), 3000)).toBe(
        '30 ج.م خصم — أيوه 30 ج.م',
      );
    });
  });
});
