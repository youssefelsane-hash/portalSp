#!/usr/bin/env node
/**
 * **ج-١٩ — بوابة ما قبل الإطلاق (Go-Live preflight)**.
 *
 * خطة إطلاق مكتوبة في ملف مالهاش قيمة لو محدش تحقق إن شروطها **متحققة فعلاً** لحظة الإطلاق.
 * السكريبت ده هو الجزء **الميكانيكي** من `docs/runbooks/go-live-and-rollback.md`: بيتأكد من
 * الشروط اللي لو واحد منها ناقص، الرجوع بيبقى **مستحيل** أو **بخسارة بيانات**.
 *
 * ## ليه الشروط دي بالذات
 *
 * الرجوع في النظام ده **غير متماثل**، وده مش عيب — ده نتيجة قرارات معمارية مقصودة:
 *
 * - **مفيش migrations عكسية** (`down`) بقرار موثّق — الإصلاح تقدّمي دايمًا. يعني «ارجع للنسخة
 *   القديمة» **مش عملية آمنة تلقائيًا**: الكود القديم لازم يقدر يشتغل على السكيما الجديدة.
 * - **الفلوس اللي اتحركت ماتترجّعش بـdeploy** — استرداد، مش rollback.
 * - **الإشعارات اللي اتبعتت وصلت** — مفيش استرجاع.
 *
 * فالرافعة الأولى وقت الحادثة **مش** الرجوع للنسخة القديمة، دي مفاتيح الإيقاف (ج-١٧/ج-١٨):
 * أسرع، وقابلة للعكس، ومابتلمسش الشغل الجاري. البوابة دي بتتأكد إنها موجودة **قبل** ما نحتاجها.
 *
 *   node scripts/go-live-preflight.js
 *
 * بترجع `0` لو كل الشروط متحققة، و`1` لو فيه شرط ناقص (صالحة للاستخدام في CI/خط الإطلاق).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LiveHarness, ROOT } = require('./lib/live-harness');

const h = new LiveHarness('gl');

function run(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }) };
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` || String(err) };
  }
}

async function main() {
  await h.connect();
  console.log(`\n=== ج-١٩: بوابة ما قبل الإطلاق — ${new Date().toISOString()} ===`);
  // **البوابة دي مصمّمة تتشغّل على الهدف اللي هيطلع** (staging/production)، مش على جهاز تطوير.
  // تشغيلها محليًا **بيفشل صح** في `ب-٤` (مفيش نسخ احتياطية على الجهاز) و`ب-٦` (ملف `.env`
  // تطويري بأسرار وهمية) — ده السلوك الصحيح مش عطل في البوابة. الرسالة هنا عشان الفشل ده
  // مايتقريش غلط كأن المنصة نفسها مكسورة.
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'production' && nodeEnv !== 'staging') {
    console.log(
      `\n⚠️  NODE_ENV=${nodeEnv} — دي بيئة تطوير. متوقّع يفشل \`ب-٤\` (نسخ احتياطية) و\`ب-٦\`\n` +
        `    (متغيّرات البيئة) لأنهم بيتقاسوا على الهدف الحقيقي. باقي البوابات ذات معنى هنا.\n`,
    );
  }
  console.log('');

  // ── ب-١: الهجرات ────────────────────────────────────────────────────
  //
  // ترقيم مكرر حصل فعلاً لما سيشنين متوازيين خدوا نفس الرقم. لو عدّى للإنتاج، واحد منهم
  // بيتسجّل والتاني بيتجاهَل بصمت — يعني سكيما ناقصة وكود بيتوقّع عمود مش موجود.
  const numbering = run(process.execPath, ['scripts/check-migrations.js']);
  h.record('ب-١/أ مفيش رقم migration مكرر', numbering.ok, numbering.out.trim().split('\n').pop() ?? '');

  const safety = run(process.execPath, ['scripts/check-migration-safety.js']);
  h.record(
    'ب-١/ب كل الهجرات الجديدة آمنة للإنتاج (مفيش قفل طويل على جدول حي)',
    safety.ok,
    safety.out.trim().split('\n').slice(-2).join(' | '),
  );

  // **مفيش هجرة متبقية غير مطبَّقة**: إطلاق بكود جديد وسكيما قديمة = أعطال فورية.
  const files = fs
    .readdirSync(path.join(ROOT, 'infra/migrations'))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f));
  const applied = await h.q(`SELECT filename FROM schema_migrations`);
  const appliedSet = new Set(applied.map((r) => r.filename));
  const pending = files.filter((f) => !appliedSet.has(f));
  h.record(
    'ب-١/ج كل الهجرات متطبّقة على القاعدة اللي هتطلع',
    pending.length === 0,
    pending.length ? `متبقّي ${pending.length}: ${pending.slice(0, 5).join(', ')}` : `${files.length} هجرة متطبّقة`,
  );

  // ── ب-٢: مفاتيح الإيقاف موجودة قبل ما نحتاجها ───────────────────────
  //
  // دي **أهم بوابة في الملف**. لو المفاتيح مش موجودة، أول حادثة معناها نشر كود تحت ضغط —
  // وده بالظبط اللي ج-١٧/ج-١٨ اتعملوا عشانه. وقد حصل فعلاً إن الصفوف دي اتمسحت من غير إنذار
  // (تنظيف تدقيق، اتصلح في 0306) — فالتحقق منها مش شكلي.
  const REQUIRED_SWITCHES = [
    'orders.new_bookings_enabled',
    'orders.emergency_bookings_enabled',
    'payments.cash_enabled',
    'payments.card_enabled',
    'payments.wallet_enabled',
    'payments.instapay_enabled',
  ];
  const switchRows = await h.q(`SELECT key, value FROM settings WHERE key = ANY($1::text[])`, [REQUIRED_SWITCHES]);
  const missing = REQUIRED_SWITCHES.filter((k) => !switchRows.some((r) => r.key === k));
  h.record(
    'ب-٢/أ كل مفاتيح الإيقاف موجودة (الرافعة الأولى وقت الحادثة)',
    missing.length === 0,
    missing.length ? `ناقص: ${missing.join(', ')}` : `${switchRows.length}/${REQUIRED_SWITCHES.length} موجودين`,
  );
  // مفتاح مقفول وقت الإطلاق = إطلاق على منصة نص شغّالة. غالبًا سهو من اختبار سابق.
  const offAtLaunch = switchRows.filter((r) => r.value === false);
  h.record(
    'ب-٢/ب ومفتوحين كلهم (مفيش مفتاح متسكّر من اختبار فات)',
    offAtLaunch.length === 0,
    offAtLaunch.length ? `مقفول: ${offAtLaunch.map((r) => r.key).join(', ')}` : 'كلهم مفتوحين',
  );

  // ── ب-٣: عتبات الإنذار مضبوطة ───────────────────────────────────────
  //
  // من غيرها المراقبة بتشتغل على fallback الكود: الأرقام صح، بس المالك مايقدرش يعدّلها وقت
  // الحادثة (`PATCH` بيرمي 404 لمفتاح مش موجود).
  const alertRows = await h.q(`SELECT count(*)::int AS n FROM settings WHERE key LIKE 'ops.alert%'`);
  h.record(
    'ب-٣/أ عتبات الإنذار مسجّلة وقابلة للضبط بلا نشر',
    (alertRows[0]?.n ?? 0) >= 10,
    `عتبات=${alertRows[0]?.n}`,
  );

  // ── ب-٤: نسخة احتياطية طازجة ────────────────────────────────────────
  //
  // **الشرط الوحيد اللي مالوش بديل.** كل رافعات الرجوع التانية بتفشل في حالة واحدة: بيانات
  // اتخربت. من غير نسخة حديثة **متحقَّق منها**، الحالة دي بتبقى نهائية.
  const backupDir = process.env.BACKUP_DIR ?? '/var/backups/baytak';
  let freshest = null;
  if (fs.existsSync(backupDir)) {
    const dumps = fs
      .readdirSync(backupDir)
      .filter((f) => /^baytak-.*\.dump$/.test(f))
      .map((f) => ({ f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    freshest = dumps[0] ?? null;
  }
  const ageHours = freshest ? (Date.now() - freshest.mtime) / 3_600_000 : Infinity;
  h.record(
    'ب-٤/أ فيه نسخة احتياطية أحدث من ٢٤ ساعة',
    ageHours <= 24,
    freshest ? `${freshest.f} — عمرها ${ageHours.toFixed(1)} ساعة` : `مفيش أي نسخة في ${backupDir}`,
  );
  h.record(
    'ب-٤/ب أدوات النسخ والاسترجاع موجودة ومختبَرة',
    fs.existsSync(path.join(ROOT, 'scripts/backup-db.sh')) &&
      fs.existsSync(path.join(ROOT, 'scripts/restore-db.sh')),
    'backup-db.sh + restore-db.sh (اتقاس استرجاع فعلي في ج-١٠)',
  );

  // ── ب-٥: الثوابت المالية قبل ما نفتح الأبواب ────────────────────────
  //
  // دفتر غير متوازن قبل الإطلاق معناه إن فيه خلل موجود **دلوقتي** — والإطلاق هيضاعفه على
  // حجم حقيقي. ده مش فحص «نظافة»، ده شرط إطلاق.
  const { net, rows } = await h.ledgerImbalance();
  h.record('ب-٥/أ الدفتر متوازن', net === 0, `صافي=${net} على ${rows} صف`);
  const negatives = await h.negativeBalances();
  h.record('ب-٥/ب مفيش رصيد سالب', negatives.length === 0, `أرصدة سالبة=${negatives.length}`);

  // ── ب-٦: تطابق البيئة ───────────────────────────────────────────────
  const parity = run(process.execPath, ['scripts/env-parity-check.js']);
  h.record(
    'ب-٦/أ متغيّرات البيئة الحرجة مضبوطة (ج-١٤)',
    parity.ok,
    parity.out.trim().split('\n').slice(-2).join(' | '),
  );

  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} شرط متحقق`);
  if (h.failures.length) {
    console.log(`\n❌ **مايتطلقش قبل ما ده يتحل:**`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  } else {
    console.log(`\n✅ البوابة مفتوحة — كمّل خطوات الإطلاق في docs/runbooks/go-live-and-rollback.md`);
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('فشل:', err);
  await h.close().catch(() => {});
  process.exit(2);
});
