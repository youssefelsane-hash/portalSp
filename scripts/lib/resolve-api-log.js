/**
 * مسار لوج الباك-إند اللي فيه كود الـOTP في وضع التطوير.
 *
 * ليه ده موجود: تلات أدوات تدقيق كانت بتقرا `/tmp/claude-0/api.log` — مسار **scratchpad**
 * سيشن قديمة بعينها. أي تشغيلة في أي سيشن تانية (أو على جهاز المالك) مالقتش الملف، فالتسجيل
 * بيفشل والتدقيق بيرسب برسالة «مالقيناش كود OTP» اللي مالهاش أي علاقة باللي بيتقاس. نفس فئة
 * البَقّة اللي اتصلحت في `apps/customer-app/test_live/_live_support.dart` بالظبط.
 *
 * الترتيب: `API_LOG_PATH` صريح ← اللوج اللي `scripts/lib/live-harness.js` بيكتب فيه فعلاً ←
 * `.dev-logs/api.log` في الجذر ← أي `*.log` أو `*.out` في scratchpad السيشن الحالية (الأحدث).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function newestLogIn(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && (e.name.endsWith('.log') || e.name.endsWith('.out')))
      .map((e) => path.join(e.parentPath ?? e.path ?? dir, e.name))
      .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0]?.p;
  } catch {
    return undefined;
  }
}

/** بيرجّع مسار موجود فعلاً، أو `null` لو مفيش — المستدعي بيقرر يرسّب ولا يتخطى. */
function resolveApiLog() {
  const candidates = [
    process.env.API_LOG_PATH,
    // ده اللي `live-harness.js` بيشغّل الـAPI عليه — أول مكان يتشاف.
    path.join(ROOT, 'apps/api/.dev-logs/api.out'),
    path.join(ROOT, 'apps/api/.dev-logs/api.log'),
    path.join(ROOT, '.dev-logs/api.log'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // آخر محاولة: scratchpad السيشن الحالية (لو الـAPI اتشغّل بالإيد ومخرجاته هناك).
  const scratch = process.env.CLAUDE_SCRATCHPAD || '/tmp/claude-0';
  const fromScratch = newestLogIn(scratch);
  return fromScratch ?? null;
}

module.exports = { resolveApiLog };
