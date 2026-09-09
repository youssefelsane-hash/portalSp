/**
 * **مصدر واحد لفك شكل نتيجة `UPDATE`/`DELETE … RETURNING` من TypeORM.**
 *
 * القياس الحي (تدقيق ج-٤، 2026-09-09، على نفس Postgres/TypeORM اللي بيشتغلوا في الإنتاج):
 *
 * | الاستعلام | اللي `manager.query()` بترجّعه |
 * |---|---|
 * | `SELECT …` | `rows` |
 * | `INSERT … RETURNING …` | `rows` |
 * | **`UPDATE … RETURNING …`** | **`[rows, affectedCount]`** |
 * | **`DELETE … RETURNING …`** | **`[rows, affectedCount]`** |
 * | `WITH x AS (UPDATE … RETURNING …) SELECT … FROM x` | `rows` |
 *
 * يعني `UPDATE`/`DELETE` بس هما الشاذّين، والفرق **مايظهرش في الـtypes** — التوقيع بيقول
 * `Promise<any>`، فالكود بيعدّي من `tsc` وهو غلط. النتيجة العملية دايمًا واحدة: الحلقة بتلف
 * على عنصرين (مصفوفة الصفوف + الرقم) بدل الصفوف، وكل حقل بيطلع `undefined` **من غير أي خطأ**.
 *
 * الفشل ده مااتلقطش مرة واحدة — اتلقط **أربع مرات** في مواضع مختلفة (claim الأقساط المتكررة،
 * `stuck-selection-recovery`، تسوية الأقساط، وأخيرًا **الـsweep بتاعة استرداد المطابقة** اللي
 * فضلت شهور بتزوّد `matching_attempt_count` من غير ما تعيد توزيع ولا طلب واحد). كل مرة اتصلحت
 * محليًا بسطر `Array.isArray(raw[0]) ? … : …` مع تعليق، من غير قاعدة مشتركة — فالموضع الجديد
 * وقع في نفس الحفرة. الملف ده هو القاعدة المشتركة: **أي `UPDATE`/`DELETE … RETURNING` لازم
 * تعدّي من هنا**، بدل تكرار الحيلة.
 *
 * البديل المطروح والمرفوض: كتابة كل استعلام كـCTE بـ`SELECT` خارجي عشان يرجّع `rows` مباشرة.
 * ده بيشتغل فعلاً، لكنه بيخلي صحة الكود متوقّفة على شكل الـSQL — أي واحد يبسّط الاستعلام بعدين
 * بيرجّع البَقّة بصمت. التطبيع في الكود بيغطّي الشكلين.
 */

/** بيرجّع صفوف `RETURNING` مهما كان الشكل اللي الدرايفر رجّعه. */
export function returningRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  // `[rows, affectedCount]`: العنصر الأول مصفوفة. صف حقيقي من pg دايمًا كائن، مش مصفوفة،
  // فالفحص ده مايلتبسش مع نتيجة `SELECT` عادية.
  if (raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === 'number') {
    return raw[0] as T[];
  }
  if (Array.isArray(raw[0])) return raw[0] as T[];
  return raw as T[];
}

/** الصف الأول أو `undefined` — لاستعلام بيعدّل/بيمسح صف واحد بعينه. */
export function returningFirst<T>(raw: unknown): T | undefined {
  return returningRows<T>(raw)[0];
}
