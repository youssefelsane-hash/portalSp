/**
 * **E2E حقيقي بمتصفح لتفعيل حساب موظف جديد من لوحة التحكم** (ADR-0111).
 *
 * الفجوة اللي بيقفلها: الباك-إند كان بيصدر كود تنشيط صح، بس **مكانش فيه أي مكان في اللوحة
 * يستهلكه فيه** — مفيش `/activate`، مفيش رابط في شاشة الدخول، ومفيش بروكسي `redeem`. فالموظف
 * الجديد كان لازم يروح **موقع العملاء** يفعّل حساب إداري: مسار شغّال تقنيًا وغلط تمامًا.
 *
 * **ليه متصفح حقيقي مش فحص HTML**: شاشة الدخول والتفعيل **client components** بيستخدموا
 * `useSearchParams`، فمحتواهم مابيبانش في الـSSR خالص — فحص نص الـHTML بيرجّع صفر لكل حقل
 * (حتى الحقول القديمة زي `login-submit`). التأكيد الصح لازم يكون بعد ما الجافاسكريبت يشتغل.
 *
 * التشغيل (محتاج الباك-إند على 3000 والأدمن على 3001 وPostgres شغالين):
 *   node apps/admin/test/employee-activation.e2e.mjs
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// **المسار بالنسبة للسكريبت مش لـ`cwd`**: التشغيل من جذر الريبو أو من `apps/admin` لازم يشتغل
// الاتنين، والاعتماد على `cwd` كان بيدوّر على `.env` في مكان غلط ويفشل بـ«مفيش باسورد».
const API_ENV = resolve(dirname(fileURLToPath(import.meta.url)), '../../api/.env');
const jwt = require('jsonwebtoken');

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const API_URL = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const NEW_PIN = process.env.ACTIVATION_TEST_PIN ?? '417253';

const env = (key) => execSync(`grep -m1 '^${key}=' ${API_ENV} | cut -d= -f2-`).toString().trim();
const PG = execSync(
  `grep -m1 DATABASE_URL ${API_ENV} | sed -E 's|.*://[^:]+:([^@]+)@.*|\\1|'`,
).toString().trim();
const sql = (q) =>
  execSync(`PGPASSWORD='${PG}' psql -h localhost -U baytak -d baytak_main -tAc "${q}"`)
    .toString().trim().split('\n')[0].trim();

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` (${detail})` : ''}`);
};

async function main() {
  const secret = env('JWT_ACCESS_SECRET');
  const adminId = sql("SELECT id FROM users WHERE phone_number='+201000000001'");
  const adminToken = jwt.sign(
    { sub: adminId, userType: 'admin', amr: ['pin', 'webauthn'] },
    secret,
    { expiresIn: '15m' },
  );
  // توكن step-up بيتولّد كصف مباشرةً: الـPasskey مستحيل يتعمل من سكربت، والحارس بيستهلك الصف.
  const stepUp = () =>
    sql(`INSERT INTO step_up_tokens (user_id, expires_at) VALUES ('${adminId}', now()+interval '5 min') RETURNING id`);

  const phone = `+2010${String(Date.now()).slice(-8)}`;
  console.log(`الموظف الجديد: ${phone}\n`);

  console.log('═══ ١) Super Admin بينشئ الموظف (كود تنشيط، بلا رمز) ═══');
  const createRes = await fetch(`${API_URL}/admin/employees`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
      'x-step-up-token': stepUp(),
    },
    body: JSON.stringify({ phone_number: phone, full_name: 'موظف E2E تفعيل', department: 'الدعم' }),
  });
  const created = await createRes.json();
  const activationCode = created.data?.activation_code;
  const userId = created.data?.user_id;
  check('الموظف اتعمل وطلع كود تنشيط', Boolean(activationCode && userId), `HTTP ${createRes.status}`);
  if (!activationCode) {
    console.log(JSON.stringify(created).slice(0, 300));
    process.exit(1);
  }
  check('الحساب لسه بلا رمز دخول', sql(`SELECT coalesce(pin_hash,'(NULL)') FROM users WHERE id='${userId}'`) === '(NULL)');

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();

    console.log('\n═══ ٢) شاشة الدخول فيها المدخل للتفعيل ═══');
    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
    const link = page.getByTestId('login-activate-link');
    check('رابط التفعيل ظاهر للمستخدم', await link.isVisible());
    check('وبيوصّل لـ/activate', (await link.getAttribute('href')) === '/activate');

    console.log('\n═══ ٣) الموظف يفعّل حسابه من اللوحة نفسها ═══');
    await link.click();
    await page.waitForURL('**/activate');
    check('وصل لصفحة التفعيل', page.url().endsWith('/activate'));

    await page.getByTestId('activate-phone').fill(phone);
    await page.getByTestId('activate-code').fill(activationCode);
    await page.getByTestId('activate-pin').fill(NEW_PIN);
    await page.getByTestId('activate-pin-confirm').fill(NEW_PIN);
    await page.getByTestId('activate-submit').click();

    // نجاح التفعيل بيرجّعه لشاشة الدخول ورقمه متعبّي.
    await page.waitForURL('**/login**', { timeout: 20_000 });
    check('رجع لشاشة الدخول بعد التفعيل', page.url().includes('/login'));
    check('والرقم متعبّي مش محتاج يكتبه تاني', (await page.locator('#phone_number').inputValue()) === phone);
    check('والرمز اتحفظ في القاعدة', sql(`SELECT (pin_hash IS NOT NULL)::text FROM users WHERE id='${userId}'`) === 'true');

    console.log('\n═══ ٤) بيدخل بالرمز اللي اختاره بنفسه ═══');
    await page.locator('#pin').fill(NEW_PIN);
    await page.getByTestId('login-submit').click();
    // حساب بلا دور عالي بيدخل على طول؛ اللوحة بتحمّل بره /login.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
    check('الدخول نجح ووصل للوحة', !new URL(page.url()).pathname.startsWith('/login'), page.url());
  } finally {
    await browser.close();
    sql(`DELETE FROM pin_reset_tokens WHERE user_id='${userId}'`);
    sql(`UPDATE users SET deleted_at=now(), is_active=false WHERE id='${userId}'`);
    console.log('\nاتمسح الموظف بعد الاختبار.');
  }

  console.log(`\n${'═'.repeat(58)}`);
  console.log(failures ? `❌ ${failures} فشل` : '✅ الفلو كامل من داخل لوحة التحكم');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error('السكريبت وقع:', err);
  process.exit(1);
});
