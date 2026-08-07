// بيكشف محاولات تبادل أرقام موبايل داخل الشات — أكبر تسريب للفنيين خارج المنصة (§14.6 في القاموس).
// كشف عملي بس، مش رياضي مضمون 100% (نفس أي فلتر نصي)، فبيتعامل معاه كـ "علم" (is_flagged) للمراجعة
// البشرية، مش رفض تلقائي للرسالة — رفض تلقائي كان هيضر تجربة رسائل شرعية فيها أرقام (عناوين، مواعيد).
const DIGIT_SEQUENCE_WITH_SEPARATORS = /(?:\d[\s.\-_]*){7,}/;
const EG_MOBILE_PREFIX = /(?:\+?20|0)?1[0125][\s.\-_]*\d[\s.\-_]*\d[\s.\-_]*\d[\s.\-_]*\d[\s.\-_]*\d[\s.\-_]*\d[\s.\-_]*\d/;

export function containsLikelyContactInfo(text: string | null | undefined): boolean {
  if (!text) return false;
  return DIGIT_SEQUENCE_WITH_SEPARATORS.test(text) || EG_MOBILE_PREFIX.test(text);
}
