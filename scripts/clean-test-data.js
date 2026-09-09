#!/usr/bin/env node
/**
 * حذف طلب (أو أكتر) بترتيب آمن للمفاتيح الأجنبية (docs/08 §132).
 *
 * **الاحتكاك اللي بيحلّه**: تنظيف بيانات اختبار حية بيفشل كل مرة على FK مختلف
 * (`order_status_history` → `chat_threads` → `notifications` → `payments` …)، فبيضيع وقت
 * في تجربة-وخطأ. السكربت ده بيسأل `pg_constraint` عن الجداول اللي بتشاور على `orders`
 * فعلاً، وبيحذف منها بالترتيب الصح — من غير أي قايمة مكتوبة بالإيد تقدم مع الوقت.
 *
 * الاستخدام:
 *   node scripts/clean-test-data.js --service <uuid>     كل طلبات خدمة
 *   node scripts/clean-test-data.js --order <uuid>       طلب واحد
 *   node scripts/clean-test-data.js --order-number-like 'P7-%'
 */
const { Client } = require('pg');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const [serviceId, orderId, numberLike] = [flag('--service'), flag('--order'), flag('--order-number-like')];

if (!serviceId && !orderId && !numberLike) {
  console.error('لازم تحدد --service أو --order أو --order-number-like');
  process.exit(1);
}

const where = serviceId ? `service_id = $1` : orderId ? `id = $1` : `order_number LIKE $1`;
const param = serviceId ?? orderId ?? numberLike;

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const { rows: targets } = await db.query(`SELECT id FROM orders WHERE ${where}`, [param]);
    if (targets.length === 0) { console.log('مفيش طلبات مطابقة.'); await db.query('ROLLBACK'); return; }
    const ids = targets.map((r) => r.id);

    // الجداول اللي بتشاور على orders — من الكتالوج نفسه، مش قايمة مكتوبة بالإيد.
    const { rows: refs } = await db.query(`
      SELECT c.conrelid::regclass::text AS table_name,
             a.attname                  AS column_name,
             c.confdeltype              AS on_delete
        FROM pg_constraint c
        JOIN unnest(c.conkey) k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.confrelid = 'orders'::regclass AND c.contype = 'f'`);

    /**
     * حذف صفوف جدول **مع أحفاده** — جدول بيشاور على `orders` ممكن يكون هو نفسه مشار إليه من
     * جدول تالت. اتلقطت حيًا: `refunds.payment_id → payments.id`، فحذف `payments` قبل `refunds`
     * بيفشل على `refunds_payment_id_fkey`. الحالة الخاصة القديمة (`chat_messages` تحت
     * `chat_threads`) كانت نفس الفئة بالظبط، متعالجة بالإيد لجدول واحد بس؛ دي بتعمّمها من
     * الكتالوج فمفيش جدول تالت جديد هيرجّع نفس الفشل تاني.
     */
    const deleteWithDependents = async (table, column, values, depth = 0) => {
      if (depth > 3) return 0;
      let removed = 0;
      const { rows: children } = await db.query(`
        SELECT c.conrelid::regclass::text AS table_name,
               a.attname                  AS column_name,
               c.confdeltype              AS on_delete
          FROM pg_constraint c
          JOIN unnest(c.conkey) k(attnum) ON true
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.confrelid = $1::regclass AND c.contype = 'f'`, [table]);
      for (const child of children) {
        if (child.table_name === table) continue;
        if (child.on_delete === 'c' || child.on_delete === 'n') continue;
        const { rows: doomed } = await db.query(
          `SELECT id FROM ${child.table_name} WHERE ${child.column_name} IN (SELECT id FROM ${table} WHERE ${column} = ANY($1::uuid[]))`,
          [values],
        ).catch(() => ({ rows: null })); // جدول بلا عمود `id` — بيتحذف مباشرةً تحت
        if (doomed && doomed.length) {
          removed += await deleteWithDependents(child.table_name, 'id', doomed.map((d) => d.id), depth + 1);
        } else {
          const res = await db.query(
            `DELETE FROM ${child.table_name} WHERE ${child.column_name} IN (SELECT id FROM ${table} WHERE ${column} = ANY($1::uuid[]))`,
            [values],
          );
          if (res.rowCount) console.log(`  ${String(res.rowCount).padStart(5)} من ${child.table_name}`);
          removed += res.rowCount;
        }
      }
      const res = await db.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [values]);
      if (res.rowCount) console.log(`  ${String(res.rowCount).padStart(5)} من ${table}`);
      return removed + res.rowCount;
    };

    let total = 0;
    for (const r of refs) {
      if (r.table_name === 'orders') continue;            // parent_order_id — بيتعامل معاه بالحذف نفسه
      if (r.on_delete === 'c' || r.on_delete === 'n') continue; // CASCADE/SET NULL بيتصرفوا لوحدهم
      total += await deleteWithDependents(r.table_name, r.column_name, ids);
    }
    const del = await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]);
    await db.query('COMMIT');
    console.log(`✅ اتمسح ${del.rowCount} طلب + ${total} صف مرتبط.`);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('❌ فشل التنظيف (اترجع كله):', err.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
