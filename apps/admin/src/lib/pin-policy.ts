/**
 * **قواعد رمز الدخول على الواجهة** — مرآة `apps/api/src/modules/auth/login-pin.policy.ts`.
 *
 * الباك-إند هو الحكم دايمًا (`validatePinFormat`)؛ ده فحص محلي بيوفّر رحلة شبكة ورسالة أسرع.
 *
 * **اتطلّع من `change-pin-card.tsx`** عشان شاشة تنشيط الحساب (ADR-0111) تستخدم **نفس** القاعدة:
 * نسخة تانية معناها شاشة بتقبل رمز والتانية بترفضه، والمستخدم مش فاهم ليه.
 */

/** الرمز الجديد **ستة أرقام بالظبط** (main 61acc31d). الأربعة مسموحين في **الدخول** بس للقدامى. */
export const PIN_LENGTH = 6;
export const LEGACY_PIN_MIN_LENGTH = 4;

/** نفس قاعدة `isWeakPin` في `login-pin.policy.ts` بالحرف — الباك-إند بيفحص تاني. */
export function isWeakPin(pin: string): boolean {
  if (new Set(pin).size === 1) return true;
  const digits = [...pin].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

/** بيرجّع رسالة الخطأ أو `null` لو الرمز سليم. */
export function localPinError(pin: string): string | null {
  if (pin.length !== PIN_LENGTH) return `رمز الدخول لازم يكون ${PIN_LENGTH} أرقام`;
  if (isWeakPin(pin)) return 'الرمز ده سهل التخمين — اختار رمز مش متسلسل ومش كله نفس الرقم';
  return null;
}

/** طول كود التنشيط/الاسترجاع — مطابق لـ`PIN_RESET_CODE_LENGTH` في الباك-إند. */
export const ACTIVATION_CODE_LENGTH = 10;
