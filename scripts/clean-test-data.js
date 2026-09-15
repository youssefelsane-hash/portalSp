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
// نفس مصدر بيانات الاتصال اللي بتستخدمه كل التدقيقات الحية. من غير ده كان لازم `DATABASE_URL`
// تكون مُصدَّرة في الشِل، وغير كده الأداة بتقع بـ`FATAL 28000` (فشل مصادقة) اللي مابيقولش
// إن السبب إعداد ناقص — وده حصل فعلاً وقت مناداتها من سكربت تاني.
const { DATABASE_URL } = require('./lib/live-harness');
const { deleteOrdersById } = require('./lib/delete-orders-safely');

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
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const { rows: targets } = await db.query(`SELECT id FROM orders WHERE ${where}`, [param]);
    if (targets.length === 0) { console.log('مفيش طلبات مطابقة.'); await db.query('ROLLBACK'); return; }

    // المنطق نفسه في `lib/delete-orders-safely` عشان التدقيقات تقدر تنضّف وراها بنفس الطريقة
    // بدل ما كل واحد يكتب DELETE بإيده ويقع على أول FK جديد (تدقيق §148، المرحلة ٩).
    const { orders, related } = await deleteOrdersById(db, targets.map((r) => r.id), { log: (m) => console.log(m) });
    const del = { rowCount: orders };
    const total = related;
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
