#!/usr/bin/env node
/**
 * زحف بصري/وظيفي على **كل صفحة في تطبيق العميل على الويب** (docs/08 §132).
 *
 * ده التوأم المفقود لـ`sweep-admin.js`: الأداة دي كانت بتغطّي لوحة الأدمن بس، بينما **العميل**
 * هو اللي بيشوف المنتج أكتر من أي حد. نفس الكواشف بالحرف (كونسول، استثناءات، ردود ‏≥400، تجاوز
 * أفقي، صفحة شبه فاضية) + كاشفين مخصوصين للعميل:
 *
 *   • **الزحف بمقاس موبايل كمان** (390×844) — customer-web موبايل-أول، والتجاوز الأفقي عند
 *     ٣٩٠ بكسل بَقّة حقيقية بيشوفها كل عميل بينما الشاشة الكبيرة بتخبّيها تمامًا.
 *   • **كشف نص خام مكسور** — `undefined` / `NaN` / `[object Object]` / `null` ظاهرة للمستخدم.
 *     دي أعراض حقل ناقص في العقد، وبتعدّي من كل الاختبارات لأنها مش استثناء.
 *
 * الاستخدام (لازم API + customer-web dev شغالين):
 *   CUSTOMER_PHONE=+201000000777 node scripts/sweep-customer.js
 */
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');

const OUT = process.env.SWEEP_OUT || '/tmp/baytak-sweep-customer';
fs.mkdirSync(OUT, { recursive: true });
const WEB = process.env.WEB_URL || 'http://localhost:3002';
const API = process.env.API_URL || 'http://localhost:3000';
const PHONE = process.env.CUSTOMER_PHONE || '+201000000777';
// bcrypt لـ"123456" — نفس الهاش المستخدم في sweep-admin.js بالظبط.
const OTP_HASH = '$2a$10$PoWE4iYX5toQG0ZL6pQo8eiCMWo4jIRewyXxmehAefIs/uKGwvPJ2';
// اسم قاعدة البيانات بيتقرا من البيئة — كان مكتوب بالإيد في sweep-admin.js وبيفشل على أي جهاز
// اسم قاعدته مختلف.
const DB = process.env.PGDATABASE || (process.env.DATABASE_URL || '').split('/').pop() || 'baytak';

const sql = (q) =>
  execFileSync('psql', ['-h', 'localhost', '-U', 'baytak', '-d', DB, '-Atc', q], {
    env: { ...process.env, PGPASSWORD: 'baytak' },
    encoding: 'utf8',
  }).trim();

/** الصفحات الثابتة + صفحات بمعرّفات حقيقية من قاعدة البيانات (مش UUIDs مخترعة). */
function routes() {
  const first = (q) => sql(q).split('\n')[0] || '';
  const service = first(`SELECT id FROM services WHERE deleted_at IS NULL AND is_active LIMIT 1`);
  const category = first(`SELECT id FROM service_categories WHERE deleted_at IS NULL LIMIT 1`);
  const tech = first(`SELECT id FROM technician_profiles WHERE deleted_at IS NULL AND verification_status='approved' LIMIT 1`);
  const order = first(
    `SELECT o.id FROM orders o JOIN customer_profiles cp ON cp.id=o.customer_id
     JOIN users u ON u.id=cp.user_id WHERE u.phone_number='${PHONE}' AND o.deleted_at IS NULL
     ORDER BY o.created_at DESC LIMIT 1`,
  );
  const list = [
    '/', '/search', '/orders', '/login', '/register',
    '/account', '/account/addresses', '/account/complaints', '/account/favorites',
    '/account/loyalty', '/account/notifications', '/account/payment-methods',
    '/account/projects', '/account/recurring', '/account/referrals', '/account/wallet',
    '/account/warranties',
    '/legal/terms', '/legal/privacy', '/legal/account-deletion',
  ];
  if (category) list.push(`/categories/${category}`);
  if (service) list.push(`/services/${service}`);
  if (tech) list.push(`/technicians/${tech}`);
  if (order) list.push(`/orders/${order}`);
  return list;
}

/** نصوص بتوصل للمستخدم ومعناها إن حقل في العقد وصل `undefined`/غلط. */
const BROKEN_TEXT = ['undefined', 'NaN', '[object Object]', 'null null', 'Infinity'];

async function visit(page, path, label) {
  const errors = [];
  const failed = [];
  const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)); };
  const onPageError = (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 180));
  const onResponse = (r) => {
    if (r.status() >= 400) {
      failed.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, 'API').replace(WEB, '')}`.slice(0, 120));
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('response', onResponse);

  let status = 'ok';
  try {
    const resp = await page.goto(WEB + path, { waitUntil: 'networkidle', timeout: 40000 });
    status = String(resp?.status() ?? '?');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${label}${path.replace(/[/:]/g, '_')}.png`, fullPage: true });

    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)) {
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      errors.push(`⚠️ تجاوز أفقي (${w[0]} > ${w[1]})`);
    }
    const text = await page.evaluate(() => (document.body.innerText || '').trim());
    if (text.length < 60) errors.push(`⚠️ شبه فاضية (${text.length} حرف)`);
    for (const bad of BROKEN_TEXT) {
      if (text.includes(bad)) errors.push(`⚠️ نص مكسور ظاهر للمستخدم: "${bad}"`);
    }
  } catch (e) {
    status = 'FAIL ' + String(e).slice(0, 120);
  }

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('response', onResponse);
  return { status, errors: [...new Set(errors)], failed: [...new Set(failed)] };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });

  const paths = routes();
  const report = [];

  for (const [label, viewport] of [
    ['desk', { width: 1440, height: 1000 }],
    ['mob', { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({ viewport, locale: 'ar-EG' });
    const page = await ctx.newPage();

    // ── دخول العميل بالواجهة الحقيقية (مش حقن توكن) ─────────────────────────────
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.fill('input[placeholder="+2010xxxxxxxx"]', PHONE);
    await page.getByRole('button', { name: /إرسال|كود|تسجيل/ }).first().click();
    await page.waitForTimeout(2500);
    sql(
      `UPDATE otp_codes SET code_hash='${OTP_HASH}', attempts_count=0, is_used=false
       WHERE id=(SELECT id FROM otp_codes WHERE phone_number='${PHONE}' ORDER BY created_at DESC LIMIT 1)`,
    );
    await page.fill('input[placeholder="كود التحقق"]', '123456');
    await page.getByRole('button', { name: /دخول|تأكيد|تحقق/ }).first().click();
    await page.waitForTimeout(3500);
    const loggedIn = !page.url().includes('/login');
    console.log(`\n[${label}] دخول العميل: ${loggedIn ? '✅' : '❌ فشل — الزحف هيكمل كزائر'}`);

    for (const path of paths) {
      const r = await visit(page, path, label);
      if (r.status !== '200' || r.errors.length || r.failed.length) {
        report.push({ label, path, ...r });
        console.log(`\n── [${label}] ${path} [${r.status}]`);
        r.errors.slice(0, 5).forEach((x) => console.log('   ❌ ' + x));
        r.failed.slice(0, 5).forEach((x) => console.log('   🌐 ' + x));
      }
    }
    await ctx.close();
  }

  const total = paths.length * 2;
  console.log(`\n═══ ${total - report.length}/${total} صفحة نضيفة تمامًا (سطح مكتب + موبايل) ═══`);
  console.log(`اللقطات في ${OUT}`);
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.length ? 1 : 0);
})();
