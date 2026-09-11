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

module.exports = { resolveApiDatabase };
