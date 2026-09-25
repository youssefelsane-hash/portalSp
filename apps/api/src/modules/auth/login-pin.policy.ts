import { HttpStatus } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * **سياسة رمز الدخول (PIN)** — ADR-0109.
 *
 * وحدة نقية بلا I/O عشان القواعد تتختبر لوحدها وتتشارك بين مسار التسجيل والدخول والاسترجاع
 * الإداري بلا تكرار. نفس فلسفة `otp-test-mode.ts`: القرار في مكان واحد مسمّى.
 */

/** ٤ أرقام أضعف من اللازم لحساب فيه فلوس، و٦ هو سقف شاشات الإدخال الموجودة. */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** نفس رصيد `otp_codes.max_attempts` بالظبط — المستخدم اتعوّد عليه. */
export const PIN_MAX_ATTEMPTS = 5;

/**
 * **تكلفة bcrypt للـPIN — ١٢، مش ١٠ زي باقي المشروع.** فرق مقصود ومحسوب.
 *
 * الـOTP بتكلفة ١٠ منطقي: الكود ٦ أرقام **بس بيموت في دقايق**، فالتكسير بلا فايدة بحكم الوقت.
 * الـPIN نفس الطول بالظبط لكنه **دائم**، فالمساحة كلها مليون احتمال قابلة للتجريب بلا عجلة لو
 * القاعدة اتسربت. التكلفة ١٢ = ٤ أضعاف العمل لكل تجربة (من ~٦٠ مللي لـ~٢٥٠ مللي على المعالج)،
 * وده بيحوّل مسح المليون من ساعات لأيام على نفس العتاد.
 *
 * الحد الأعلى مش عشوائي: التكلفة دي بتتدفع **مرة واحدة على الدخول** مش على كل request، ويوزر
 * بيستنى ربع ثانية مرة كل كام أسبوع (الـrefresh token هو الروتين، مش الـPIN).
 *
 * ### فجوة موثّقة صراحة: مفيش pepper
 *
 * الحماية الكاملة ضد التكسير بعد تسريب القاعدة هي **pepper** — سر في متغيّر بيئة بيتعمل بيه
 * HMAC للـPIN قبل الـbcrypt، فمن غير السر ده المليون احتمال مالوش أي معنى. مش مطبّق هنا عمدًا:
 * ضياع الـpepper = **كل** الـPINات تموت في نفس اللحظة بلا أي طريقة استرجاع غير reset إداري
 * لكل مستخدم. اللي بيقلّل خطورة الغياب ده إن الهجوم المتاح **online** بس، وسلّم القفل
 * (`PIN_LOCKOUT_LADDER_MINUTES`) بيقتله. لو اتقرر يتطبّق: لازم بادئة إصدار في `pin_hash`
 * (`v2$…`) عشان الهاشات القديمة والجديدة يتعايشوا والتدوير يبقى ممكن.
 */
export const PIN_BCRYPT_ROUNDS = 12;

/**
 * القفل بيطوّل مع التكرار بدل ما يبقى ثابت: ٥ محاولات ⇒ دقيقة، وبعدين ٥ ⇒ ٥ دقايق، وهكذا.
 * التدرّج بيخلي التخمين الآلي مستحيل عمليًا من غير ما يقفل مستخدم حقيقي نسي ودخل غلط مرتين.
 */
export const PIN_LOCKOUT_LADDER_MINUTES = [1, 5, 15, 60, 240] as const;

/**
 * أرقام ممنوعة — دي **مش** تزويد: `1234` و`0000` لوحدهم بيغطّوا نسبة مرعبة من أي PIN
 * بيتختار بلا قيد، وبيحوّلوا الحماية كلها لورق.
 *
 * القاعدة: ممنوع كل الأرقام متشابهة (`1111`)، وممنوع التسلسل صاعد أو نازل (`1234`, `4321`).
 * مافيش قايمة سوداء مكتوبة بالإيد — القاعدتين دول بيغطّوا نفس المساحة بلا صيانة.
 */
