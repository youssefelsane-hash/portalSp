/**
 * **المضاعف بالمية** — طلب مالك صريح 2026-09-17.
 *
 * «عادي لو أنا عايز أزود 4% بس… يعني واحد من واحد من المية لحد 100%، مش عايز حاجة معقدة أوي…
 * بس يكون إيه كل معاملات المية موجودة».
 *
 * الأدمن بيفكّر بـ«كم في المية أزود»، والقاعدة بتخزّن **مضاعف** (`numeric(x,2)`). الدالة دي
 * بتترجم بين الاتنين في العرض، عشان الأدمن يتأكد إن 1.04 = زيادة ٤٪ قبل ما يحفظ — من غيرها
 * كان بيكتب رقم ويحفظ وهو مش متأكد معناه.
 *
 * مفيش أي تحويل في المحفوظ: القيمة المرسَلة هي المضاعف زي ما هو.
 */
export function describeMultiplier(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return 'اكتب المضاعف (مثال: 1.04 = زيادة ٤٪).';
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 'المضاعف لازم يكون رقم أكبر من صفر.';
  // فرق المية من ١ — التقريب لخانتين عشريتين بيمنع 1.1 من إنها تطلع «9.999999%».
  const deltaPercent = Math.round((value - 1) * 10000) / 100;
  if (deltaPercent === 0) return `×${value} — نفس السعر الأساسي بلا زيادة ولا خصم.`;
  if (deltaPercent > 0) return `×${value} — زيادة ${deltaPercent}% فوق السعر الأساسي.`;
  return `×${value} — خصم ${Math.abs(deltaPercent)}% من السعر الأساسي.`;
}

/** نفس الفكرة لخانة نسبة مئوية مباشرة (تعديل المنطقة مثلاً). */
export function describePercentage(raw: string | number | null | undefined, unitAr = 'السعر الأساسي'): string {
  if (raw === null || raw === undefined || raw === '') return `اكتب النسبة (مثال: 4 = زيادة ٤٪ على ${unitAr}).`;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 'النسبة لازم تكون رقم.';
  if (value === 0) return `صفر — ${unitAr} بلا تعديل.`;
  return value > 0 ? `زيادة ${value}% على ${unitAr}.` : `خصم ${Math.abs(value)}% من ${unitAr}.`;
}
