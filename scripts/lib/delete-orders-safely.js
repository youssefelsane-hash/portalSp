/**
 * حذف طلبات بترتيب آمن للمفاتيح الأجنبية — **المنطق نفسه**، مستقل عن واجهة سطر الأوامر.
 *
 * ليه ده موجود كمكتبة مش جوّه `clean-test-data.js` بس: المنطق كان محبوس في IIFE بتاعة الـCLI،
 * فأي تدقيق محتاج ينضّف وراه كان بيكتب `DELETE FROM orders WHERE order_number LIKE …` بإيده —
 * وده بيفشل أول ما جدول جديد يشاور على `orders`. حصل فعلاً في `booking-suggestion-audit`:
 * وقع على `chat_threads_order_id_fkey` فمانضّفش وراه، وكل تشغيلة بعدها كانت بتقع على نفس
 * البقايا (تدقيق §148، المرحلة ٩). القاعدة اللي في CLAUDE.md بالظبط: مانعملش نسخة تانية من
 * حاجة موجودة — نستخرجها ونستعملها.
 *
 * بيسأل `pg_constraint` عن الجداول اللي بتشاور على `orders` فعلاً بدل قايمة مكتوبة بالإيد
 * (القايمة بتقدم، الكتالوج لأ).
 */

/**
 * حذف صفوف جدول **مع أحفاده** — جدول بيشاور على `orders` ممكن يكون هو نفسه مشار إليه من
 * جدول تالت (`refunds.payment_id → payments.id` مثلاً)، فحذف الأب قبل الابن بيفشل.
 */
async function deleteWithDependents(db, table, column, values, log, depth = 0) {
  if (depth > 3) return 0;
  let removed = 0;
  const { rows: children } = await db.query(
    `SELECT c.conrelid::regclass::text AS table_name,
            a.attname                  AS column_name,
            c.confdeltype              AS on_delete
       FROM pg_constraint c
       JOIN unnest(c.conkey) k(attnum) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.confrelid = $1::regclass AND c.contype = 'f'`,
    [table],
  );
  for (const child of children) {
    if (child.table_name === table) continue;
    if (child.on_delete === 'c' || child.on_delete === 'n') continue;
    const { rows: doomed } = await db
      .query(
        `SELECT id FROM ${child.table_name} WHERE ${child.column_name} IN (SELECT id FROM ${table} WHERE ${column} = ANY($1::uuid[]))`,
        [values],
      )
      .catch(() => ({ rows: null })); // جدول بلا عمود `id` — بيتحذف مباشرةً تحت
    if (doomed && doomed.length) {
      removed += await deleteWithDependents(db, child.table_name, 'id', doomed.map((d) => d.id), log, depth + 1);
    } else {
      const res = await db.query(
        `DELETE FROM ${child.table_name} WHERE ${child.column_name} IN (SELECT id FROM ${table} WHERE ${column} = ANY($1::uuid[]))`,
        [values],
      );
      if (res.rowCount) log(`  ${String(res.rowCount).padStart(5)} من ${child.table_name}`);
      removed += res.rowCount;
    }
  }
  const res = await db.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [values]);
  if (res.rowCount) log(`  ${String(res.rowCount).padStart(5)} من ${table}`);
  return removed + res.rowCount;
}

/**
 * بيحذف الطلبات اللي `ids` بتشاور عليها وكل الصفوف المرتبطة بيها. **الكولر مسؤول عن
 * الترانزاكشن** — عشان التدقيق يقدر يضمّه لتنظيفه هو.
 */
async function deleteOrdersById(db, ids, { log = () => {} } = {}) {
  if (!ids.length) return { orders: 0, related: 0 };

  const { rows: refs } = await db.query(`
    SELECT c.conrelid::regclass::text AS table_name,
           a.attname                  AS column_name,
           c.confdeltype              AS on_delete
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.confrelid = 'orders'::regclass AND c.contype = 'f'`);

  let related = 0;
  for (const r of refs) {
    if (r.table_name === 'orders') continue; // parent_order_id — بيتعامل معاه بالحذف نفسه
    if (r.on_delete === 'c' || r.on_delete === 'n') continue; // CASCADE/SET NULL بيتصرفوا لوحدهم
    related += await deleteWithDependents(db, r.table_name, r.column_name, ids, log);
  }
  const del = await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [ids]);
  return { orders: del.rowCount, related };
}

/** نفس الحذف بس بشرط SQL على `orders` (مثلاً `order_number LIKE 'BSG-%'`). */
async function deleteOrdersWhere(db, whereSql, params, options) {
  const { rows } = await db.query(`SELECT id FROM orders WHERE ${whereSql}`, params);
  return deleteOrdersById(db, rows.map((r) => r.id), options);
}

module.exports = { deleteOrdersById, deleteOrdersWhere };
