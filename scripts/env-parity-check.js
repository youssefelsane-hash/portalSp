#!/usr/bin/env node
/**
 * **ج-١٤ — Staging قريب من Production**.
 *
 * القيمة الوحيدة لبيئة staging إنها **تكشف الأعطال قبل العملاء**. staging مختلفة عن الإنتاج
 * في حاجة جوهرية بتدّي العكس بالظبط: ثقة كاذبة. أشهر ثلاث حالات — وكلهم حصلوا في مشاريع
 * حقيقية:
 *   1. **staging بلا Redis** ⇒ الطوابير بتشتغل مباشرةً، فبَقّة التوزيع اللي بتظهر تحت الطابور
 *      مابتظهرش خالص.
 *   2. **staging بتخزين محلي والإنتاج على S3** ⇒ كل مسارات الروابط والصلاحيات مختلفة، فالرفع
 *      «شغّال» في staging ومكسور في الإنتاج (اتلقط فعلاً في ج-١٣).
 *   3. **staging بإعدادات أرخى** (CORS مفتوح، أسرار افتراضية، throttle معطّل) ⇒ بتعدّي حاجات
 *      الإنتاج بيرفضها وقت الإقلاع، فالنشر بيفشل **بعد** ما staging قالت تمام.
 *
 * السكريبت ده بيقارن بيئة بالفعل مع ما تتطلبه بيئة production-like، وبيميّز صراحةً بين:
 *   - **فرق مسموح** (أسرار مختلفة، أسماء نطاقات مختلفة، بيانات مختلفة) — ده المقصود من العزل.
 *   - **فرق خطير** (سوّاق تخزين مختلف، Redis ناقص، إعداد أرخى) — ده اللي بيبطّل قيمة staging.
 *
 *   node scripts/env-parity-check.js [--env apps/api/.env] [--as staging|production]
 *
 * `--as` بيقول «افحص الملف ده كأنه هيتنشر في البيئة دي». الافتراضي `staging` — لأن الفحص
 * الأهم هو: **هل staging بتحاكي الإنتاج فعلاً؟**
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const envPath = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : path.join(ROOT, 'apps/api/.env');
const targetEnv = argv.includes('--as') ? argv[argv.indexOf('--as') + 1] : 'staging';

const results = [];
function check(name, ok, detail, severity = 'خطير') {
  results.push({ name, ok, detail, severity });
  console.log(`${ok ? '✅' : severity === 'خطير' ? '❌' : '⚠️ '} ${name} — ${detail}`);
}

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * القيم اللي **لازم تتطابق بين staging والإنتاج** — دي اللي بتحدّد شكل النظام مش هويته.
 * تغيير أي واحدة فيهم بيخلّي staging بتختبر نظامًا تانيًا.
 */
const MUST_MATCH_SHAPE = [
  ['STORAGE_PROVIDER', 'سوّاق التخزين — محلي مقابل s3 بيغيّر شكل الروابط والصلاحيات بالكامل'],
  ['NODE_ENV', 'لازم production-like (staging أو production) وإلا كل حُرّاس fail-fast بتتخطّى'],
];

/**
 * القيم اللي **لازم تختلف** — تطابقها معناه إن staging بتلمس بيانات/فلوس الإنتاج الحقيقية.
 */
const MUST_DIFFER = [
  ['DATABASE_URL', 'staging على قاعدة الإنتاج = تدقيق بيمسح بيانات عملاء حقيقية'],
  ['S3_BUCKET', 'نفس البكت = ملفات اختبار مع ملفات عملاء'],
  ['JWT_ACCESS_SECRET', 'نفس السر = توكن staging شغّال على الإنتاج'],
];

