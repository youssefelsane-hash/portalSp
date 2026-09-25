#!/usr/bin/env node
/**
 * لقطة شاشة سريعة لأي صفحة في customer-web (أو الأدمن) — **الطريقة الوحيدة** للرد على بلاغ
 * بصري من المالك زي «الشكل بدائي» أو «الهيرو واخد الشاشة كلها»: `tsc`/`eslint` مابيشوفوش
 * الرندر، و`sweep-customer.js` بيدوّر على أعطال مش على شكل.
 *
 * الاستخدام:
 *   node scripts/web-shot.js <path> <out.png> [width] [height] [--full]
 * أمثلة:
 *   node scripts/web-shot.js / /tmp/home-desktop.png 1280 900 --full
 *   node scripts/web-shot.js / /tmp/home-mobile.png 390 844 --full
 *   node scripts/web-shot.js /orders /tmp/orders.png 1280 900 --login
 *
 * بيطبع كمان أي رسالة كونسول من نوع error/warning وأي طلب رجع ≥400 — لقطة «حلوة» لصفحة
 * بتطبع أخطاء في الكونسول مش نجاح.
 */
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const { resolveApiDatabase } = require('./lib/resolve-api-db');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
const API = process.env.API_URL || 'http://localhost:3000';
const PHONE = process.env.CUSTOMER_PHONE || '+201000000777';
// bcrypt لـ"123456" — نفس الهاش المستخدم في sweep-customer.js بالظبط.
/** رمز دخول حسابات التطوير (ADR-0109) — نفس `DEV_SEED_PIN` في سكربتات الـseed. */
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';

const sql = (q) =>
  execFileSync('psql', ['-h', 'localhost', '-U', 'baytak', '-d', resolveApiDatabase(), '-Atc', q], {
    env: { ...process.env, PGPASSWORD: 'baytak' },
    encoding: 'utf8',
  }).trim();

/**
 * تسجيل دخول عميل حقيقي بالواجهة (مش حقن توكن) — لازم لأي صفحة محمية، وأهمها صفحة الحجز
 * نفسها. بيسجّل الحساب أول مرة لو مش موجود، بنفس مسار الـOTP اللي العميل بيعدّي عليه.
 */
async function loginCustomer(page) {
  if (sql(`SELECT count(*) FROM users WHERE phone_number='${PHONE}'`) === '0') {
    const post = (path, body) =>
      fetch(`${API}/api/v1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    // **ADR-0109 — نداء واحد** بدل: اطلب OTP، استبدل الهاش في القاعدة، سجّل بالكود.
    await post('/auth/pin/register', {
      phone_number: PHONE,
      pin: LOGIN_PIN,
      full_name: 'عميل لقطات الويب',
      user_type: 'customer',
    });
  }

  // **`networkidle` مقصود هنا**: صفحة الدخول بتنده `/api/auth/refresh` أول ما تفتح، والرد
  // بيعمل re-render. الكتابة في الحقل قبل ما الـre-render ده يحصل بتتمسح أحيانًا (اتلقطت
  // بالتشغيل: القيمة موجودة عند 0ms وفاضية عند 300ms)، فالفورم بيتبعت برقم فاضي والباك-إند
  // يرد «البيانات المرسلة غير صحيحة». الانتظار لحد ما الشبكة تهدى بيخلّي الكتابة بعد الاستقرار.
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  // **ADR-0109 — فورم واحد**: الرقم والرمز مع بعض. و`data-testid` مش `placeholder`، لأن
  // الـplaceholder نص معروض للمستخدم وبيتغيّر مع أي تحرير للنسخ.
  await page.getByTestId('login-phone').waitFor({ timeout: 20000 });
  await page.getByTestId('login-phone').fill(PHONE);
  await page.getByTestId('login-pin').fill(LOGIN_PIN);
  await page.getByTestId('login-submit').click();
  await page.waitForTimeout(3500);
  return !page.url().includes('/login');
}

async function main() {
  const [path = '/', out = '/tmp/web-shot.png', width = '1280', height = '900'] = process.argv.slice(2);
  const fullPage = process.argv.includes('--full');
  const needsLogin = process.argv.includes('--login');

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: Number(width), height: Number(height) },
    locale: 'ar-EG',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`[console:${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) problems.push(`[http:${res.status()}] ${res.url()}`);
  });

  if (needsLogin) {
    const ok = await loginCustomer(page);
    if (!ok) console.log('⚠️  تسجيل الدخول فشل — اللقطة هتبقى لنسخة الزائر');
    problems.length = 0; // أخطاء صفحة الدخول نفسها مش جزء من الصفحة اللي بنصوّرها
  }

  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle', timeout: 45000 });
  // الصور المُدارة من الأدمن بتوصل بعد أول رسم — من غير المهلة دي اللقطة بتمسك حالة التحميل
  // بدل الحالة النهائية، وهي بالظبط اللي بنحاول نحكم عليها.
  await page.waitForTimeout(1200);

  // كاشف التجاوز الأفقي — أهم عيب بصري في موبايل-أول، وبيختفي تمامًا على الشاشة الكبيرة.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1 ? { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth } : null;
  });

  await page.screenshot({ path: out, fullPage });
  await browser.close();

  console.log(`✅ ${out} (${width}×${height}${fullPage ? ', full' : ''})`);
  if (overflow) console.log(`⚠️  تجاوز أفقي: scrollWidth=${overflow.scrollWidth} > clientWidth=${overflow.clientWidth}`);
  if (problems.length) {
    console.log(`⚠️  ${problems.length} ملاحظة:`);
    for (const p of problems.slice(0, 15)) console.log(`   ${p}`);
  } else {
    console.log('✅ كونسول نضيف، صفر ردود ≥400');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
