/**
 * **بوابة: كل قيمة enum بيشوفها الأدمن لها اسم عربي.**
 *
 * بلاغ مالك 2026-09-17: «كلام مش معروف الكلام ده يعني». الفئة دي من الأعطال ليها سبب بنيوي
 * واحد: الـenum في الباك-إند بيكبر، والماپ العربي في اللوحة **مابيكبرش معاه** — ومحدش
 * بيلاحظ لأن الكود بيستخدم `LABELS[value] ?? value`، فالقيمة الناقصة بتعدّي كنص إنجليزي خام
 * من غير أي خطأ ولا تحذير.
 *
 * اتلقطت مرتين فعليًا وهي شغّالة في الإنتاج:
 *   - `duplicate_identity_attempt` (ADR-0045 §3) ناقص من `EVENT_TYPE_LABELS` في
 *     `/security-center` — وهو أكتر حدث أمني مرجّح يضرب.
 *   - سجل النشاط كله كان بيعرض المفاتيح خام (اتحلّ في `src/lib/audit-labels.ts`).
 *
 * السكربت بيقرا **الـenum من كود الباك-إند أو من Postgres** و**الماپ من كود اللوحة**، وبيفشل
 * بالاسم على أي قيمة ناقصة. القايمتين تحت بتتوسّعوا مع كل زوج (enum، ماپ) جديد.
 *
 * ### تحذير من الإيجاب الكاذب
 *
 * أول نسخة من المحلّل كانت بتقرا مفتاح واحد في السطر، فماپ مكتوب `open:'جديد', closed:'مغلق',`
 * في سطر واحد طلّع «٥ قيم ناقصة» وهي كلها موجودة. الإيجاب الكاذب هنا **أخطر** من السلبي: بيخلّي
 * حد يعدّل حاجة سليمة. قبل ما تصلّح أي بلاغ من السكربت ده، **افتح الماپ وشوف بعينك**.
 *
 *   node scripts/check-enum-labels.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * كل صف: enum في الباك-إند + الماپ اللي المفروض يغطّيه في الواجهة.
 *
 * `allow` للقيم اللي **مقصود** إنها مالهاش اسم عربي (قيم اختبارات، قيم legacy مش بتتعرض).
 */
const PAIRS = [
  {
    label: 'أنواع الأحداث الأمنية → /security-center',
    enumFile: 'apps/api/src/modules/security/entities/security-event.entity.ts',
    enumName: 'SecurityEventType',
    mapFile: 'apps/admin/src/app/security-center/page.tsx',
    mapName: 'EVENT_TYPE_LABELS',
  },
  {
    label: 'درجات خطورة الأحداث الأمنية → /security-center',
    enumFile: 'apps/api/src/modules/security/entities/security-event.entity.ts',
    enumName: 'SecurityEventSeverity',
    mapFile: 'apps/admin/src/app/security-center/page.tsx',
    mapName: 'SEVERITY_LABELS',
  },
  {
    label: 'حالات الطلب → جداول الطلبات',
    enumFile: 'apps/api/src/modules/orders/entities/order.entity.ts',
    enumName: 'OrderStatus',
    mapFile: 'apps/admin/src/lib/order-labels.ts',
    mapName: 'ORDER_STATUS_LABELS',
  },
  {
    label: 'حالات الدفع → جداول الطلبات',
    enumFile: 'apps/api/src/modules/orders/entities/order.entity.ts',
    enumName: 'OrderPaymentStatus',
    mapFile: 'apps/admin/src/lib/order-labels.ts',
    mapName: 'PAYMENT_STATUS_LABELS',
  },
  {
    label: 'أنواع الطلبات → جداول الطلبات',
    enumFile: 'apps/api/src/modules/orders/entities/order.entity.ts',
    enumName: 'OrderType',
    mapFile: 'apps/admin/src/lib/order-labels.ts',
    mapName: 'ORDER_TYPE_LABELS',
  },
];

/**
 * أزواج تانية مصدرها **enum في Postgres** مش TypeScript — دي المصدر الأصدق فعلاً، لأن أي
 * قيمة جوّاها ممكن توصل للـAPI ومنه للواجهة. محتاجة `DATABASE_URL` من `apps/api/.env`.
 */
