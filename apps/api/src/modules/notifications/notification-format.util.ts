/**
 * **تنسيق موحّد لنصوص الإشعارات** (تدقيق إشعارات 2026-09-21، بلاغ مالك).
 *
 * > «تشيكلي على الـnotification إن هي تكون مكتوبة بطريقة مظبوطة، التنسيق بتاعها كويس، الخط،
 * > التداخل العربي مع الإنجليزي، مع الأرقام، مع التواريخ، يكون كل ده مظبوط وما فيهوش أي صعوبة
 * > في القراءة… تأكد إن الـnotification فعلاً تكون قوية وجميلة وعصرية ولطيفة.»
 *
 * ## المشاكل المقيسة اللي الملف ده بيقفلها
 *
 * **١) نفس المستخدم كان بيشوف أرقام بشكلين مختلفين.** `toLocaleString('ar-EG')` بيطلّع أرقام
 * عربية-هندية (`١٢٬٥٠٠٫٥٠`, `٢١‏/٩‏/٢٠٢٦`)، بينما نصوص تانية بتستخدم `toFixed` فبتطلّع لاتينية
 * (`12500`). فإشعارين ورا بعض من نفس التطبيق بيبانوا كأنهم من نظامين مختلفين. واللاتيني هو
 * الصح هنا: أرقام الطلبات وأرقام التليفونات والمبالغ في باقي الواجهات كلها لاتينية، والخلط
 * بيخلي المقارنة بالعين صعبة.
 *
 * **٢) الفلوس كانت بتتقرّب في رسالة للمستخدم.** `toFixed(0)` و`Math.round(cents / 100)` بيحوّلوا
 * 12,500.50 ج.م لـ«12501 ج.م» — رقم فلوس **غلط** في رسالة، مش مجرد تنسيق. وكمان مفيش فاصل
 * آلاف في أي حتة، فـ«12501 ج.م» بتتقرا أصعب من «12,500.50 ج.م».
 *
 * **٣) وقت غلط بـ٣ ساعات.** `toLocaleString('ar-EG')` من غير `timeZone` بيرندر بتوقيت السيرفر
 * (UTC). موعد 10:30 م بالقاهرة كان بيوصل «٧:٣٠ م».
 *
 * **٤) تداخل عربي/إنجليزي (bidi).** رقم زي `P7-000123` جوّه جملة عربية، وبعده نقطة أو نقطتين،
 * بيترندر أحيانًا والعلامة في الناحية الغلط أو الرقم مقلوب. الحل المعياري هو عزل الاتجاه
 * (U+2068 FSI … U+2069 PDI) — بيقول للمُرندر «التوكن ده وحدة مستقلة»، ومابيظهرش كحرف.
 *
 * ## القاعدة
 *
 * أي نص إشعار فيه فلوس أو تاريخ أو رقم طلب/تليفون بيستخدم الدوال دي — مش `toFixed` ولا
 * `toLocaleString` مكتوبة في مكانها. كان فيه **٤ نسخ متطابقة** من دالة `egp()` في listeners
 * مختلفة قبل الملف ده.
 */

/** توقيت مصر — كل الأوقات متخزّنة UTC، والمستخدم بيقرا بتوقيته. */
const CAIRO = 'Africa/Cairo';

/**
 * `ar-EG-u-nu-latn` = صياغة عربية بأرقام لاتينية. مقصود: عربي للشهور وص/م، ولاتيني للأرقام.
 */
const AR_LATIN_DIGITS = 'ar-EG-u-nu-latn';

/** U+2068 FIRST STRONG ISOLATE — بداية جزيرة اتجاه مستقلة. */
const FSI = '⁨';
/** U+2069 POP DIRECTIONAL ISOLATE — نهايتها. */
const PDI = '⁩';

/**
 * **مبلغ بالجنيه من قروش** — فاصل آلاف، وكسور بتظهر **بس** لما تكون موجودة فعلاً.
 *
 * `12,500.50 ج.م` · `150 ج.م` · `1,200 ج.م`
 *
 * الكسور المشروطة مقصودة: أغلب المبالغ أرقام صحيحة، و«150.00 ج.م» بتبان آلية ومزعومة الدقة.
 * لكن لما يكون فيه قروش فعلاً **ممنوع** تختفي — ده كان بيغيّر الرقم نفسه.
 */
export function egp(amountCents: number): string {
  const safe = Number.isFinite(amountCents) ? amountCents : 0;
  const pounds = safe / 100;
  const hasPiasters = Math.round(safe) % 100 !== 0;
  const formatted = pounds.toLocaleString(AR_LATIN_DIGITS, {
    minimumFractionDigits: hasPiasters ? 2 : 0,
    maximumFractionDigits: 2,
  });
  // بلا نقطة بعد «ج.م» — كانت بتتكتب بالشكلين في نفس المنتج (٨ مرات من غير، ٤ بنقطة)،
  // والنقطة جنب حرف عربي بتتلخبط مع نقطة نهاية الجملة.
  return `${formatted} ج.م`;
}

/**
 * **تاريخ ووقت بتوقيت القاهرة** — `21 سبتمبر 2026، 10:30 م`.
 *
 * `timeZone` صريح مش اختياري: من غيره السيرفر بيرندر UTC والمستخدم بيقرا موعد غلط.
 */
export function arDateTime(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(AR_LATIN_DIGITS, {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: CAIRO,
  }).format(date);
}

/** تاريخ بلا وقت — للمواعيد اليومية اللي الساعة فيها مالهاش معنى. */
export function arDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(AR_LATIN_DIGITS, {
    dateStyle: 'long',
    timeZone: CAIRO,
  }).format(date);
}

/**
 * **عزل اتجاه لأي توكن لاتيني جوّه جملة عربية** — رقم طلب، رقم تليفون، كود.
 *
 * من غيره: «طلب رقم P7-000123.» ممكن تترندر والنقطة في أول السطر. المحارف دي **غير مرئية**
 * ومدعومة في Flutter والويب والإشعارات المنبثقة — مش حل تجميلي بنقوش.
 *
 * بتتعامل مع الفاضي بأمان: بترجّع نص فاضي بلا محارف عزل يتيمة.
 */
export function ltr(token: string | number | null | undefined): string {
  const text = token === null || token === undefined ? '' : String(token).trim();
  if (text === '') return '';
  return `${FSI}${text}${PDI}`;
}

/** «طلب رقم ⁨P7-000123⁩» — الصيغة الموحّدة لأي إشارة لطلب في نص إشعار. */
export function orderRef(orderNumber: string | null | undefined): string {
  const isolated = ltr(orderNumber);
  return isolated === '' ? 'الطلب' : `طلب رقم ${isolated}`;
}
