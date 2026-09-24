import { HttpStatus } from '@nestjs/common';

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
 * نص الوقت الفاضل على فك القفل — بالدقايق أو بالساعات، بصيغة عربية طبيعية.
 *
 * بيتعرض للمستخدم عشان مايفضلش يجرّب في العمي. مش تسريب: ده رصيد حسابه هو، ومفيش فيه أي
 * إشارة لوجود الحساب من عدمه (الرسالة بتتقال بنفس الشكل للرقم المسجّل وغير المسجّل).
 */
export function lockRemainingTextAr(lockedUntil: Date, now: Date = new Date()): string {
  const ms = lockedUntil.getTime() - now.getTime();
  if (ms <= 0) return 'دلوقتي';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ساعة`;
}
