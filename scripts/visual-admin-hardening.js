/**
 * **الأدمن بيدوس الزرار فعلاً** — شاشات §188 من المتصفح للقاعدة، مش «الكود بيتجمّع».
 *
 * 1. `/settings`: الحد المسموح ظاهر جنب رسوم الطوارئ؛ ٩٠٠ بتقفل «حفظ» وبتلوّن الحد؛ ٢٥ بتتحفظ
 *    بعد تأكيد Passkey وبتوصل القاعدة.
 * 2. `/technicians/:id`: «سجّل السداد» بيطلب Passkey، وبيسجّل صف واحد بمفتاح Idempotency؛
 *    السداد التاني بيتسجّل بمفتاح **جديد** (مش بيتعامل كإعادة للأول) — ده اللي بيثبت إن الشاشة
 *    بتجدّد المفتاح صح.
 *
 * الدخول بالمسار الحقيقي: رقم + رمز ثم Passkey من مصادق افتراضي عبر CDP (نفس `sweep-admin.js`) —
 * صلاحيتا `settings.manage` و`wallets.adjust` بيفرضوا MFA (ADR-0011)، فمفيش طريق مختصر.
 *
 *   node scripts/visual-admin-hardening.js [--out <dir>]
 *
 * محتاج API (`THROTTLE_LIMIT=100000`) + admin dev على 3001.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const SURCHARGE_KEY = 'pricing.emergency_surcharge_percentage';
const args = process.argv.slice(2);
const OUT_DIR = args.indexOf('--out') === -1 ? '/tmp/admin-hardening-shots' : args[args.indexOf('--out') + 1];

/** نفس حلقة `sweep-admin.js`: تسجيل Passkey ثم إقرار أكواد الاسترجاع، بالاسم الصريح للزرار. */
async function completeMfa(page) {
  for (let i = 0; i < 5; i++) {
    if (!page.url().includes('/login')) return;
    if (await page.locator('#ack').count()) {
      await page.check('#ack');
      await page.getByRole('button', { name: /كمّل|الإدارة/ }).click().catch(() => {});
      await page.waitForTimeout(3000);
      continue;
    }
    const mfaButton = page.getByRole('button', { name: /سجّل Passkey دلوقتي|تأكيد بـ ?Passkey/ });
    if (await mfaButton.count()) {
      await mfaButton.first().click().catch(() => {});
      await page.waitForTimeout(3000);
      continue;
    }
    await page.waitForTimeout(1500);
  }
}

