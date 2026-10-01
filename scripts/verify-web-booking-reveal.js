/**
 * **تحقّق بمتصفح: التمرير الهادي في حجز الويب** (docs/08 §189 بند UX-3).
 *
 * طلب المالك: «بعد ما يختار اليوم، الصفحة تنزل لوحدها بسيكة صغيرة لحد الساعة، بسلاسة من غير إجبار».
 *
 *   ١. على موبايل قصير، جزء الساعة **مستخبي** تحت الشاشة قبل اختيار اليوم.
 *   ٢. اختيار اليوم ⇒ الصفحة بتنزل لوحدها لحد ما جزء الساعة يبان كله (أو أوله لو أطول من الشاشة).
 *   ٣. التمرير **صغير**: قسم الموعد نفسه لسه باين (مش قفزة لآخر الصفحة).
 *   ٤. اختيار ساعة من الاقتراحات ⇒ بداية «اختيار مقدم الخدمة» بتبان.
 *   ٥. «تقليل الحركة» في النظام ⇒ نفس النتيجة من غير أنيميشن.
 *
 *   node scripts/verify-web-booking-reveal.js   # محتاج API + customer-web شغّالين
 */
'use strict';

const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness, LIVE_TEST_PIN } = require('./lib/live-harness');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
const VIEWPORT = { width: 390, height: 640 };

function tomorrowCairo() {
  const d = new Date(Date.now() + 36 * 3600 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

async function openStepTwo(browser, phone, serviceId, reducedMotion) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'ar-EG', reducedMotion });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.getByTestId('login-phone').fill(phone);
  await page.getByTestId('login-pin').fill(LIVE_TEST_PIN);
  await page.getByTestId('login-submit').click();
  await page.waitForFunction(() => !window.location.pathname.includes('login'), { timeout: 30_000 });
  await page.goto(`${WEB}/services/${serviceId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.locator('input[name="address"]').first().check();
  await page.waitForTimeout(2000);
  await page.locator('button', { hasText: 'التالي' }).first().click();
  await page.locator('#booking-schedule').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return page;
}

const box = (page, selector) => page.locator(selector).first().boundingBox();

async function main() {
  const h = new LiveHarness('wbr');
  await h.connect();
  let browser;
  try {
    await h.seedCatalog({ priceCents: 40_000, durationMinutes: 120 });
    const serviceId = h.catalog.service.id;
    await h.q(
      `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
       VALUES ($1,'formula','final_price',$2,1, now(), true)`,
      [serviceId, JSON.stringify({ price_cents: { type: 'literal', value: 40000 }, duration_minutes: { type: 'literal', value: 120 } })],
    );
    const customer = await h.makeCustomer('c');
    await h.makeTechnician('t');
    const [user] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [customer.userId]);
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

    // ═══ ١–٣ ═══
    const page = await openStepTwo(browser, user.phone_number, serviceId, 'no-preference');
    const before = await box(page, '[data-testid="booking-time-section"]');
    h.record(
      'قبل اختيار اليوم: جزء الساعة تحت الشاشة (الحالة اللي العميل كان بيتوه فيها)',
      before !== null && before.y + 40 > VIEWPORT.height,
      `time.y=${before?.y}`,
    );
    await page.locator('#booking-schedule input[type="date"]').first().fill(tomorrowCairo());
    await page.waitForTimeout(2200); // التمرير + وصول اقتراحات الساعة
    const after = await box(page, '[data-testid="booking-time-section"]');
    const scheduleTop = await box(page, '#booking-schedule input[type="date"]');
    const scrollY = await page.evaluate(() => window.scrollY);
    const timeShown = after !== null && after.y >= 0 && (after.y + after.height <= VIEWPORT.height || after.y <= 120);
    h.record('بعد اختيار اليوم: الصفحة نزلت لوحدها وجزء الساعة باين', scrollY > 0 && timeShown, `scrollY=${scrollY} time.y=${after?.y} h=${after?.height}`);
    h.record(
      'التمرير صغير: خانة اليوم اللي اختاره لسه على الشاشة أو قريبة منها',
      scheduleTop !== null && scheduleTop.y > -scheduleTop.height - 80,
      `date.y=${scheduleTop?.y}`,
    );

    // ═══ ٤ ═══
    const chip = page.locator('[data-testid="booking-time-section"] button.booking-time-chip').first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(1200);
      const provider = await box(page, '#booking-provider');
      h.record(
        'اختيار ساعة ⇒ بداية «مقدم الخدمة» بتبان',
        provider !== null && provider.y >= 0 && provider.y < VIEWPORT.height - 60,
        `provider.y=${provider?.y}`,
      );
    } else {
      h.record('اقتراحات الساعة ظهرت عشان نختار منها', false, 'مفيش ولا اقتراح ساعة');
    }

    // ═══ ٥ ═══
    const calm = await openStepTwo(browser, user.phone_number, serviceId, 'reduce');
    await calm.locator('#booking-schedule input[type="date"]').first().fill(tomorrowCairo());
    await calm.waitForTimeout(2200);
    const calmBox = await box(calm, '[data-testid="booking-time-section"]');
    h.record(
      '«تقليل الحركة» ⇒ نفس النتيجة من غير أنيميشن',
      calmBox !== null && calmBox.y >= 0 && calmBox.y < VIEWPORT.height - 40,
      `time.y=${calmBox?.y}`,
    );
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
