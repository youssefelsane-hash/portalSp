import { DataSource, EntityManager } from 'typeorm';

/**
 * المخرج الوحيد من تريجر عدم قابلية `audit_logs` للتعديل (migration 0271).
 *
 * الملف `*.testing.ts` مش `*.ts` عن قصد: ده اصطلاح المشروع لأدوات الاختبار (زي
 * `orders.testing.ts`)، و`audit-logs-immutability.spec.ts` بيفشل لو أي ملف إنتاج تحت
 * `src` استورده أو ذكر مفتاح `app.audit_purge` بنفسه.
 *
 * `set_config(..., true)` محلي للترانزاكشن، فلازم يبقى فيه ترانزاكشن حقيقي على **نفس**
 * الاتصال — عشان كده `QueryRunner` مخصص مش `dataSource.query()` اللي بياخد اتصال عشوائي
 * من الـpool.
 */
export async function purgeAuditLogs(
  source: DataSource | EntityManager,
  sql: string,
  params?: unknown[],
): Promise<void> {
  const dataSource = source instanceof DataSource ? source : source.connection;
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.audit_purge', 'on', true)`);
    await runner.query(sql, params);
    await runner.commitTransaction();
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }
}