const DB_PAIRS = [
  {
    label: 'حالات مطالبة الضمان → /warranty-claims',
    dbEnum: 'claim_status',
    mapFile: 'apps/admin/src/app/warranty-claims/page.tsx',
    mapName: 'CLAIM_STATUS_LABELS',
  },
  {
    label: 'حالات عروض التوزيع → مركز العمليات',
    dbEnum: 'order_assignment_status',
    mapFile: 'apps/admin/src/app/operations/page.tsx',
    mapName: 'DELIVERY_STATUS_LABELS',
  },
  {
    label: 'درجات خطورة الشكاوى → /support وبروفايلات العميل/الفني',
    dbEnum: 'complaint_severity',
    mapFile: 'apps/admin/src/lib/support-labels.ts',
    mapName: 'COMPLAINT_SEVERITY_LABELS',
  },
  {
    label: 'حالات الشكاوى → /support وبروفايلات العميل/الفني',
    dbEnum: 'complaint_status',
    mapFile: 'apps/admin/src/lib/support-labels.ts',
    mapName: 'COMPLAINT_STATUS_LABELS',
  },
  {
    label: 'تصنيفات الشكاوى → /support',
    dbEnum: 'complaint_category',
    mapFile: 'apps/admin/src/lib/support-labels.ts',
    mapName: 'COMPLAINT_CATEGORY_LABELS',
  },
  {
    label: 'درجات خطورة الشكاوى → مركز المراجعة',
    dbEnum: 'complaint_severity',
    mapFile: 'apps/admin/src/app/review-center/page.tsx',
    mapName: 'SEVERITY_LABELS',
  },
  {
    label: 'حالات الأحداث الأمنية → /security-center',
    dbEnum: 'security_event_status',
    mapFile: 'apps/admin/src/app/security-center/page.tsx',
    mapName: 'STATUS_LABELS',
  },
  {
    label: 'مستويات الفني → كل شاشات الفنيين',
    dbEnum: 'technician_level',
    mapFile: 'apps/admin/src/lib/technician-labels.ts',
    mapName: 'LEVEL_LABELS',
  },
  {
    label: 'حالات اعتماد الفني → /technicians',
    dbEnum: 'technician_verification_status',
    mapFile: 'apps/admin/src/lib/technician-labels.ts',
    mapName: 'VERIFICATION_STATUS_LABELS',
  },
  {
    label: 'حالات طلب الصرف → /payouts',
    dbEnum: 'payout_status',
    mapFile: 'apps/admin/src/lib/payments-labels.ts',
    mapName: 'PAYOUT_STATUS_LABELS',
  },
  {
    label: 'حالات الاسترداد → /refunds',
    dbEnum: 'refund_status',
    mapFile: 'apps/admin/src/lib/payments-labels.ts',
    mapName: 'REFUND_STATUS_LABELS',
  },
  {
    label: 'أولويات تذاكر الدعم → /support-tickets',
    dbEnum: 'support_ticket_priority',
    mapFile: 'apps/admin/src/lib/support-ticket-labels.ts',
    mapName: 'TICKET_PRIORITY_LABELS',
  },
  {
    label: 'حالات تذاكر الدعم → /support-tickets',
    dbEnum: 'support_ticket_status',
    mapFile: 'apps/admin/src/lib/support-ticket-labels.ts',
    mapName: 'TICKET_STATUS_LABELS',
  },
  {
    label: 'طرق الدفع → المحفظة والطلبات',
    dbEnum: 'payment_method',
    mapFile: 'apps/admin/src/lib/payments-labels.ts',
    mapName: 'PAYMENT_METHOD_LABELS_FULL',
  },
];

/** قيم `enum X { A = 'a', … }` — الأسماء النصية بس، لأن دي اللي بتوصل للواجهة. */
function enumValues(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.indexOf(`export enum ${name} {`);
  if (start === -1) throw new Error(`مش لاقي enum ${name} في ${file}`);
  const end = src.indexOf('\n}', start);
  const body = src.slice(src.indexOf('{', start) + 1, end);
  return [...body.matchAll(/=\s*'([^']+)'/g)].map((m) => m[1]);
}

