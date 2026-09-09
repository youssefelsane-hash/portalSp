#!/usr/bin/env node
/**
 * **حارس ثابت ضد الـmigrations اللي بتوقّع الإنتاج أو بتفقد بيانات** (ج-١١).
 *
 * الـmigration بتعدّي على `tsc` و`eslint` و`jest` كلهم لأنها نص SQL — مفيش أي بوابة بتقراها
 * قبل ما تتطبّق على قاعدة فيها بيانات عملاء حقيقية. البوابة الوحيدة الموجودة
 * (`check-migrations.js`) بتمنع تكرار الأرقام وبس.
 *
 * الحارس ده بيقرا **محتوى** كل migration جديدة ويدوّر على تلات فئات:
 *
 * 1. **قفل بيوقّع المنصة**: `CREATE INDEX` بلا `CONCURRENTLY` على جدول كبير بياخد
 *    `ACCESS EXCLUSIVE` لدقايق — كل استعلام على الجدول بيقف وراه.
 * 2. **فقد بيانات لا رجعة فيه**: `DROP TABLE` / `DROP COLUMN`. النسخة الاحتياطية بترجّعهم
 *    (ج-١٠) بس بفقد كل اللي حصل بعد آخر نسخة.
 * 3. **فشل مؤكّد على جدول فيه بيانات**: `ADD COLUMN ... NOT NULL` بلا `DEFAULT` بيفشل فورًا
 *    لو الجدول مش فاضي — وده بيتكشف في الإنتاج مش في التطوير (الجدول فاضي محليًا).
 *
 * **مش منع مطلق — إقرار واعٍ**: أي نمط ممكن يعدّي بتعليق `-- migration-safety: ok <السبب>`
 * في نفس الملف. الهدف إن القرار يبقى **مكتوب** مش صامت.
 *
 *   node scripts/check-migration-safety.js [--all]
 *
 * الافتراضي بيفحص الملفات الجديدة/المعدّلة مقارنةً بـ`origin/main` (مناسب للـCI وقبل الcommit).
 * `--all` بيفحص كل الملفات — مفيد لمسح تاريخي، وبيتوقّع يطلّع نتايج على migrations قديمة
 * اتطبّقت خلاص.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'infra/migrations');
const ALL = process.argv.includes('--all');

/** إعفاء صريح مكتوب في الملف — القرار بيبقى موثّق بدل ما يبقى صامت. */
const OK_MARKER = /--\s*migration-safety:\s*ok\b/i;

