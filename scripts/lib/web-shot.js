#!/usr/bin/env node
/**
 * لقطة شاشة سريعة لأي صفحة في customer-web (أو الأدمن) — **الطريقة الوحيدة** للرد على بلاغ
 * بصري من المالك زي «الشكل بدائي» أو «الهيرو واخد الشاشة كلها»: `tsc`/`eslint` مابيشوفوش
 * الرندر، و`sweep-customer.js` بيدوّر على أعطال مش على شكل.
 *
 * الاستخدام:
 *   node scripts/lib/web-shot.js <path> <out.png> [width] [height] [--full]
 * أمثلة:
 *   node scripts/lib/web-shot.js / /tmp/home-desktop.png 1280 900 --full
 *   node scripts/lib/web-shot.js / /tmp/home-mobile.png 390 844 --full
 *
 * بيطبع كمان أي رسالة كونسول من نوع error/warning وأي طلب رجع ≥400 — لقطة «حلوة» لصفحة
 * بتطبع أخطاء في الكونسول مش نجاح.
 */
const { chromium } = require('playwright-core');

const WEB = process.env.WEB_URL || 'http://localhost:3002';

async function main() {
  const [path = '/', out = '/tmp/web-shot.png', width = '1280', height = '900'] = process.argv.slice(2);
  const fullPage = process.argv.includes('--full');

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
