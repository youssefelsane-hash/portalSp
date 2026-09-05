import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * قفل استشاري لدورة مجدولة (تدقيق A-2).
 *
 * كل الـsweeps في المشروع `setInterval` جوّه العملية نفسها. ده كان صح لما كان فيه instance واحدة،
 * وبقى غلط بعد ما ADR-0073 خلّى التشغيل متعدد النسخ حقيقي: كل نسخة بتشغّل **نفس** الدورة على
 * **نفس** الصفوف في نفس الثانية. النتيجة مش بطء بس — دي سباقات حقيقية: طلبين اتلغوا بدل واحد،
 * تذكير اتبعت مرتين، دفعة اتحصّلت مرتين.
 *
 * `pg_try_advisory_lock` بيحسمها من غير أي بنية تحتية جديدة: أول نسخة تاخد القفل تشتغل، والباقي
 * بيرجعوا فورًا (مش بيستنوا — الدورة الجاية بعد دقيقة أهي). ولو العملية ماتت وهي ماسكة القفل،
 * Postgres بيسيبه لوحده مع نهاية الجلسة — مفيش قفل ميت محتاج تنظيف يدوي.
 *
 * **القفل على الجدولة مش على العملية**: `runExclusiveSweep` بتتلفّ حوالين نداء المؤقّت بس. نداء
 * مباشر (أدمن بيضغط زرار، سبيك بيختبر المنطق) بيفضل فوري بلا قفل — القفل غرضه يمنع تكرار
 * **الجدولة** عبر النسخ، مش يمنع حد ينادي العملية عن قصد.
 *
 * لازم `QueryRunner` مخصّص: القفل الاستشاري مربوط بالجلسة اللي أخدته، و`DataSource.query()`
 * بياخد اتصال عشوائي من الـpool كل مرة — فالفك ممكن يروح لاتصال تاني ويسيب القفل ماسك للأبد.
 */
export async function runExclusiveSweep<T>(
  dataSource: DataSource,
  lockName: string,
  sweep: () => Promise<T>,
  logger: Logger,
): Promise<T | null> {
  let runner;
  try {
    runner = dataSource.createQueryRunner();
    await runner.connect();
  } catch (err) {
    // القاعدة مش متاحة — الدورة دي بتتخطّى بأمان، والجاية هتلاقي الدنيا رجعت. مايصحّش نكسر
    // العملية عشان فشل بنية تحتية (نفس قاعدة CLAUDE.md #2).
    logger.warn(`تخطّي دورة ${lockName}: تعذّر فتح اتصال — ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  try {
    const rows = (await runner.query(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`, [
      lockName,
    ])) as { locked: boolean }[];
    const row = rows[0];
    if (row?.locked !== true) {
      // نسخة تانية ماسكة الدورة دي دلوقتي — سلوك طبيعي متوقّع، مش خطأ.
      return null;
    }
    try {
      return await sweep();
    } finally {
      await runner.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [lockName]);
    }
  } catch (err) {
    logger.error(`فشل دورة ${lockName}`, err instanceof Error ? err.stack : err);
    return null;
  } finally {
    await runner.release();
  }
}
