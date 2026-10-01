/**
 * **رقم الموبايل بالشكل اللي المصري بيكتبه** (docs/08 §189 بند UX-1).
 *
 * هوية الحساب على السيرفر E.164 (`+2010…`) ومش هتتغيّر. اللي بيتغيّر إن المستخدم يكتب `010…` زي ما
 * بيعرف رقمه، والتحويل بيحصل هنا قبل النداء — **نفس القاعدة بالحرف** اللي في
 * `apps/customer-app/lib/core/phone_number.dart` و`apps/technician-app` (010/011/012/015 + 8 أرقام).
 */

const EGYPTIAN_LOCAL_MOBILE = /^01[0125][0-9]{8}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** مسافات/شرط/أقواس بتتشال؛ `01xxxxxxxxx` ⇒ `+201xxxxxxxxx`؛ أي حاجة تانية بترجع زي ما هي. */
export function phoneNumberForApi(input: string): string {
  const phone = input.trim().replace(/[\s()-]/g, '');
  if (EGYPTIAN_LOCAL_MOBILE.test(phone)) return `+20${phone.slice(1)}`;
  return phone;
}

export function isValidPhoneInput(input: string): boolean {
  return E164.test(phoneNumberForApi(input));
}

/** عكس التحويل للعرض: `+2010…` ⇒ `010…` (الرقم المصري بس). */
export function phoneNumberForDisplay(input: string): string {
  const phone = input.trim();
  if (/^\+201[0125][0-9]{8}$/.test(phone)) return `0${phone.slice(3)}`;
  return phone;
}
