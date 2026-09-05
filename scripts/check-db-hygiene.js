#!/usr/bin/env node
/**
 * حارس نظافة مخطّط قاعدة البيانات — بيمنع رجوع تلات فئات اتلقطوا في التدقيق الشامل
 * (D-1، D-3، DB-1) بدل ما يتصلّحوا مرة ويتراكموا تاني.
 *
 * الفئات التلاتة كلها اتراكمت **بصمت**: مفيش اختبار ولا لينت بيشوف مخطّط القاعدة، فالمراجعة
 * بالعين كانت الحارس الوحيد — وهي اللي فشلت. الفحص ده بيشغّل استعلامات على القاعدة الحيّة.
 *
 *   1. **FK بلا فهرس** (DB-1) — Postgres مابيعملش فهرس تلقائي على الطرف المُشير، فأي
 *      DELETE/UPDATE على الجدول الأب بيعمل seq scan على الابن كله.
 *   2. **فهارس مكرّرة** (D-3) — نفس العمود ونفس الشرط بأسماء مختلفة: تكلفة كتابة ومساحة
 *      بلا أي مقابل.
 *   3. **أنواع enum يتيمة** (D-1) — مصطلحات في المخطّط مالهاش أي عمود؛ بتضلّل أي حد بيقرا.
 *
 * الاستخدام:
 *   DATABASE_URL=postgres://... node scripts/check-db-hygiene.js
 *
 * **مفيش قايمة استثناءات عمدًا.** الإغراء الطبيعي هنا إننا نستثني «الجداول الصغيرة»، بس أي
 * قايمة زي دي بتتآكل: جدول بيتحسب صغير النهارده بيكبر بعد سنة ومحدش بيرجع يراجع القايمة.
 * وتكلفة الفهرس على جدول قليل الكتابة ≈ صفر أصلاً. فالقاعدة مطلقة وقابلة للفرض آليًا بلا أي
 * حكم بشري يختلف عليه اتنين.
 */
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('خطأ: لازم تحدد DATABASE_URL.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  const problems = [];

  // ── 1) مفاتيح أجنبية بلا فهرس داعم ────────────────────────────────────────
  const { rows: unindexedFks } = await client.query(`
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name,
           c.confrelid::regclass::text AS references_table
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) k(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace AND n.nspname = 'public'
    WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
      )
    ORDER BY 1, 2
  `);
  if (unindexedFks.length > 0) {
    problems.push(
      `❌ ${unindexedFks.length} مفتاح أجنبي بلا فهرس داعم — أي DELETE/UPDATE على الجدول الأب ` +
        `هيعمل seq scan على الابن كله:\n` +
        unindexedFks
          .map((r) => `     ${r.table_name}.${r.column_name} → ${r.references_table}`)
          .join('\n') +
        `\n   الحل: CREATE INDEX على العمود (مع WHERE ... IS NOT NULL لو بيقبل NULL).`,
    );
  }

  // ── 2) فهارس مكرّرة (نفس الجدول + نفس التعريف بعد شيل الاسم) ──────────────
  const { rows: dupIndexes } = await client.query(`
    SELECT tablename, array_agg(indexname ORDER BY indexname) AS names,
           regexp_replace(indexdef, 'INDEX \\S+ ON', 'INDEX ON') AS normalized
    FROM pg_indexes
    WHERE schemaname = 'public'
    GROUP BY tablename, normalized
    HAVING count(*) > 1
    ORDER BY tablename
  `);
  if (dupIndexes.length > 0) {
    problems.push(
      `❌ ${dupIndexes.length} فهرس مكرّر (نفس العمود ونفس الشرط باسمين مختلفين):\n` +
        dupIndexes.map((r) => `     ${r.tablename}: ${r.names.join(' == ')}`).join('\n') +
        `\n   الحل: DROP INDEX لواحد منهم.`,
    );
  }

  // ── 3) أنواع enum يتيمة ───────────────────────────────────────────────────
  const { rows: orphanEnums } = await client.query(`
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
    WHERE t.typtype = 'e'
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid AND c.relkind = 'r'
        WHERE a.atttypid = t.oid AND NOT a.attisdropped
      )
    ORDER BY 1
  `);
  if (orphanEnums.length > 0) {
    problems.push(
      `❌ ${orphanEnums.length} نوع enum يتيم (مالوش أي عمود) — بيضلّل أي حد بيقرا المخطّط:\n` +
        `     ${orphanEnums.map((r) => r.typname).join(', ')}\n` +
        `   الحل: DROP TYPE (من غير CASCADE عشان يفشل لو لسه فيه اعتماد).`,
    );
  }

  await client.end();

  if (problems.length > 0) {
    console.error(problems.join('\n\n'));
    process.exit(1);
  }

  console.log(
    `✅ نظافة المخطّط سليمة — صفر FK بلا فهرس، ` +
      `صفر فهرس مكرّر، صفر enum يتيم.`,
  );
}

main().catch((err) => {
  console.error('فشل فحص نظافة المخطّط:', err.message);
  process.exit(1);
});
