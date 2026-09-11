/**
 * بيحمّل `apps/api/.env` في `process.env` **قبل** أي اختبار.
 *
 * ## البَقّة اللي وراه (اتلقطت 2026-09-11)
 *
 * معظم الاختبارات هنا بتتوصّل بقاعدة حيّة، وكل واحد فيهم مكتوب كده:
 *
 * ```ts
 * url: process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak'
 * ```
 *
 * وjest **مابيحمّلش `.env`** (اللي بيعمل كده هو `ConfigModule` وقت تشغيل التطبيق، مش jest).
 * يعني من غير ما حد يصدّر `DATABASE_URL` في الشِل، كل الاختبارات كانت بتروح على `baytak` —
 * **مش القاعدة اللي الـAPI شغّال عليها فعلاً** (`baytak_main` حسب `.env`).
 *
 * أثرها الحقيقي اتقاس في نفس اليوم: `baytak` كانت واقفة على **252 migration** بينما
 * `baytak_main` على **317**. النتيجة `140 suite` راسبة و`781` اختبار فاشل — كلهم بيقولوا إن
 * الكود مكسور وهو سليم تمامًا. نفس التشغيلة بـ`DATABASE_URL` صحيح: **2098/2099**.
 *
 * والاتجاه التاني أخطر: لو القاعدة القديمة صادف إنها **بتعدّي**، الاختبارات بتقول «أخضر» وهي
 * أصلاً ما اختبرتش المخطط الحقيقي.
 *
 * دي بالظبط نفس فئة البَقّة اللي اتصلحت لأدوات الزحف في `scripts/lib/resolve-api-db.js` —
 * أداة بتقيس حاجة غير اللي المفروض تقيسها وبتبلّغ بثقة.
 *
 * **متغيّرات البيئة الحقيقية ليها الأولوية دايمًا** — CI بيصدّر `DATABASE_URL` بتاعه والملف
 * ده مابيدوسش عليه.
 */
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

try {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    // القيمة ممكن تحتوي على `=` (روابط، أسرار) — بناخد اللي بعد أول علامة بس.
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // البيئة الحقيقية بتكسب — CI بيحقن قيمه وde مايتغيّرش.
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // مفيش `.env` محلي (CI مثلاً) — البيئة المصدّرة هي المصدر، وده الوضع الصحيح هناك.
}