function main() {
  console.log(`\n=== ج-١٤: تطابق البيئات — بيفحص ${path.relative(ROOT, envPath)} كأنها ${targetEnv} ===\n`);
  const env = readEnv(envPath);
  if (!env) {
    console.error(`❌ الملف مش موجود: ${envPath}`);
    process.exit(2);
  }

  // ---- ١: هل الملف هيعدّي أصلاً على حُرّاس الإقلاع؟ ----
  //
  // ده أهم فحص: `env.validation.ts` بيرفض الإقلاع في بيئة production-like لو أي سر افتراضي أو
  // CORS مفتوح. تشغيل نفس التحقق **هنا** بيكشف الفشل قبل النشر بدل ما السيرفر يقع بعد الدفع.
  let bootOk = false;
  let bootDetail = '';
  try {
    const out = execFileSync(
      process.execPath,
      [
        '-e',
        `
        const path=require('path');
        require('${path.join(ROOT, 'node_modules/ts-node')}/register');
        const { envValidationSchema } = require('${path.join(ROOT, 'apps/api/src/config/env.validation.ts')}');
        const env = ${JSON.stringify({ ...env, NODE_ENV: targetEnv })};
        const { error } = envValidationSchema.validate(env, { allowUnknown: true, abortEarly: false });
        if (error) { console.log('FAIL:' + error.details.map(d => d.message).join(' | ')); }
        else console.log('OK');
        `,
      ],
      { cwd: path.join(ROOT, 'apps/api'), encoding: 'utf8', env: { ...process.env, TS_NODE_TRANSPILE_ONLY: 'true' } },
    ).trim();
    bootOk = out.endsWith('OK');
    bootDetail = bootOk ? `الملف بيعدّي حُرّاس الإقلاع كـ${targetEnv}` : out.replace('FAIL:', '').slice(0, 400);
  } catch (err) {
    bootDetail = `مقدرناش نشغّل التحقق: ${String(err.message ?? err).slice(0, 200)}`;
  }
  check(`ط-١ الملف بيعدّي حُرّاس إقلاع ${targetEnv} (fail-fast)`, bootOk, bootDetail);

  // ---- ٢: شكل النظام واحد ----
  for (const [key, why] of MUST_MATCH_SHAPE) {
    const value = env[key] ?? '';
    if (key === 'NODE_ENV') {
      const ok = ['staging', 'production'].includes(value);
      check(
        `ط-٢ ${key} production-like`,
        ok,
        ok ? `${value}` : `${value || '(فاضي)'} — ${why}`,
      );
    } else {
      const ok = value.length > 0;
      check(`ط-٢ ${key} محدّد صراحةً`, ok, ok ? `${value} — ${why}` : `فاضي ❗ ${why}`);
    }
  }

  // ---- ٣: العزل عن الإنتاج ----
  //
  // الفحص ده مش بيقدر يعرف قيم الإنتاج (وده مقصود — مايصحش السكريبت يشوفها). اللي بيقدر
  // يعمله: يتأكد إن القيم **مش من القيم الافتراضية/التطويرية المعروفة** ويطلب تأكيدًا بشريًا
  // على الباقي.
  const devMarkers = ['localhost', '127.0.0.1', 'change-me', 'baytak:baytak', 'test'];
  for (const [key, why] of MUST_DIFFER) {
    const value = env[key] ?? '';
    const looksDev = devMarkers.some((m) => value.includes(m));
    check(
      `ط-٣ ${key} مش قيمة تطويرية`,
      !looksDev && value.length > 0,
      value.length === 0
        ? `فاضي ❗`
        : looksDev
          ? `فيه علامة تطويرية (${devMarkers.find((m) => value.includes(m))}) — ${why}`
          : 'قيمة مخصّصة',
      'خطير',
    );
  }

  // ---- ٤: الاعتماديات الحقيقية موجودة ----
  //
  // «staging بلا Redis» أخطر فرق ممكن: كل مسارات الطوابير والكاش بتاخد المسار الاحتياطي،
  // فالبَقّات اللي بتظهر تحت الطابور بس مابتظهرش خالص.
  check(
    'ط-٤/أ Redis محدّد (staging بلا Redis بتخفي كل بَقّات الطوابير)',
    !!env.REDIS_URL || !!env.REDIS_HOST,
    env.REDIS_URL ?? env.REDIS_HOST ?? 'مفيش ❗',
  );
  check(
    'ط-٤/ب قاعدة البيانات محدّدة',
    !!env.DATABASE_URL,
    env.DATABASE_URL ? env.DATABASE_URL.replace(/:[^:@]*@/, ':***@') : 'مفيش ❗',
  );

  // ---- ٥: مفيش تخفيف مقصود ----
  //
  // القيم دي بتُضبط أحيانًا في التطوير عشان أدوات التدقيق (موثّق في `app.module.ts`)، ولو
  // تسرّبت لـstaging بتخلّيها تختبر نظامًا أرخى من الإنتاج.
  const LOOSENERS = [
    ['THROTTLE_LIMIT', (v) => Number(v) > 1000, 'سقف throttle عالي جدًا = الحدود عمليًا معطّلة'],
    ['CORS_ORIGIN', (v) => v === '*' || v === '', 'CORS مفتوح للكل'],
  ];
  for (const [key, isLoose, why] of LOOSENERS) {
    const value = env[key];
    const loose = value !== undefined && isLoose(value);
    check(`ط-٥ ${key} مش مخفَّف`, !loose, loose ? `${value} — ${why} ❗` : `${value ?? '(الافتراضي)'}`);
  }

  // ---- ٦: كل مفتاح في `.env.example` له قيمة ----
  //
  // `.env.example` هو العقد المكتوب للبيئة. مفتاح فيه ومش في الملف ده = إعداد ناقص هيظهر
  // كسلوك غريب وقت التشغيل مش كخطأ واضح.
  const example = readEnv(path.join(ROOT, 'apps/api/.env.example'));
  const missing = example ? Object.keys(example).filter((k) => !(k in env)) : [];
  check(
    'ط-٦ كل مفتاح في .env.example موجود في الملف',
    missing.length === 0,
    missing.length ? `ناقص ${missing.length}: ${missing.slice(0, 8).join('، ')}${missing.length > 8 ? '…' : ''}` : `${Object.keys(example ?? {}).length} مفتاح`,
    'تحذير',
  );

  // ---- الخلاصة ----
  const failures = results.filter((r) => !r.ok && r.severity === 'خطير');
  const warnings = results.filter((r) => !r.ok && r.severity !== 'خطير');
  console.log(`\n--- الخلاصة ---`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} نجحوا، ${warnings.length} تحذير`);
  if (failures.length) {
    console.log(`\n❌ فروق خطيرة (بتبطّل قيمة staging):`);
    for (const f of failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  console.log(
    `\nℹ️  الفحص ده **مابيشوفش قيم الإنتاج** عمدًا — بيقارن الملف بمتطلبات البيئة المستهدفة.\n` +
      `   التأكد إن staging والإنتاج على نفس إصدار Postgres/Redis نفسه بند نشر، ومكتوب في\n` +
      `   docs/runbooks/staging-parity.md.`,
  );
  process.exit(failures.length ? 1 : 0);
}

main();
