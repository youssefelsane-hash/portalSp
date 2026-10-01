/**
 * **تحقق بمتصفح حقيقي: رقم محلي + توجيه تلقائي بين الدخول والتسجيل على الويب** (docs/08 §189
 * UX-1/UX-2، ADR-0115).
 *
 *   ١. الدخول برقم مش مسجّل ⇒ رسالة ⇒ انتقال تلقائي لـ«حساب جديد» بالرقم مكتوب والتركيز على الاسم.
 *   ٢. «خليني هنا» بتلغي الانتقال فعلاً.
 *   ٣. «حساب جديد» برقم مسجّل ⇒ انتقال لتسجيل الدخول والتركيز على الرمز.
 *   ٤. الدخول بالشكل المحلي `010…` + الرمز بيفتح الحساب (مش `+20` بس).
 *   ٥. حساب جديد بالشكل المحلي بيتسجّل بنفس هوية E.164 في القاعدة.
 *
 *   node scripts/verify-web-phone-routing.js   # محتاج API + customer-web شغّالين
 */
'use strict';

const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness, LIVE_TEST_PIN } = require('./lib/live-harness');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
const toLocal = (e164) => `0${e164.slice(3)}`;

async function main() {
  const h = new LiveHarness('wpr');
  await h.connect();
  let browser;
  try {
    const existing = await h.registerCustomerWithPin({ fullName: 'عميل توجيه ويب' });
    if (existing.error) throw new Error(existing.error);
    const freshE164 = h.nextPhone();
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
    const page = await context.newPage();

    // ═══ ١. دخول برقم مش مسجّل ⇒ حساب جديد ═══
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-phone').fill(toLocal(freshE164));
    await page.getByTestId('phone-routing-notice').waitFor({ timeout: 8000 });
    const noticeText = await page.getByTestId('phone-routing-notice').innerText();
    await page.waitForURL(/\/register\?/, { timeout: 8000 });
    await page.getByTestId('register-new-number').waitFor();
    const prefilled = await page.getByTestId('register-phone').inputValue();
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    h.record(
      'دخول برقم مش مسجّل ⇒ رسالة ⇒ انتقال تلقائي لحساب جديد بالرقم، والتركيز على الاسم',
      noticeText.includes('مش مسجّل') && prefilled === toLocal(freshE164) && focused === 'register-full-name',
      `رسالة=«${noticeText.split('\n')[0]}» رقم=${prefilled} تركيز=${focused}`,
    );

    // ═══ ٢. «خليني هنا» بتلغي الانتقال ═══
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-phone').fill(toLocal(h.nextPhone()));
    await page.getByTestId('phone-routing-stay').click({ timeout: 8000 });
    await page.waitForTimeout(3500);
    h.record('«لا، خليني هنا» بتلغي الانتقال فعلاً', page.url().includes('/login'), page.url());

    // ═══ ٣. حساب جديد برقم مسجّل ⇒ الدخول ═══
    await page.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
    await page.getByTestId('register-phone').fill(toLocal(existing.phone));
    await page.waitForURL(/\/login\?/, { timeout: 10000 });
    await page.getByTestId('login-existing-account').waitFor();
    const focusedPin = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    h.record(
      'حساب جديد برقم مسجّل ⇒ انتقال لتسجيل الدخول والتركيز على الرمز',
      focusedPin === 'login-pin' && (await page.getByTestId('login-phone').inputValue()) === toLocal(existing.phone),
      `تركيز=${focusedPin}`,
    );

    // ═══ ٤. الدخول بالشكل المحلي ═══
    await page.getByTestId('login-pin').fill(LIVE_TEST_PIN);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => undefined);
    h.record('الدخول بـ010… + الرمز بيفتح الحساب', !page.url().includes('/login'), page.url());

    // ═══ ٥. حساب جديد بالشكل المحلي ⇒ نفس هوية E.164 ═══
    const page2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const brandNew = h.nextPhone();
    await page2.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
    await page2.getByTestId('register-full-name').fill('عميل رقم محلي');
    await page2.getByTestId('register-phone').fill(toLocal(brandNew));
    await page2.getByTestId('register-pin').fill('482917');
    await page2.getByTestId('register-pin-confirm').fill('482917');
    await page2.getByTestId('register-submit').click();
    await page2.waitForURL((url) => !url.pathname.startsWith('/register'), { timeout: 15000 }).catch(() => undefined);
    const [row] = await h.q('SELECT id, phone_number FROM users WHERE phone_number = $1', [brandNew]);
    // الحساب اتعمل من المتصفح مش من الـharness — بيتسجّل هنا عشان `cleanup()` تمسحه بنفس ترتيبها الآمن.
    if (row) h.created.users.push(row.id);
    h.record('حساب جديد بـ010… بيتسجّل بنفس هوية +20 في القاعدة', row?.phone_number === brandNew, JSON.stringify(row ?? null));
  } finally {
    await browser?.close();
    await h.cleanup();
    await h.close();
  }
  const failures = h.failures;
  console.log(failures.length === 0 ? `\n${h.results.length}/${h.results.length} فحص نضيف 🟢` : `\n${failures.length} فحص فشل 🔴`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
