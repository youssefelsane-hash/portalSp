import { CequensSmsDispatcher } from './cequens-sms-dispatcher.service';
import { envValidationSchema } from '../../config/env.validation';

/**
 * قيود CEQUENS اللي بتفشل **وقت الإرسال** مش وقت البناء — وبوابة الـSMS هي القناة الوحيدة
 * لتسليم كود التحقق، فأي واحد فيهم = صفر تسجيل دخول لأي مستخدم حقيقي.
 *
 * الاختبار ده مش بينادي المزوّد (مفيش حساب هنا) — بيقفل الحاجات اللي **نقدر نتأكد منها
 * محليًا بالحساب**: طول الرسالة، طول اسم المُرسِل، وشكل رقم المستلم.
 */

/** عدد وحدات UTF-16 — ده اللي بيتحسب عليه حد الـSMS، مش عدد المحارف المرئية. */
const utf16Units = (text: string): number =>
  [...text].reduce((total, ch) => total + ((ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1), 0);

/** أي نص فيه عربي بيتبعت UCS-2: ٧٠ وحدة للرسالة الواحدة، ٦٧ لكل جزء لو اتجزّأت. */
const UCS2_SINGLE_SMS_LIMIT = 70;

/** نسخة طبق الأصل من اللي `AuthService.requestOtp` بيبعته (عنوان + سطر جديد + نص). */
const otpSmsText = (code: string, expiryMinutes: number): string =>
  `أسطى\nكود التحقق: ${code} — صالح ${expiryMinutes} دقايق. متشاركوش الكود مع حد.`;

describe('عقد CEQUENS — القيود اللي بتفشل وقت الإرسال', () => {
  describe('رسالة كود التحقق لازم تدخل في SMS واحدة', () => {
    // النص القديم كان ٧٦ وحدة = **جزئين وتكلفة مضاعفة على كل كود تحقق**، وهي أكتر رسالة
    // بتتبعت في المنصة كلها. الزيادة كانت ٦ وحدات بس.
    it.each([
      [5, 'الافتراضي'],
      [10, 'مدة أطول'],
      [15, 'خانتين'],
      [1440, 'أربع خانات (يوم كامل)'],
    ])('OTP_EXPIRY_MINUTES=%i (%s)', (minutes) => {
      const units = utf16Units(otpSmsText('123456', minutes));
      expect(units).toBeLessThanOrEqual(UCS2_SINGLE_SMS_LIMIT);
    });

    it('الحساب نفسه صح — نص أطول من الحد بيترصد', () => {
      // النص القديم بالحرف. لو الاختبار ده عدّى، يبقى الحساب غلط مش النص.
      const legacy = 'كود التحقق — OSTA\nكودك: 123456 — صالح لمدة 5 دقيقة. متشاركوش الكود ده مع حد.';
      expect(utf16Units(legacy)).toBe(76);
      expect(utf16Units(legacy)).toBeGreaterThan(UCS2_SINGLE_SMS_LIMIT);
    });
  });

  describe('اسم المُرسِل (Sender ID) — حدود معيار GSM', () => {
    // بنستخرج قاعدة الحقل لوحده بدل ما نبني بيئة كاملة صالحة — الاختبار عن القاعدة دي
    // بالذات، ومكانش ينفع يفضل مربوط بكل متغيّرات الإقلاع التانية.
    const senderNameRule = envValidationSchema.extract('CEQUENS_SENDER_NAME');
    const validate = (senderName: string) => senderNameRule.validate(senderName);

    it('اسم أبجدي لحد ١١ محرف مقبول', () => {
      expect(validate('OSTA').error).toBeUndefined();
      expect(validate('OSTAHOME123').error).toBeUndefined(); // ١١ بالظبط
    });

    it('اسم أبجدي أطول من ١١ بيترفض وقت الإقلاع مش وقت الإرسال', () => {
      const { error } = validate('OSTAHOME1234'); // ١٢
      expect(error).toBeDefined();
      expect(error?.message).toContain('CEQUENS_SENDER_NAME');
    });

    it('اسم رقمي بياخد حد ١٥ (شورت كود / رقم طويل)', () => {
      expect(validate('201000000000').error).toBeUndefined(); // ١٢ رقم
      expect(validate('1234567890123456').error).toBeDefined(); // ١٦ رقم
    });

    it('فاضي مقبول — المزوّد بيبقى مش مُعدّ وخلاص، مش خطأ إقلاع', () => {
      expect(validate('').error).toBeUndefined();
    });
  });

  describe('شكل رقم المستلم', () => {
    const dispatcherWith = (recipientFormat?: string) =>
      new CequensSmsDispatcher({
        get: (key: string) =>
          ({
            'notifications.cequens.apiKey': 'test-key',
            'notifications.cequens.senderName': 'OSTA',
            'notifications.cequens.baseUrl': 'https://example.invalid/sms/v1',
            'notifications.cequens.recipientFormat': recipientFormat,
          })[key],
      } as any);

    /** `formatRecipient` خاصة عمدًا — بنوصلها من غير ما نوسّع السطح العام للكلاس. */
    const format = (dispatcher: CequensSmsDispatcher, phone: string): string =>
      (dispatcher as any).formatRecipient(phone) as string;

    it('الافتراضي بيشيل الـ+ (شكل أمثلة CEQUENS)', () => {
      expect(format(dispatcherWith(undefined), '+201000000777')).toBe('201000000777');
    });

    it('e164 بيسيب الـ+ زي ما هو', () => {
      expect(format(dispatcherWith('e164'), '+201000000777')).toBe('+201000000777');
    });

    it('رقم من غير + بيفضل زي ما هو في الوضعين', () => {
      expect(format(dispatcherWith('msisdn'), '201000000777')).toBe('201000000777');
      expect(format(dispatcherWith('e164'), '201000000777')).toBe('201000000777');
    });
  });
});