/** بيدوس الزرار، ولو ظهر حوار «تأكيد هويتك» بيأكد بالـPasskey — ويرجّع رد الـAPI المقصود. */
async function clickWithStepUp(page, button, urlPart, method) {
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes(urlPart) && r.request().method() === method && r.status() !== 403,
    { timeout: 30_000 },
  );
  await button.click();
  const confirm = page.getByRole('button', { name: /تأكيد بـ ?Passkey/ });
  await confirm.waitFor({ timeout: 4000 }).then(() => confirm.click()).catch(() => {});
  return responsePromise;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = new LiveHarness('vah');
  await h.connect();
  let browser;
  let surchargeBefore;
  let techId;
  const checks = [];
  const record = (label, ok, detail) => checks.push({ label, ok, detail });

  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
    const tech = await h.makeTechnician('t');
    techId = tech.id;
    const [wallet] = await h.q(
      `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',-25000)
       ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = -25000 RETURNING id`,
      [tech.userId],
    );
    const finance = await h.makeEmployee(['settings.manage', 'technicians.view', 'wallets.view', 'wallets.adjust'], 'fin');
    const [{ phone_number: phone }] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [finance.userId]);
    [{ value: surchargeBefore }] = await h.q(`SELECT value FROM settings WHERE key = $1`, [SURCHARGE_KEY]);

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      },
    });

    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#phone_number').fill(phone);
    await page.locator('#pin').fill(LOGIN_PIN);
    await page.locator('button[type=submit]').first().click();
    await page.waitForTimeout(3000);
    await completeMfa(page);
    record('دخول موظف مالية بالرمز + Passkey', !page.url().includes('/login'), page.url());
    if (page.url().includes('/login')) {
      await page.screenshot({ path: path.join(OUT_DIR, 'login-stuck.png') });
      return;
    }

    // بعد الدخول بس: ٤٠١ صفحة الدخول (فحص كوكي التحديث قبل أي جلسة) طبيعي ومش موضوعنا.
    const consoleErrors = [];
    const failedCalls = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) consoleErrors.push(msg.text().slice(0, 160));
    });
    // AUTH_006 مش فشل: ده أول نداء للعملية الحساسة، والرد عليه هو حوار الـPasskey نفسه.
    page.on('response', async (r) => {
      if (r.status() < 400 || !r.url().includes('/api/v1/')) return;
      const body = await r.json().catch(() => null);
      if ((body?.error?.code ?? body?.code) === 'AUTH_006') return;
      failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/v1')[1]}`);
    });

    // ── ١) الإعدادات ──
    await page.goto(`${ADMIN_URL}/settings`, { waitUntil: 'networkidle' });
    const row = page.locator('tr', { has: page.locator('td', { hasText: new RegExp(`^${SURCHARGE_KEY.replace(/\./g, '\\.')}$`) }) });
    await row.waitFor({ timeout: 15_000 });
    await row.scrollIntoViewIfNeeded();
    const hint = row.locator('p', { hasText: 'المسموح' });
    record('الحد ظاهر جنب الإعداد', /المسموح: من 0 لـ100/.test((await hint.textContent()) ?? ''), (await hint.textContent()) ?? 'مفيش');

    const input = row.locator('input');
    await input.fill('900');
    const saveButton = row.getByRole('button', { name: 'حفظ' });
    const blocked = await saveButton.isDisabled();
    const hintClass = (await hint.getAttribute('class')) ?? '';
    record('٩٠٠ ⇒ «حفظ» مقفول والحد أحمر', blocked && hintClass.includes('text-destructive') && (await input.getAttribute('aria-invalid')) === 'true',
      `مقفول=${blocked} · ${hintClass}`);
    await row.screenshot({ path: path.join(OUT_DIR, 'settings-out-of-range.png') });
    await page.screenshot({ path: path.join(OUT_DIR, 'settings-out-of-range-page.png') });

    await input.fill('25');
    const saved = await clickWithStepUp(page, saveButton, `/admin/settings/${SURCHARGE_KEY}`, 'PATCH');
    await page.waitForTimeout(800);
    const [{ value: surchargeAfter }] = await h.q(`SELECT value FROM settings WHERE key = $1`, [SURCHARGE_KEY]);
    record('٢٥ ⇒ اتحفظت بعد Passkey ووصلت القاعدة', saved.status() < 300 && Number(surchargeAfter) === 25,
      `HTTP ${saved.status()} · القاعدة ${JSON.stringify(surchargeAfter)}`);
    await row.screenshot({ path: path.join(OUT_DIR, 'settings-saved.png') });

    // ── ٢) لوحة المديونية ──
    await page.goto(`${ADMIN_URL}/technicians/${tech.id}`, { waitUntil: 'networkidle' });
    const amountInput = page.locator('#debt-amount');
    await amountInput.waitFor({ timeout: 15_000 });
    // أعلى الصفحة كما يشوفها موظف مالية: من غير شريط «دورك الإداري مش مديك صلاحية» الأحمر.
    await page.screenshot({ path: path.join(OUT_DIR, 'technician-page-finance-employee.png') });
    const deniedBanner = await page.getByText('دورك الإداري مش مديك صلاحية').count();
    record('صفحة الفني لموظف مالية من غير شريط «مش مديك صلاحية»', deniedBanner === 0, `عدد الشرايط ${deniedBanner}`);
    await amountInput.scrollIntoViewIfNeeded();
    const panel = page.locator('div', { has: page.getByText('مديونية الفني للمنصة') }).filter({ has: amountInput }).last();
    await panel.screenshot({ path: path.join(OUT_DIR, 'debt-before.png') });

    const settleButton = page.getByRole('button', { name: 'سجّل السداد' });
    const settleOnce = async (egp) => {
      await amountInput.fill(String(egp));
      const response = await clickWithStepUp(page, settleButton, `/debt/settlements`, 'POST');
      await page.waitForTimeout(800);
      return response;
    };
    const first = await settleOnce(100);
    const second = await settleOnce(50);
    const rows = await h.q(
      `SELECT amount_cents, idempotency_key FROM technician_debt_settlements WHERE technician_id = $1 ORDER BY created_at`,
      [tech.id],
    );
    const [{ balance_cents: balance }] = await h.q(`SELECT balance_cents FROM wallets WHERE id = $1`, [wallet.id]);
    const keys = rows.map((r) => r.idempotency_key);
    record('سدادين من الزرار ⇒ صفّين بمفتاحين مختلفين والرصيد -١٠٠ ج',
      first.status() < 300 && second.status() < 300 && rows.length === 2 && keys.every(Boolean) &&
        keys[0] !== keys[1] && Number(balance) === -10_000,
      `HTTP ${first.status()}/${second.status()} · صفوف ${rows.length} · مفاتيح مختلفة=${keys[0] !== keys[1]} · الرصيد ${balance}`);
    const panelText = (await panel.textContent()) ?? '';
    record('اللوحة بتعرض الرصيد الجديد من غير ريفريش', /100(\.00)?/.test(panelText), panelText.slice(0, 120));
    await panel.screenshot({ path: path.join(OUT_DIR, 'debt-after.png') });

    record('مفيش أخطاء console', consoleErrors.length === 0, consoleErrors.join(' | ') || 'صفر');
    record('مفيش نداء API فاشل بعد الدخول', failedCalls.length === 0, failedCalls.join(' | ') || 'صفر');
  } finally {
    if (browser) await browser.close();
    if (surchargeBefore !== undefined) await h.setSetting(SURCHARGE_KEY, surchargeBefore);
    if (techId) await h.q(`DELETE FROM technician_debt_settlements WHERE technician_id = $1`, [techId]).catch(() => {});
    await h.cleanup();
    await h.close();
  }

  console.log('\n— الأدمن بيدوس الزرار —\n');
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
