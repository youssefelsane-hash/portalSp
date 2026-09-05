#!/usr/bin/env node
/**
 * **سجل الفجوات الموثّقة — مولَّد، مش مكتوب بالإيد** (نتيجة تدقيق النظام، ملاحظة التوثيق).
 *
 * المشروع فيه ~٢٩٤ إشارة «فجوة موثّقة» موزّعة على عشرات الـREADMEs. الأغلبية بتقول «كانت فجوة…
 * اتقفلت»، لكن **مفيش سجل واحد بيفصل المفتوح عن المقفول** — فمعرفة «إيه اللي لسه ناقص» كانت
 * محتاجة قراءة كل الملفات كاملة. ده في حد ذاته دَين توثيقي.
 *
 * السكريبت ده بيقرا كل الإشارات ويصنّفها بلغتها نفسها:
 *
 *   • **مقفولة** — الجملة فيها علامة إغلاق صريحة (اتقفلت/اتصلحت/اتحلّت/خلصت…).
 *   • **مفتوحة** — مفيش علامة إغلاق.
 *
 * التصنيف **مساعد مش حَكَم**: بيقول «بصّ هنا»، والقرار النهائي بقراءة السطر. الغرض إن السؤال
 * «إيه المفتوح؟» يبقى أمر واحد بدل قراءة ٢٤ ملف.
 *
 * الاستخدام:
 *   node scripts/list-documented-gaps.js            # ملخّص + المفتوح بس
 *   node scripts/list-documented-gaps.js --all      # كل الإشارات
 *   node scripts/list-documented-gaps.js --markdown # جدول جاهز للصق في مستند
 */
const { execSync } = require('child_process');
const fs = require('fs');

const MARKER = /فجوة موثّقة|فجوة موثقة/;
// علامات إغلاق صريحة — لو أي واحدة ظهرت في نفس الجملة، الفجوة متسجّلة كمقفولة.
const CLOSED_SIGNALS = [
  'اتقفلت', 'اتقفل', 'اتصلحت', 'اتصلح', 'اتحلّت', 'اتحلت', 'خلصت',
  'بقت مقفولة', 'تم إغلاقها', 'اتنفّذت', 'اتنفذت', 'موجودة دلوقتي',
];

/**
 * **أقوى إشارة إغلاق في المستودع ده هي زمن الفعل**: «*كانت* فجوة موثّقة» معناها بالعربي إنها
 * **بقت مقفولة**، والجملة اللي بعدها بتشرح الإصلاح. أما «فجوة موثّقة صراحة» (بلا «كانت») فهي
 * تسجيل لحاجة **لسه ناقصة**.
 *
 * ده اللي بيفرّق ١٨١ نتيجة كاذبة عن قايمة قابلة للقراءة فعلاً.
 */
const PAST_TENSE = /كانت\s+(هنا\s+)?فجوة|كان\s+فجوة|كانوا\s+فجوة/;
/** نص مشطوب (`~~…~~`) = الفريق شطبه بنفسه بعد ما اتقفل. */
const STRUCK_THROUGH = /~~/;

function listFiles() {
  const out = execSync(
    `git ls-files '*.md' | grep -v node_modules`,
    { encoding: 'utf8', maxBuffer: 1 << 26 },
  );
  return out.split('\n').filter(Boolean);
}

/** بيرجّع الجملة اللي فيها الإشارة — من أقرب فاصل جملة قبلها لأقرب واحد بعدها. */
function sentenceAround(text, index) {
  const boundary = /[.。!؟\n]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !boundary.test(text[end])) end++;
  return text.slice(start, end).trim().replace(/\s+/g, ' ');
}

const rows = [];
for (const file of listFiles()) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (!MARKER.test(line)) return;
    const idx = line.search(MARKER);
    const sentence = sentenceAround(line, idx);
    const closed =
      CLOSED_SIGNALS.some((s) => sentence.includes(s)) || PAST_TENSE.test(sentence) || STRUCK_THROUGH.test(line);
    rows.push({ file, line: i + 1, closed, sentence: sentence.slice(0, 240) });
  });
}

const open = rows.filter((r) => !r.closed);
const closed = rows.filter((r) => r.closed);
const args = process.argv.slice(2);

if (args.includes('--markdown')) {
  console.log('| الملف | السطر | النص |');
  console.log('|-------|-------|------|');
  for (const r of open) console.log(`| \`${r.file}\` | ${r.line} | ${r.sentence.replace(/\|/g, '\\|')} |`);
  process.exit(0);
}

console.log(`\n📋 إشارات «فجوة موثّقة»: ${rows.length} — مقفولة ${closed.length} · محتاجة نظرة ${open.length}\n`);
const shown = args.includes('--all') ? rows : open;
const byFile = new Map();
for (const r of shown) {
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}
for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${file} (${items.length})`);
  for (const r of items) console.log(`  ${r.closed ? '✅' : '🔸'} :${r.line}  ${r.sentence}`);
}
console.log('\nℹ️  التصنيف مساعد مش حَكَم — «🔸» معناها «اقرا السطر ده»، مش «دي فجوة مفتوحة مؤكّدة».');