/** مفاتيح ماپ في الواجهة، سواء `Record<...>` أو `as const`. */
function mapKeys(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = new RegExp(`(?:const|export const)\\s+${name}\\s*(?::[^=]*)?=\\s*\\{`);
  const match = re.exec(src);
  if (!match) throw new Error(`مش لاقي الماپ ${name} في ${file}`);
  const open = src.indexOf('{', match.index);
  // مفيش داعي لمحلّل كامل: الماپات دي مسطّحة (مفتاح: نص) ودايمًا بتقفل على `\n};`
  const end = src.indexOf('\n};', open);
  const body = src.slice(open + 1, end);
  return [...body.matchAll(/(?:^|[,{])\s*\[?'?([A-Za-z0-9_.]+)'?\]?\s*:/gm)].map((m) => m[1]);
}

/** قيم enum من Postgres. */
async function dbEnumValues(names) {
  const { Client } = require('pg');
  const url = (fs.readFileSync(path.join(ROOT, 'apps/api/.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m) ?? [])[1];
  if (!url) throw new Error('مفيش DATABASE_URL في apps/api/.env');
  const client = new Client({ connectionString: url.trim() });
  await client.connect();
  try {
    const res = await client.query(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) v
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = ANY($1) GROUP BY 1`,
      [names],
    );
    return new Map(res.rows.map((r) => [r.typname, r.v]));
  } finally {
    await client.end();
  }
}

let failed = false;
for (const pair of PAIRS) {
  let values;
  let keys;
  try {
    values = enumValues(pair.enumFile, pair.enumName);
    keys = new Set(mapKeys(pair.mapFile, pair.mapName));
  } catch (err) {
    console.log(`❌ ${pair.label}: ${err.message}`);
    failed = true;
    continue;
  }
  const allow = new Set(pair.allow ?? []);
  const missing = values.filter((v) => !keys.has(v) && !allow.has(v));
  if (missing.length === 0) {
    console.log(`✅ ${pair.label} — ${values.length} قيمة، كلها مترجمة`);
  } else {
    console.log(`❌ ${pair.label} — ${missing.length} قيمة بتتعرض بالإنجليزي:`);
    for (const v of missing) console.log(`     - ${v}  (ضيفها في ${pair.mapName} جوّه ${pair.mapFile})`);
    failed = true;
  }
}

async function main() {
  const wanted = [...new Set(DB_PAIRS.map((p) => p.dbEnum))];
  let dbValues;
  try {
    dbValues = await dbEnumValues(wanted);
  } catch (err) {
    console.log(`\n⚠️  مقدرناش نقرا enums الـDB (${err.message}) — أزواج الـDB ماتفحصتش.`);
    return;
  }
  for (const pair of DB_PAIRS) {
    const values = dbValues.get(pair.dbEnum);
    if (!values) {
      console.log(`❌ ${pair.label}: مفيش enum اسمه ${pair.dbEnum} في القاعدة`);
      failed = true;
      continue;
    }
    let keys;
    try {
      keys = new Set(mapKeys(pair.mapFile, pair.mapName));
    } catch (err) {
      console.log(`❌ ${pair.label}: ${err.message}`);
      failed = true;
      continue;
    }
    const allow = new Set(pair.allow ?? []);
    const missing = values.filter((v) => !keys.has(v) && !allow.has(v));
    if (missing.length === 0) {
      console.log(`✅ ${pair.label} — ${values.length} قيمة، كلها مترجمة`);
    } else {
      console.log(`❌ ${pair.label} — ${missing.length} قيمة بتتعرض بالإنجليزي:`);
      for (const v of missing) console.log(`     - ${v}  (ضيفها في ${pair.mapName} جوّه ${pair.mapFile})`);
      failed = true;
    }
  }
}

main()
  .then(() => {
    if (failed) {
      console.log('\nالقيمة الناقصة مابتكسرش الكود — `LABELS[v] ?? v` بيعدّيها كنص إنجليزي خام.');
      process.exit(1);
    }
    console.log('\n✅ مفيش قيمة enum بتوصل للأدمن بالإنجليزي.');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
