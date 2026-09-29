/**
 * رابط محادثة واتساب (`https://wa.me/<رقم دولي>`) من رقم مكتوب بأي شكل — `null` لو مايصلحش
 * (docs/08 §185).
 *
 * **نفس قاعدة** `whatsappChatUri` في تطبيق العميل (`lib/core/external_links.dart`) وقاعدة
 * `DIGITS_ONLY` في `support-contact.controller.ts`: أرقام بس، ٦–٢٠ رقم، من غير `+`. بتقبل الرقم
 * زي ما الأدمن كاتبه في بيانات الجهة، فمفيش رقم تاني مكتوب في الكود يختلف عن اللي في الفوتر.
 */
export function whatsappChatUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // رقم موبايل مصري محلي (01xxxxxxxxx) — واتساب محتاجه بكود الدولة.
  if (digits.length === 11 && digits.startsWith('01')) digits = `2${digits}`;
  return /^[0-9]{6,20}$/.test(digits) ? `https://wa.me/${digits}` : null;
}
