/**
 * **بوابة: مفيش فعل في سجل النشاط بيوصل للأدمن بالإنجليزي.**
 *
 * بلاغ مالك 2026-09-17: «كلام مش معروف الكلام ده يعني». صفحة سجل النشاط كانت بتعرض
 * `security.access_denied` خام. الترجمة في `apps/admin/src/lib/audit-labels.ts` مبنية
 * بالتركيب (كيان + فعل) عشان تستحمل أفعال جديدة، **بس** ده مايمنعش إن فعل جديد بكيان جديد
 * يطلع إنجليزي من غير ما حد يلاحظ.
 *
 * السكربت ده بيقرا الأفعال الموجودة **فعلاً** في كود الباك-إند (مش قايمة مكتوبة بالإيد)،
 * وبيشغّل نفس منطق التركيب، وبيفشل لو أي فعل مالوش اسم كيان عربي على الأقل. أفعال `test.*`
 * مستبعدة — دي أفعال اختبارات مش بتوصل للإنتاج.
 *
 *   node scripts/check-audit-labels.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const ts = fs.readFileSync('apps/admin/src/lib/audit-labels.ts', 'utf8');
// نستخرج الماپات من الملف نفسه بدل ما نكرّرها هنا (وإلا الاختبار بيختبر نسخة).
const grab = (name) => {
  const start = ts.indexOf(`const ${name}: Record<string, string> = {`);
  const end = ts.indexOf('\n};', start);
  const body = ts.slice(ts.indexOf('{', start) + 1, end);
  const out = {};
  for (const m of body.matchAll(/^\s*'?([A-Za-z0-9_.]+)'?:\s*'([^']*)'/gm)) out[m[1]] = m[2];
  return out;
};
const ENTITY = grab('ENTITY_LABELS');
const VERB = grab('VERB_LABELS');
const EXACT = grab('EXACT_LABELS');
const humanize = (r) => r.replace(/_/g, ' ');
function label(action) {
  if (EXACT[action]) return { text: EXACT[action], kind: 'exact' };
  const dot = action.indexOf('.');
  if (dot === -1) return { text: humanize(action), kind: 'raw' };
  const e = action.slice(0, dot), v = action.slice(dot + 1);
  if (VERB[v] && ENTITY[e]) return { text: `${VERB[v]} ${ENTITY[e]}`, kind: 'composed' };
  if (VERB[v]) return { text: `${VERB[v]} — ${humanize(e)}`, kind: 'verb-only' };
  if (ENTITY[e]) return { text: `${ENTITY[e]} — ${humanize(v)}`, kind: 'entity-only' };
  return { text: humanize(action), kind: 'raw' };
}

const actions = [...new Set(
  execSync(`grep -rho "action: '[a-z_]*\\.[a-z_]*'" apps/api/src --include=*.ts`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.replace(/.*action: '/, '').replace(/'$/, '')),
)].sort().filter((a) => !a.startsWith('test.')); // أفعال test.* مالهاش وجود في الإنتاج

const byKind = {};
const raw = [];
const entityOnly = [];
for (const a of actions) {
  const { text, kind } = label(a);
  byKind[kind] = (byKind[kind] ?? 0) + 1;
  if (!text || text.trim() === '') { console.log('❌ ترجمة فاضية:', a); process.exitCode = 1; }
  if (kind === 'raw') raw.push(a);
  if (kind === 'entity-only') entityOnly.push(`${a} → ${text}`);
}
console.log(`أفعال في الكود: ${actions.length}`);
console.log('توزيع الترجمة:', JSON.stringify(byKind));
if (raw.length) {
  console.log(`\n❌ ${raw.length} فعل بيتعرض بالإنجليزي (لا الكيان ولا الفعل معروف):`);
  for (const a of raw) console.log('   -', a);
  process.exitCode = 1;
} else {
  console.log('\n✅ كل فعل بياخد اسم كيان عربي على الأقل — مفيش مفتاح إنجليزي خام في العمود.');
}
if (entityOnly.length) {
  console.log(`\nℹ️  ${entityOnly.length} فعل الكيان بس فيه معروف (الفعل بيتعرض كلمات إنجليزية جوّه جملة عربية):`);
  for (const l of entityOnly.slice(0, 40)) console.log('   -', l);
}