const RULES = [
  {
    id: 'index-without-concurrently',
    // `CREATE INDEX` (مش `CREATE UNIQUE INDEX ... CONCURRENTLY`) — بيقفل الجدول للكتابة طول البناء.
    test: (sql) => /\bCREATE\s+(UNIQUE\s+)?INDEX\b(?![\s\S]{0,40}\bCONCURRENTLY\b)/i.test(sql),
    severity: 'قفل',
    why:
      'CREATE INDEX بلا CONCURRENTLY بياخد قفل كتابة على الجدول طول مدة البناء. على جدول كبير ' +
      'في الإنتاج ده بيوقّف كل الكتابة عليه لدقايق.',
    fix:
      'استخدم CREATE INDEX CONCURRENTLY (وساعتها الـmigration لازم تكون **بره** transaction — ' +
      'ملف منفصل يتشغّل يدويًا في نافذة صيانة)، أو أقرّ صراحةً إن الجدول صغير: ' +
      '-- migration-safety: ok الجدول <اسمه> فيه أقل من N صف',
  },
  {
    id: 'drop-table',
    test: (sql) => /\bDROP\s+TABLE\b/i.test(sql),
    severity: 'فقد بيانات',
    why: 'DROP TABLE بيمسح بيانات عملاء حقيقية بلا رجعة. الاسترجاع من نسخة بيفقد كل اللي بعدها.',
    fix:
      'الأسلوب الآمن على مرحلتين: أعد التسمية الأول (ALTER TABLE x RENAME TO x_retired_YYYYMMDD) ' +
      'وسيبه دورة نشر كاملة، وبعدين امسحه في migration تانية بعد ما تتأكد إن مفيش حاجة بتقرا منه. ' +
      'أو أقرّ صراحةً: -- migration-safety: ok الجدول ميت ومتأكَّد منه في <مرجع>',
  },
  {
    id: 'drop-column',
    test: (sql) => /\bDROP\s+COLUMN\b/i.test(sql),
    severity: 'فقد بيانات',
    why:
      'DROP COLUMN بيمسح بيانات بلا رجعة، وكمان **بيكسر النشر المتدرّج**: النسخة القديمة من ' +
      'التطبيق لسه شغّالة وبتـSELECT العمود ده لحد ما كل النسخ تتبدّل.',
    fix:
      'وقّف الكتابة والقراءة في الكود الأول وانشره، وبعد ما تتأكد إن مفيش نسخة قديمة شغّالة ' +
      'امسح العمود في migration تانية. أو أقرّ: -- migration-safety: ok مفيش كود بيقرا العمود',
  },
  {
    id: 'not-null-without-default',
    // `ADD COLUMN x type NOT NULL` بلا `DEFAULT` في نفس التعريف.
    test: (sql) =>
      /\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/i.test(sql) &&
      !/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b[^;]*\bNOT\s+NULL\b[^;]*\bDEFAULT\b/i.test(sql),
    severity: 'فشل مؤكّد',
    why:
      'ADD COLUMN … NOT NULL بلا DEFAULT بيفشل على أي جدول فيه صف واحد. محليًا الجدول غالبًا ' +
      'فاضي فالـmigration بتعدّي — والفشل بيظهر أول مرة في الإنتاج.',
    fix:
      'ضيف DEFAULT (Postgres 11+ بيعملها بلا إعادة كتابة الجدول)، أو على تلات خطوات: ' +
      'ADD COLUMN nullable ← امليه ← SET NOT NULL.',
  },
  {
    id: 'alter-column-type',
    test: (sql) => /\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i.test(sql),
    severity: 'قفل',
    why:
      'ALTER COLUMN … TYPE بيعيد كتابة الجدول كله تحت ACCESS EXCLUSIVE — على جدول كبير ده ' +
      'تعطّل كامل لمدة إعادة الكتابة.',
    fix:
      'عمود جديد بالنوع الصح ← نسخ البيانات على دفعات ← تبديل في الكود ← حذف القديم لاحقًا. ' +
      'أو أقرّ إن الجدول صغير: -- migration-safety: ok',
  },
  {
    id: 'update-without-where',
    test: (sql) =>
      /\bUPDATE\s+[a-z_."]+\s+SET\b(?![\s\S]{0,4000}?\bWHERE\b)/i.test(sql) ||
      /\bDELETE\s+FROM\s+[a-z_."]+\s*;/i.test(sql),
    severity: 'فقد بيانات',
    why:
      'UPDATE/DELETE بلا WHERE بيلمس كل صف في الجدول. ده مقصود أحيانًا (backfill) — بس لازم ' +
      'يبقى قرار مكتوب مش سهو، ولازم يتحسب زمنه على حجم الإنتاج مش المحلي.',
    fix: 'ضيف WHERE، أو أقرّ: -- migration-safety: ok backfill مقصود على <عدد> صف',
  },
];

function changedMigrations() {
  try {
    // `origin/main` هي القاعدة المرجعية — الملفات الجديدة في الفرع ده هي اللي لسه ما اتطبقتش.
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', 'origin/main...HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return out
      .trim()
      .split('\n')
      .filter((f) => f.startsWith('infra/migrations/') && f.endsWith('.sql'))
      .map((f) => path.basename(f));
  } catch {
    // مفيش `origin/main` (clone ضحل، أو أول فرع) — الأأمن إننا نفحص الكل بدل ما نسكت.
    console.log('ℹ️  مقدرناش نقارن بـorigin/main — بنفحص كل الملفات.');
    return fs.readdirSync(DIR).filter((f) => f.endsWith('.sql'));
  }
}

function stripComments(sql) {
  // التعليقات مليانة كلام عربي بيوصف العمليات دي («بيمسح الجدول القديم») — فحصها بيطلّع
  // نتايج كاذبة على شرح صح.
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function main() {
  const files = ALL ? fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')) : changedMigrations();
  if (!files.length) {
    console.log('✅ مفيش migrations جديدة تتفحص.');
    return 0;
  }

  const findings = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
    if (OK_MARKER.test(raw)) {
      console.log(`⏭  ${file} — فيه إقرار صريح (migration-safety: ok)`);
      continue;
    }
    const sql = stripComments(raw);
    for (const rule of RULES) {
      if (rule.test(sql)) findings.push({ file, rule });
    }
  }

  console.log(`\nاتفحص ${files.length} ملف.`);
  if (!findings.length) {
    console.log('✅ مفيش أنماط خطيرة.');
    return 0;
  }

  console.log(`\n❌ ${findings.length} نمط محتاج قرار مكتوب:\n`);
  for (const { file, rule } of findings) {
    console.log(`  ${file} — [${rule.severity}] ${rule.id}`);
    console.log(`     ليه: ${rule.why}`);
    console.log(`     الحل: ${rule.fix}\n`);
  }
  console.log(
    'لو النمط مقصود وآمن في الحالة دي، ضيف في الملف سطر:\n' +
      '  -- migration-safety: ok <السبب بالتحديد>\n' +
      'الهدف مش المنع — الهدف إن القرار يبقى مكتوب ومقروء لأي حد بعدك.',
  );
  return 1;
}

process.exit(main());
