import { ConfigService } from '@nestjs/config';
import { normalizePhoneNumber } from '../../common/utils/phone-number';

/**
 * **وضع اختبار الـOTP — مؤقت لفترة Google Play Testing وبس** (docs/08 §173).
 *
 * حساب CEQUENS محتاج ٣٠ يوم على الدومين قبل ما يشتغل للإنتاج، وفترة الاختبار على Google Play
 * بتبدأ قبل كده. المختبرين لازم يقدروا يدخلوا من غير SMS حقيقي.
 *
 * ### القرار المعماري: الوضع ده بيشتغل عند **إصدار** الكود، مش عند **التحقق** منه
 *
 * الطلب الأصلي كان «اقبل 111111 وقت التحقق». اتنفّذ بشكل **أضيق**: في وضع الاختبار، الكود
 * اللي بيتولّد هو الكود الثابت بدل `randomInt`، والـSMS مابيتبعتش. ومسار التحقق
 * (`consumeOtpLocked`) **مافيهوش ولا فرع واحد لوضع الاختبار**.
 *
 * الفرق مهم:
 *   - كل الحمايات بتفضل سارية **بالبناء** مش بالاتفاق: الصلاحية، عدّاد المحاولات، إلغاء الكود
 *     الأقدم، القفل المتشائم، وقاعدة «كود واحد صالح للرقم/الغرض». مفيش حاجة محتاجة تتكرر.
 *   - أسوأ حالة لو العلم اتفعّل غلط = **الكود متوقّع**، مش «أي كود بيعدّي». لو كان البايباس في
 *     التحقق، أي رقم كان هيفتح أي حساب.
 *   - الشيل بعد الاختبار = حذف الملف ده + النداء الوحيد في `requestOtp()` + مفاتيح البيئة.
 *
 * ### تجربة المستخدم مابتتغيّرش
 *
 * نفس الشاشتين بالظبط: رقم الموبايل ← شاشة الكود ← إدخال الكود. مفيش أي مؤشر في التطبيق إن
 * فيه وضع اختبار، ومفيش أي حاجة الـclient بيبعتها بتتحكم فيه — القرار كله من بيئة السيرفر.
 *
 * ### الحارس
 *
 * `env.validation.ts` بيمنع الإقلاع أصلاً لو `NODE_ENV=production|staging` والوضع مفعّل.
 * فالفصل بين الاختبار والإنتاج مفروض عند الإقلاع، مش متروك لمراجعة بشرية.
 *
 * **ليه الحارس رجع صلب** (ADR-0109): الاستثناء اللي كان بيسمح بالوضع ده في الإنتاج اتعمل عشان
 * Closed Beta وقت ما الدخول كان بالـOTP ومزوّد الـSMS مش مُجهّز. الدخول بقى برقم + رمز،
 * فالمختبِر بيدخل برمزه زي أي مستخدم ومفيش أي حاجة محتاجة كود ثابت في الإنتاج.
 *
 * القائمة (`OTP_TEST_MODE_PHONES`) بتفضل للتطوير المحلي: فاضية = الوضع لكل الأرقام على القاعدة
 * المحلية، ومملياة = لأرقام بعينها بس (مفيد لو بتختبر مسار حقيقي ومسار ثابت جنب بعض).
 */
export interface OtpTestMode {
  readonly enabled: boolean;
  /** الكود الثابت اللي بيتولّد بدل العشوائي. */
  readonly fixedCode: string;
  /**
   * أرقام المختبرين بصيغة E.164 بعد التطبيع. **فاضية = أي رقم** — مقبول بس لما قاعدة بيانات
   * الاختبار منفصلة عن الإنتاج. لو البيئتين بيتشاركوا بيانات، املا القايمة دي.
   */
  readonly allowedPhones: readonly string[];
}

export const OTP_TEST_MODE_DISABLED: OtpTestMode = { enabled: false, fixedCode: '', allowedPhones: [] };

/** بيقرا الوضع من الإعدادات. مصدر واحد — مفيش `process.env` متناثر في الخدمات. */
export function readOtpTestMode(config: ConfigService): OtpTestMode {
  return config.get<OtpTestMode>('otp.testMode') ?? OTP_TEST_MODE_DISABLED;
}

/**
 * هل الرقم ده ياخد الكود الثابت؟
 *
 * بيقارن بالأرقام **بعد التطبيع** عشان `+201001234567` و`+20 100 123 4567` يبقوا نفس المفتاح —
 * نفس `normalizePhoneNumber` اللي الـDTO بيستخدمه، مش مقارنة نصية خام.
 *
 * صيغة مش قابلة للتحليل (زي بادئة `0020` اللي libphonenumber مابيفهمهاش من غير بلد افتراضي)
 * بتفضل زي ما هي، فمابتطابقش الرقم بصيغة E.164 الجاي من الـDTO. يعني **الفشل مقفول**: المختبر
 * بياخد كود حقيقي بـSMS بدل ما القايمة تتفتح لحد بالغلط.
 */
export function usesFixedOtp(mode: OtpTestMode, phoneNumber: string): boolean {
  if (!mode.enabled || !mode.fixedCode) return false;
  if (mode.allowedPhones.length === 0) return true;
  const normalized = normalizePhoneNumber(phoneNumber);
  return mode.allowedPhones.includes(typeof normalized === 'string' ? normalized : phoneNumber);
}

/** تطبيع قايمة أرقام المختبرين من متغيّر بيئة مفصول بفواصل. */
export function parseTestModePhones(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const normalized = normalizePhoneNumber(entry);
      return typeof normalized === 'string' ? normalized : entry;
    });
}
