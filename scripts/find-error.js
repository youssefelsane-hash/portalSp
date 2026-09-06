#!/usr/bin/env node
/**
 * **من كود الخطأ اللي على الموبايل لسببه الحقيقي — أمر واحد.**
 *
 * التطبيقات بتعرض `request_id` مع أي عطل ٥xx («حصل خطأ غير متوقع، حاول تاني (كود: req_…)»).
 * السكريبت ده بياخد الكود ده ويطلّع العطل بالكامل: المسار، المستخدم، الرسالة، والـstack.
 *
 *   node scripts/find-error.js req_cfcfbe4a-e1c7-4088-a0c0-e8f041314182
 *   node scripts/find-error.js --last 5      # آخر ٥ أعطال بلا كود
 *
 * المصدر `.dev-logs/errors.log` — الباك-إند بيكتب فيه كل عطل ٥xx مهما كانت طريقة تشغيله
 * (مش محتاج تكون شغّال من `mac-dev-up.sh`). في الإنتاج السجل ده متوقّف عمدًا.
 */
const fs = require('node:fs');
const path = require('node:path');

const R = '\x1b[31m', G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m';
const LOG = process.env.ERROR_JOURNAL_PATH || path.resolve(__dirname, '..', '.dev-logs', 'errors.log');

function read() {
  if (!fs.existsSync(LOG)) {
    console.error(`${Y}مفيش سجل أعطال في ${LOG}${O}`);
    console.error(`${D}يعني إما مفيش أي عطل ٥xx حصل من وقت آخر تشغيل، أو الـAPI شغّال بـNODE_ENV إنتاجي.${O}`);
    process.exit(1);
  }
  return fs
    .readFileSync(LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function show(e) {
  console.log(`\n${B}${e.method} ${e.url}${O}`);
  console.log(`${D}الكود: ${e.requestId}   الوقت: ${e.at}   المستخدم: ${e.userId ?? 'مجهول'}${O}`);
  console.log(`${R}${e.message}${O}`);
  if (e.stack) {
    // أول سطور الـstack بتاعت كودنا إحنا — اللي جاي من node_modules نادرًا بيفيد.
    const ours = e.stack.split('\n').filter((l) => !l.includes('node_modules')).slice(0, 12);
    console.log(`${D}${ours.join('\n')}${O}`);
  }
}

const args = process.argv.slice(2);
const entries = read();

if (args[0] === '--last') {
  const n = Number(args[1] ?? 5);
  const last = entries.slice(-n);
  if (last.length === 0) console.log(`${G}✅ مفيش أي عطل ٥xx متسجّل.${O}\n`);
  last.forEach(show);
  console.log();
} else if (args[0]) {
  const id = args[0].replace(/[()]/g, '').trim();
  const found = entries.filter((e) => e.requestId === id || e.requestId.endsWith(id));
  if (found.length === 0) {
    console.error(`${Y}مفيش عطل بالكود ${id} في ${LOG}${O}`);
    console.error(`${D}جرّب: node scripts/find-error.js --last 10${O}`);
    process.exit(1);
  }
  found.forEach(show);
  console.log();
} else {
  console.error('الاستخدام: node scripts/find-error.js <كود الخطأ> | --last [عدد]');
  process.exit(1);
}