export function isWeakPin(pin: string): boolean {
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

export interface PinValidationFailure {
  code: 'length' | 'digits' | 'weak';
  messageAr: string;
  status: HttpStatus;
}

/**
 * بيتحقق من شكل الـPIN قبل أي هاش. بيرجّع `null` لو سليم.
 *
 * الرسايل موجّهة للمستخدم بالعامية زي باقي المنتج، وبتقول **إيه المطلوب** مش «قيمة غير صالحة».
 */
export function validatePinFormat(pin: unknown): PinValidationFailure | null {
  if (typeof pin !== 'string' || pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return {
      code: 'length',
      messageAr: `رمز الدخول لازم يكون من ${PIN_MIN_LENGTH} لـ${PIN_MAX_LENGTH} أرقام`,
      status: HttpStatus.BAD_REQUEST,
    };
  }
  if (!/^[0-9]+$/.test(pin)) {
    return { code: 'digits', messageAr: 'رمز الدخول أرقام بس', status: HttpStatus.BAD_REQUEST };
  }
  if (isWeakPin(pin)) {
    return {
      code: 'weak',
      messageAr: 'الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم',
      status: HttpStatus.BAD_REQUEST,
    };
  }
  return null;
}

/**
 * مدة القفل بعد استهلاك رصيد المحاولات.
 *
 * `failedAttempts` = العدد الكلي المتراكم. كل `PIN_MAX_ATTEMPTS` بتنقل لدرجة أعلى في السلّم،
 * وآخر درجة بتفضل سارية مهما زاد — مفيش قفل دائم يقفل مستخدم حقيقي برّه حسابه للأبد.
 */
export function lockoutMinutesFor(failedAttempts: number): number {
  const tier = Math.floor(failedAttempts / PIN_MAX_ATTEMPTS) - 1;
  const index = Math.min(Math.max(tier, 0), PIN_LOCKOUT_LADDER_MINUTES.length - 1);
  return PIN_LOCKOUT_LADDER_MINUTES[index];
}

/** هل المحاولة دي استهلكت الرصيد وبتستحق قفل؟ */
export function shouldLock(failedAttempts: number): boolean {
  return failedAttempts > 0 && failedAttempts % PIN_MAX_ATTEMPTS === 0;
}

/**
 * **هاش وهمي مايطابقش أي رمز** — علاج تعداد الحسابات بالتوقيت.
 *
 * ### القياس اللي أنشأ الثابت ده
 *
 * `verifyPinExclusively` كانت بترجّع «بيانات غلط» فورًا لو الرقم مش مسجّل — **من غير ما تشغّل
 * `bcrypt` خالص**. والنتيجة مقيسة على API حقيقي:
 *
 *     رقم مسجّل + رمز غلط : وسيط 331 مللي
 *     رقم مش مسجّل        : وسيط   6 مللي   ← فرق ×55
 *
 * يعني الرسالة الموحّدة (`invalidPinCredentials`) مكانت **مابتحمي حاجة**: نداء واحد بساعة
 * بيقول لأي حد لو رقم معيّن عنده حساب على المنصة أو لأ. ده تسريب بيانات شخصية بلا أي مصادقة،
 * وبيخالف ADR-0109 §5 صراحةً.
 *
 * العلاج المعياري: لما مايكونش فيه حساب، نشغّل مقارنة `bcrypt` على الهاش ده — نفس التكلفة
 * الحسابية بالظبط (نفس التكلفة ١٢)، ونتيجتها `false` دايمًا. الزمنين بيبقوا في نفس النطاق.
 *
 * ### ليه بيتولّد وقت التشغيل مش ثابت مكتوب في الكود
 *
 * هاش مكتوب بالإيد في الملف بيفضل سؤال مفتوح للأبد: «هو ده هاش إيه؟». الهاش هنا بيتحسب مرة
 * واحدة من `randomBytes(32)` **اللي بيترمى فورًا** — فمفيش نص صريح موجود في أي مكان يطابقه، لا
 * في الكود ولا في القاعدة ولا في ذاكرة العملية. ومحدش يقدر يلاقيه (ده هجوم preimage على
 * bcrypt). ولو حد جرّب أي قيمة، `bcrypt.compare` بترجّع `false` والتحقق بيرمي «بيانات غلط»
 * زي أي محاولة فاشلة.
 *
 * بيتحسب **متأخر (lazy)** مش وقت تحميل الموديول: التكلفة ١٢ معناها ~٣٢٥ مللي، ومحدش عايز
 * يدفعهم على إقلاع الخدمة لو مفيش محاولة دخول فاشلة حصلت أصلاً.
 */
let dummyHashPromise: Promise<string> | null = null;
export function pinDummyHash(): Promise<string> {
  dummyHashPromise ??= bcrypt.hash(randomBytes(32).toString('hex'), PIN_BCRYPT_ROUNDS);
  return dummyHashPromise;
}

/**
 * نص الوقت الفاضل على فك القفل — بالدقايق أو بالساعات، بصيغة عربية طبيعية.
 *
 * **مابيتعرضش للمستخدم خلاص** (قرار أمني، شوف `verifyPinExclusively`): رسالة بتقول «مقفول
 * لمدة كذا» مستحيل تتقال إلا لحساب **موجود**، فهي تعداد حسابات مؤكّد بغض النظر عن أي حاجة
 * تانية. متسيبة للسجلات والتشخيص الداخلي.
 */
export function lockRemainingTextAr(lockedUntil: Date, now: Date = new Date()): string {
  const ms = lockedUntil.getTime() - now.getTime();
  if (ms <= 0) return 'دلوقتي';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ساعة`;
}

/**
 * **كود استرجاع رمز الدخول** (ADR-0109 §6-ب).
 *
 * ١٥ دقيقة = مدة مكالمة دعم، مش أكتر. الكود بيتقال في مكالمة، فأي عمر أطول من كده هو نافذة
 * مفتوحة بلا مقابل.
 */
export const PIN_RESET_CODE_TTL_MINUTES = 15;

/** ٥ محاولات على الكود نفسه، وبعدها يبطل نهائيًا ولازم الدعم يصدر واحد جديد. */
export const PIN_RESET_MAX_ATTEMPTS = 5;

/**
 * **طول الكود ١٠ أرقام** — مش ٦ زي الـOTP.
 *
 * السبب فرق جوهري في نموذج التهديد: كود الـOTP بيوصل للجهاز اللي في إيد صاحبه، والمهاجم لازم
 * يخمّنه في دقايق قليلة مع قفل بعد ٥ محاولات. الكود ده بيتقال **في مكالمة**، والمهاجم اللي
 * يعرف رقم عميل يقدر يجرّب عليه من غير ما يعرف إن فيه استرجاع حاصل أصلاً. ١٠ أرقام = عشرة
 * مليارات احتمال، فالتخمين بلا معنى حتى قبل عدّاد المحاولات.
 */
export const PIN_RESET_CODE_LENGTH = 10;
