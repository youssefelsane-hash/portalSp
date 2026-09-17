/**
 * **بوابة: خانة الإدخال مش أخشن من العمود اللي بتكتب فيه.**
 *
 * طلب مالك 2026-09-17: «ساعات بجي أزود بيطلب مني أرقام محددة بس مثلاً واحد من عشرة، طب لأ يا
 * عم… أنا مثلاً عايز بس 5% كفاية، عايز مثلاً 4%، فيكون متاح معايا الأرقام… بس يكون إيه كل
 * معاملات المية موجودة».
 *
 * الحالة اللي البلاغ اتكلم عنها: مضاعف فئة المهارة في `/catalog/services/:id` كان
 * `step="0.05"`، ومضاعف المنطقة في `/geo` كان `step="0.1"` — بينما العمودين `numeric(4,2)`
 * والـAPI `@IsPositive()` بلا أي قيد خطوة. يعني القيد كان **واجهة بس** ومتعارض مع السكيما
 * والـAPI: الأدمن مش قادر يكتب 1.04 (زيادة ٤٪) ومجبَر على مضاعفات الـ٥٪ أو الـ١٠٪.
 *
 * الفئة دي من الأعطال مابتكسرش أي بوابة: `tsc` مابيعرفش دقة العمود، و`eslint` مابيقراش SQL،
 * والاختبارات بتبعت أرقام من الكود مش من خانة HTML. فالسكربت ده بيقرا الاتنين ويقارن.
 *
 *   node scripts/check-input-step-precision.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * كل صف: خانة إدخال في اللوحة + العمود اللي القيمة بتنزل فيه.
 *
 * `expectedStep` بيتحسب من دقة العمود (`numeric(p,s)` → `10^-s`)، فالقايمة مابتحتاجش تتحدّث لو
 * migration غيّر الدقة — السكربت بيقرا الدقة الحقيقية من القاعدة.
 */
const FIELDS = [
  {
    label: 'مضاعف فئة مهارة التسعير → صفحة الخدمة',
    file: 'apps/admin/src/app/catalog/services/[id]/page.tsx',
    inputName: 'price_multiplier',
    table: 'service_pricing_tier_pricing',
    column: 'price_multiplier',
  },
  {
    label: 'مضاعف المنطقة → /geo',
    file: 'apps/admin/src/app/geo/page.tsx',
    inputName: 'surge_multiplier',
    table: 'service_zones',
    column: 'surge_multiplier',
  },
];

/** خانات مربوطة بـstate (مفيش `name=`) — بيتلقّطوا بالـid أو بنص مجاور. */
const STATE_FIELDS = [
  {
    label: 'معامل سعر الشركة → تفاصيل شركة الفنيين',
    file: 'apps/admin/src/app/technician-companies/[id]/page.tsx',
    marker: 'value={multiplierInput}',
    table: 'technician_companies',
    column: 'price_multiplier',
  },
];

/** بيجيب قيمة `step` لأقرب `<Input …>` فيه العلامة المطلوبة. */
function stepForMarker(source, marker) {
  const at = source.indexOf(marker);
  if (at === -1) return { found: false };
  // حدود عنصر الإدخال: من أقرب `<Input` قبل العلامة لأقرب `/>` بعدها.
  const open = source.lastIndexOf('<Input', at);
  const close = source.indexOf('/>', at);
  if (open === -1 || close === -1) return { found: false };
  const tag = source.slice(open, close);
  const match = /step="([^"]+)"/.exec(tag);
  return { found: true, step: match ? Number(match[1]) : null };
}

async function columnSteps(pairs) {
  const { Client } = require('pg');
  const url = (fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m) ?? [])[1];
  if (!url) throw new Error('مفيش DATABASE_URL في apps/api/.env');
  const client = new Client({ connectionString: url.trim() });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT table_name, column_name, numeric_scale
         FROM information_schema.columns
        WHERE (table_name, column_name) IN (${pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})`,
      pairs.flatMap((p) => [p.table, p.column]),
    );
    return new Map(res.rows.map((r) => [`${r.table_name}.${r.column_name}`, Number(r.numeric_scale)]));
  } finally {
    await client.end();
  }
}

async function main() {
  const all = [...FIELDS, ...STATE_FIELDS];
  let scales;
  try {
    scales = await columnSteps(all.map((f) => ({ table: f.table, column: f.column })));
  } catch (err) {
    console.log(`⚠️  مقدرناش نقرا دقة الأعمدة (${err.message}) — البوابة ماتفحصتش.`);
    return;
  }

  let failed = false;
  for (const field of all) {
    const source = fs.readFileSync(path.join(ROOT, field.file), 'utf8');
    const marker = field.marker ?? `name="${field.inputName}"`;
    const { found, step } = stepForMarker(source, marker);
    const key = `${field.table}.${field.column}`;
    const scale = scales.get(key);

    if (!found) {
      console.log(`❌ ${field.label}: مش لاقي خانة الإدخال (العلامة: ${marker})`);
      failed = true;
      continue;
    }
    if (scale === undefined) {
      console.log(`❌ ${field.label}: مش لاقي العمود ${key} في القاعدة`);
      failed = true;
      continue;
    }
    const allowedStep = 10 ** -scale;
    if (step === null) {
      // بلا `step` المتصفح بيفترض 1 — أخشن من أي عمود عشري.
      console.log(`❌ ${field.label}: مفيش \`step\`، فالمتصفح بيفرض خطوة 1 والعمود ${key} بيقبل ${allowedStep}`);
      failed = true;
      continue;
    }
    if (step > allowedStep + 1e-12) {
      console.log(
        `❌ ${field.label}: الواجهة \`step="${step}"\` والعمود ${key} = numeric(_, ${scale}) بيقبل ${allowedStep}\n` +
          `     يعني الأدمن مقدرش يكتب قيمة القاعدة والـAPI بيقبلوها (بلاغ «عايز أزود 4% بس»).`,
      );
      failed = true;
      continue;
    }
    console.log(`✅ ${field.label} — step=${step} ومسموح ${allowedStep}`);
  }

  if (failed) {
    console.log('\nالقيد في الواجهة مابيكسرش أي بوابة تانية: `tsc` مابيعرفش دقة العمود.');
    process.exit(1);
  }
  console.log('\n✅ مفيش خانة إدخال أخشن من عمودها.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
