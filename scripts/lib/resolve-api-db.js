/**
 * اسم قاعدة البيانات اللي **الـAPI الشغّال فعلاً** بيستخدمها.
 *
 * ليه ده موجود: أدوات الزحف (`sweep-customer.js`/`sweep-admin.js`) بتكتب في القاعدة مباشرة
 * (تزرع OTP عشان تسجّل دخول) وبتقرا منها معرّفات حقيقية للصفحات. لو خمّنت القاعدة غلط،
 * **كل حاجة بتفشل بهدوء وبطريقة مضلّلة**: تسجيل الدخول بيفشل فالزحف بيكمّل كزائر (يعني كل
 * الصفحات المحمية مابتتفحصش أصلاً)، والمعرّفات اللي جابتها من قاعدة تانية بترجّع 404 —
 * فالتقرير بيقول «فيه بَقّة 404» وهي مفيش. ده حصل فعلاً: السكربت كان بيقرا `baytak`
 * والـAPI شغّال على `baytak_main`.
 *
 * الترتيب: `PGDATABASE` صريح ← `DATABASE_URL` في البيئة ← `DATABASE_URL` من `apps/api/.env`
 * (نفس الملف اللي الـAPI بيقلع بيه فعلاً) ← الافتراضي القديم.
 *
 * `resolveApiDatabaseUrl()` بيجاوب على نفس السؤال بس بيرجّع **رابط الاتصال كامل** بدل الاسم،
 * للأدوات اللي بتفتح اتصال `pg` بنفسها. كان كل واحدة منهم بتحطّ افتراضًا مكتوب بالإيد
 * (`…/baytak` أو `…/baytak_main`) — وهي نفس البَقّة الموصوفة فوق بالظبط، متكرّرة في أربع
 * أماكن تانية: على الجهاز ده الافتراضي `baytak` قاعدة موجودة وفاضية، فالأداة بتشتغل وتقول
 * «نضيف» وهي مافحصتش القاعدة اللي الـAPI شغّال عليها أصلاً (تدقيق §148).
 */
const fs = require('fs');
const path = require('path');

function databaseFromUrl(url) {
  if (!url) return null;
  const name = url.split('/').pop();
  if (!name) return null;
  // نشيل أي query string (`?sslmode=require`) — جزء من الرابط مش من اسم القاعدة.
  return name.split('?')[0] || null;
}

function resolveApiDatabase() {
  if (process.env.PGDATABASE) return process.env.PGDATABASE;

  const fromEnv = databaseFromUrl(process.env.DATABASE_URL);
  if (fromEnv) return fromEnv;

  const envPath = path.join(__dirname, '..', '..', 'apps', 'api', '.env');
  try {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith('DATABASE_URL='));
    const fromFile = databaseFromUrl(line ? line.slice(line.indexOf('=') + 1).trim() : null);
    if (fromFile) return fromFile;
  } catch {
    // مفيش .env محلي (CI مثلاً) — نكمّل للافتراضي تحت.
  }

  return 'baytak';
}

/**
 * رابط اتصال كامل بنفس القاعدة اللي الـAPI بيقلع بيها. بيرمي لو مالقاش — الفشل بصوت عالي
 * أأمن من افتراض بيخلّي الأداة تفحص قاعدة غلط وتقول «نضيف».
 */
function resolveApiDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = path.join(__dirname, '..', '..', 'apps', 'api', '.env');
  try {
    const line = fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .find((l) => l.trim().startsWith('DATABASE_URL='));
    const fromFile = line ? line.slice(line.indexOf('=') + 1).trim() : null;
    if (fromFile) return fromFile;
  } catch {
    // مفيش .env محلي — بنرمي تحت برسالة واضحة.
  }

  throw new Error(
    'مفيش DATABASE_URL — لا في البيئة ولا في apps/api/.env. حدّده صراحةً قبل تشغيل الأداة.',
  );
}

module.exports = { resolveApiDatabase, resolveApiDatabaseUrl };
