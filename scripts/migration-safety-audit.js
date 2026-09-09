#!/usr/bin/env node
/**
 * **ج-١١ — Migrations آمنة للإنتاج + rollback/forward-fix**.
 *
 * الـmigration هي الكود الوحيد اللي بيتنفّذ **مرة واحدة على بيانات حقيقية بلا زرار تراجع**.
 * وهي كمان الكود الوحيد اللي بيعدّي من كل البوابات (`tsc`, `eslint`, `jest`) من غير ما حد
 * يقراه — لأنه نص SQL.
 *
 * التدقيق ده **بيفتعل كل نوع فشل** ويتأكد إن الحماية اشتغلت:
 *   - migration بتفشل في نصّها ⇒ هل الـschema رجع نضيف ولا فضل نص-متغيّر؟
 *   - migration بتحاول تقفل جدول مشغول ⇒ هل بتفشل بسرعة ولا بتجمّد المنصة؟
 *   - ملف migration مطبّق اتعدّل ⇒ هل بيتلاقط؟
 *   - migration خطيرة اتضافت ⇒ هل الحارس الثابت بيرصدها؟
 *
 * كل ده على **قاعدة مؤقتة** — القاعدة الشغّالة مابتتلمسش.
 *
 *   node scripts/migration-safety-audit.js
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { Client } = require('/home/user/portalSp/node_modules/pg');
const { LiveHarness, sleep, ROOT, DATABASE_URL } = require('./lib/live-harness');

const h = new LiveHarness('mg');
const SANDBOX = `baytak_mig_audit_${Date.now()}`;
const sandboxUrl = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, `/${SANDBOX}$1`);
const adminUrl = DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/postgres$1');
let TMP_MIGRATIONS = null;

/**
 * مجلد migrations مؤقت فيه **نسخة من المشغّل الحقيقي** + الملف اللي بنختبره.
 *
 * `migrate.js` بيستخدم `__dirname` كمجلد الـmigrations، فالنسخ هو الطريقة الوحيدة لتشغيله على
 * مجموعة ملفات معزولة. و`require('pg')` جوّاه بيتحل نسبةً لمكانه — فبنعمل symlink لـ
 * `node_modules` بتاع المشروع، وإلا المشغّل بيموت قبل ما يعمل أي حاجة والتدقيق بيقيس
 * الانهيار ده بدل السلوك المقصود.
 */
function tempMigrationsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baytak-mig-'));
  fs.copyFileSync(path.join(ROOT, 'infra/migrations/migrate.js'), path.join(dir, 'migrate.js'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

function runMigrator(dir, url, env = {}) {
  const res = spawnSync(process.execPath, [path.join(dir, 'migrate.js')], {
    encoding: 'utf8',
    env: { ...process.env, ...env, DATABASE_URL: url },
    timeout: 120_000,
  });
  // انهيار المشغّل نفسه (وحدة ناقصة، خطأ في المسار) بيبان كـ«فشل» زي فشل الـmigration بالظبط —
  // والفرق ده هو اللي بيخلّي التدقيق يقيس حاجة غير اللي بيدّعي إنه بيقيسها. الطباعة هنا بتخلّي
  // اللبس ده مستحيل.
  if (/Cannot find module|MODULE_NOT_FOUND/.test(res.stderr ?? '')) {
    console.error('⚠️  المشغّل نفسه انهار (مش فشل migration):', (res.stderr ?? '').slice(0, 200));
  }
  return res;
}

async function sandbox() {
  const c = new Client({ connectionString: sandboxUrl });
  await c.connect();
  return c;
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١١: أمان الـmigrations — تشغيلة ${h.runId} ===\n`);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${SANDBOX}"`);
  await admin.end();
  TMP_MIGRATIONS = tempMigrationsDir();

  // ---- م-١: migration بتفشل في نصّها = صفر أثر (ذرّية) ----
  //
  // أخطر شكل للفشل مش الفشل نفسه — هو الفشل **النصّي**: الجزء الأول اتطبّق والتاني لأ،
  // فالـschema بقى في حالة مش موصوفة في أي ملف. الاسترجاع منها يدوي ووقت الضغط.
  fs.writeFileSync(
    path.join(TMP_MIGRATIONS, '9001_partial_failure.sql'),
    `CREATE TABLE mig_audit_first (id int);
     CREATE TABLE mig_audit_second (id int);
     SELECT 1 / 0;  -- الفشل هنا، بعد ما الجدولين اتعملوا`,
  );
  const partial = runMigrator(TMP_MIGRATIONS, sandboxUrl);
  const sb1 = await sandbox();
  const { rows: leftovers } = await sb1.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'mig_audit_%'`,
  );
  const { rows: recorded } = await sb1.query(
    `SELECT filename FROM schema_migrations WHERE filename = '9001_partial_failure.sql'`,
  );
  await sb1.end();
  h.record(
    'م-١/أ migration بتفشل في نصّها بترجع بالكامل — صفر جدول نص-متعمول',
    partial.status !== 0 && leftovers.length === 0,
    `خرجت بكود ${partial.status}، جداول متبقية=${leftovers.length}`,
  );
  h.record(
    'م-١/ب ومااتسجّلتش كمطبّقة (فتتعاد المحاولة، مش تتخطّى بصمت)',
    recorded.length === 0,
    `صفوف في schema_migrations=${recorded.length}`,
  );
  fs.unlinkSync(path.join(TMP_MIGRATIONS, '9001_partial_failure.sql'));

  // ---- م-٢: القفل — أخطر لحظة في أي نشر ----
  //
  // `ALTER TABLE` بياخد `ACCESS EXCLUSIVE`. لو فيه معاملة ماسكة الجدول، الـmigration بتقف في
  // الطابور — **وكل استعلام جديد على الجدول بيقف وراها**. `ALTER` بريء بيجمّد المنصة كلها.
  // `lock_timeout` بيحوّل ده لفشل سريع ونظيف.
  const sb2 = await sandbox();
  await sb2.query(`CREATE TABLE mig_audit_locked (id int)`);
  await sb2.end();

  // معاملة تانية ماسكة الجدول ومش سايباه — بتحاكي استعلام طويل في الإنتاج.
  const blocker = await sandbox();
  await blocker.query('BEGIN');
  await blocker.query(`LOCK TABLE mig_audit_locked IN ACCESS EXCLUSIVE MODE`);

  fs.writeFileSync(
    path.join(TMP_MIGRATIONS, '9002_needs_lock.sql'),
    `ALTER TABLE mig_audit_locked ADD COLUMN note text;`,
  );
  const t0 = Date.now();
  const locked = runMigrator(TMP_MIGRATIONS, sandboxUrl, { MIGRATION_LOCK_TIMEOUT: '2s' });
  const lockedSeconds = (Date.now() - t0) / 1000;
  await blocker.query('ROLLBACK');
  await blocker.end();

  h.record(
    'م-٢/أ الجدول المقفول بيوقّف الـmigration بسرعة (مش بيجمّدها للأبد)',
    locked.status !== 0 && lockedSeconds < 20,
    `فشلت في ${lockedSeconds.toFixed(1)}s (المهلة 2s)`,
  );
  h.record(
    'م-٢/ب والرسالة بتفرّق: «الحماية اشتغلت» مش «غلط في الـSQL»',
    /الحماية اشتغلت/.test(locked.stderr ?? ''),
    (locked.stderr ?? '').split('\n').find((l) => l.includes('ℹ️'))?.trim().slice(0, 100) ?? 'مفيش تفرقة ❗',
  );

  // ونفس الـmigration بتعدّي عادي لما القفل يتساب — يعني الفشل كان بسبب القفل مش بسبب خلل.
  const afterUnlock = runMigrator(TMP_MIGRATIONS, sandboxUrl, { MIGRATION_LOCK_TIMEOUT: '5s' });
  h.record(
    'م-٢/ج ونفس الـmigration بتنجح بعد ما القفل يتساب (الفشل كان مؤقتًا، أعد المحاولة وخلاص)',
    afterUnlock.status === 0,
    `كود الخروج=${afterUnlock.status}`,
  );

  // ---- م-٣: تعديل migration مطبّقة بيتلاقط ----
  //
  // القاعدة في `CLAUDE.md`: migration اتعمل commit ما تتعدّلش أبدًا. من غير كشف، السيرفرات
  // بتختلف عن بعض بصمت — واحد طبّق النسخة القديمة والتاني الجديدة.
  fs.writeFileSync(
    path.join(TMP_MIGRATIONS, '9002_needs_lock.sql'),
    `ALTER TABLE mig_audit_locked ADD COLUMN note text;\n-- تعديل بعد التطبيق`,
  );
  const drift = runMigrator(TMP_MIGRATIONS, sandboxUrl);
  h.record(
    'م-٣ تعديل ملف migration مطبّق بيوقّف التشغيل برسالة صريحة',
    drift.status !== 0 && /checksum/i.test(drift.stderr ?? ''),
    drift.status !== 0 ? 'اتلاقط ووقف' : 'عدّى بصمت ❗',
  );

  // ---- م-٤: الحارس الثابت بيرصد الأنماط الخطيرة ----
  //
  // الحارس بيقرا SQL قبل ما يتطبّق. الفحص هنا إنه **بيرصد فعلاً** — حارس بيقول «نضيف» على
  // كل حاجة أسوأ من مفيش حارس.
  const guardDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baytak-guard-'));
  const cases = [
    ['9101_drop.sql', 'DROP TABLE orders;', 'drop-table'],
    ['9102_index.sql', 'CREATE INDEX idx_x ON orders (customer_id);', 'index-without-concurrently'],
    ['9103_notnull.sql', 'ALTER TABLE orders ADD COLUMN x text NOT NULL;', 'not-null-without-default'],
    ['9104_type.sql', 'ALTER TABLE orders ALTER COLUMN total_amount_cents TYPE bigint;', 'alter-column-type'],
  ];
  const missed = [];
  for (const [name, sql, ruleId] of cases) {
    const target = path.join(ROOT, 'infra/migrations', name);
    fs.writeFileSync(target, sql);
    try {
      const out = execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts/check-migration-safety.js'), '--all'],
        { cwd: ROOT, encoding: 'utf8' },
      );
      // خرج بصفر = ما رصدش حاجة.
      if (!out.includes(ruleId)) missed.push(name);
    } catch (err) {
      // خرج بكود ≠ 0 = رصد — نتأكد إنه رصد **القاعدة الصح** مش أي قاعدة.
      if (!String(err.stdout ?? '').includes(ruleId)) missed.push(`${name} (رصد قاعدة تانية)`);
    } finally {
      fs.unlinkSync(target);
    }
  }
  h.record(
    'م-٤/أ الحارس الثابت بيرصد كل نمط خطير بالاسم الصح',
    missed.length === 0,
    missed.length ? `فات عليه: ${missed.join('، ')} ❗` : `${cases.length}/${cases.length} اتلقطوا`,
  );

  // الإقرار الصريح لازم يشتغل — من غيره الحارس بيتحوّل لعائق فالناس بتتخطّاه كله.
  const okFile = path.join(ROOT, 'infra/migrations', '9105_ok.sql');
  fs.writeFileSync(okFile, `-- migration-safety: ok الجدول صغير ومتأكَّد منه\nCREATE INDEX idx_y ON cities (slug);`);
  let ackPassed = false;
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'scripts/check-migration-safety.js'), '--all'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    // **المطابقة على سطر المخالفة بالتحديد** — الملف المُعفى بيتطبع كمان في سطر «اتخطّى»،
    // فالبحث عن اسمه في المخرجات كلها بيقول «مااتخطّاش» وهو اتخطّى فعلاً (بلاغ كاذب اتلقط هنا).
    ackPassed = !new RegExp(`^\\s+9105_ok\\.sql — \\[`, 'm').test(out);
  } catch (err) {
    ackPassed = !new RegExp(`^\\s+9105_ok\\.sql — \\[`, 'm').test(String(err.stdout ?? ''));
  } finally {
    fs.unlinkSync(okFile);
  }
  h.record(
    'م-٤/ب والإقرار الصريح (migration-safety: ok) بيعدّي — الحارس مش عائق أعمى',
    ackPassed,
    ackPassed ? 'اتخطّى بالإقرار' : 'الإقرار مااشتغلش ❗',
  );

  fs.rmSync(guardDir, { recursive: true, force: true });

  // ---- م-٥: البروفة بتمسك الفشل اللي مابيظهرش محليًا ----
  //
  // فئة الفشل الأخطر: migration بتعدّي على قاعدة التطوير (الجدول فاضي) وتفشل على الإنتاج
  // (الجدول فيه بيانات). البروفة على نسخة من الإنتاج هي الطريقة الوحيدة لمسكها **قبل** النشر.
  const sb5 = await sandbox();
  await sb5.query(`CREATE TABLE mig_audit_has_rows (id int)`);
  await sb5.query(`INSERT INTO mig_audit_has_rows (id) VALUES (1)`);
  await sb5.end();
  fs.writeFileSync(
    path.join(TMP_MIGRATIONS, '9003_notnull_on_data.sql'),
    `ALTER TABLE mig_audit_has_rows ADD COLUMN required_field text NOT NULL;`,
  );
  const onData = runMigrator(TMP_MIGRATIONS, sandboxUrl);
  h.record(
    'م-٥/أ الـmigration اللي بتفشل على بيانات حقيقية بتفشل في البروفة (مش في الإنتاج)',
    onData.status !== 0,
    onData.status !== 0 ? 'فشلت على البروفة زي ما كانت هتفشل في الإنتاج' : 'عدّت ❗',
  );

  const sb6 = await sandbox();
  const { rows: cols } = await sb6.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'mig_audit_has_rows' AND column_name = 'required_field'`,
  );
  await sb6.end();
  h.record(
    'م-٥/ب والفشل ده ماسابش أثر — الجدول زي ما هو',
    cols.length === 0,
    `أعمدة مضافة بالغلط=${cols.length}`,
  );

  await finish();
}

async function finish() {
  try {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [SANDBOX],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${SANDBOX}"`);
    await admin.end();
  } catch (err) {
    console.log(`تنبيه: مامسحناش ${SANDBOX} — ${String(err.message ?? err).slice(0, 120)}`);
  }
  if (TMP_MIGRATIONS) fs.rmSync(TMP_MIGRATIONS, { recursive: true, force: true });

  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await finish().catch(() => {});
  process.exit(2);
});
