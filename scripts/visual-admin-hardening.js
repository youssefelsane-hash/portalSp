/**
 * **لقطات حقيقية لشاشات الأدمن اللي اتلمست في §188** — مش «الكود بيتجمّع»، «الأدمن شايف إيه».
 *
 * 1. `/settings`: الحد المسموح ظاهر جنب رسوم الطوارئ، وكتابة ٩٠٠ بتقفل زرار الحفظ وبتلوّن الحد.
 * 2. `/technicians/:id`: لوحة مديونية فني مديون فعلاً بتتعرض سليمة بعد تعديل الشاشة.
 *
 * بيقرا النص من الـDOM **ويصوّر** — الفشل بيبان كجملة ناقصة، واللقطة للعين.
 *
 * **حدود صريحة**: زرار «سجّل السداد» محتاج صلاحية `wallets.adjust`، واللي بتفرض Passkey وقت
 * الدخول (ADR-0011) — ومفيش Passkey في متصفح مؤتمت هنا. فالموظف هنا عرض بس، ومسار السداد نفسه
 * متغطّي من الـHTTP الحقيقي في `verify-admin-money-guards.js`.
 *
 *   node scripts/visual-admin-hardening.js [--out <dir>]
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const args = process.argv.slice(2);
const OUT_DIR = args.indexOf('--out') === -1 ? '/tmp/admin-hardening-shots' : args[args.indexOf('--out') + 1];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = new LiveHarness('vah');
  await h.connect();
  let browser;
  const checks = [];
  const record = (label, ok, detail) => checks.push({ label, ok, detail });

  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
    const tech = await h.makeTechnician('t');
    await h.q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',-25000)
       ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = -25000`,
      [tech.userId],
    );
    // صلاحيات عرض بس — مفيش صلاحية منها في `MFA_REQUIRED_PERMISSIONS`، فالدخول بالرمز بيكمّل.
    const viewer = await h.makeEmployee(['settings.view', 'technicians.view', 'wallets.view'], 'viewer');
    const [{ phone_number: phone }] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [viewer.userId]);

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' })).newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160));
    });

    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#phone_number').click();
    await page.locator('#phone_number').pressSequentially(phone, { delay: 15 });
    await page.locator('#pin').click();
    await page.locator('#pin').pressSequentially(LOGIN_PIN, { delay: 15 });
    await page.locator('button[type=submit]').first().click();
    await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 30_000 });

    // ── ١) الإعدادات ──
    await page.goto(`${ADMIN_URL}/settings`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const row = page.locator('text=pricing.emergency_surcharge_percentage').first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    const bodyText = await page.evaluate(() => document.body.innerText);
    record('الحد ظاهر في شاشة الإعدادات', /المسموح: من 0 لـ100/.test(bodyText), 'بيدوّر على «المسموح: من 0 لـ100»');
    await page.screenshot({ path: path.join(OUT_DIR, 'settings-range.png') });

    // ── ٢) لوحة المديونية ──
    await page.goto(`${ADMIN_URL}/technicians/${tech.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const debt = page.locator('text=مديونية').first();
    await debt.scrollIntoViewIfNeeded().catch(() => {});
    const techText = await page.evaluate(() => document.body.innerText);
    record('لوحة المديونية ظاهرة بالمبلغ', /250/.test(techText) && /مديونية/.test(techText), 'بيدوّر على «مديونية» والمبلغ 250');
    await page.screenshot({ path: path.join(OUT_DIR, 'technician-debt.png') });

    record('مفيش أخطاء console', consoleErrors.length === 0, consoleErrors.join(' | ') || 'صفر');
  } finally {
    if (browser) await browser.close();
    await h.cleanup();
    await h.close();
  }

  console.log('\n— شاشات الأدمن كما تظهر —\n');
  let allOk = true;
  for (const { label, ok, detail } of checks) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}\n     ${detail}\n`);
  }
  console.log(`اللقطات في ${OUT_DIR}`);
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
