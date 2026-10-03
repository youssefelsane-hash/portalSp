/**
 * **تحقّق حي بمتصفح: معاينة سعر الويب بتسعّر نفس الحجز اللي هيتأكد** (docs/08 §188).
 *
 * `verify-preview-create-parity.js` بيثبت إن السيرفر بيحسب المعاينة والإنشاء بمسار واحد لو
 * اتبعتله نفس المدخلات. السكربت ده بيثبت النص التاني: إن **شاشة الحجز نفسها** بتبعت المدخلات
 * دي. قبل §188 الويب كان بيبعت يوم البداية بس في «مرن في الموعد»، ومابيبعتش التكرار خالص —
 * فالسيرفر كان بيسعّر حجز تاني غير اللي العميل هيأكده.
 *
 * بيمشي الفلو زي العميل بالظبط (دخول ⇒ عنوان ⇒ موعد ⇒ ترشيح تلقائي ⇒ الخطوة ٣) مرتين:
 *   ١. «مرن في الموعد» بنطاق ⇒ آخر نداء `/orders/preview` فيه `scheduled_at_range_end`.
 *   ٢. يوم محدد ثم «أسبوعي» ⇒ نداء معاينة جديد فيه `repeat_frequency: weekly`.
 *
 *   node scripts/verify-web-preview-wire.js   # محتاج API + customer-web dev (3002) شغالين
 */
'use strict';

const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const SHOTS = process.env.WEB_PREVIEW_SHOTS_DIR;
const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);
const dayFromToday = (n) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA');

async function main() {
  const h = new LiveHarness('wpw');
  await h.connect();
  let browser;
  let failures = 0;
  const check = (pass, label, extra) => {
    ok(pass, label, extra);
    if (!pass) failures += 1;
  };
  try {
    await h.seedCatalog({ priceCents: 40_000, durationMinutes: 120 });
    const serviceId = h.catalog.service.id;
    await h.q(
      `UPDATE services SET allows_scheduling = true, allows_individual = true, allows_emergency = false,
              allows_date_range_booking = true, allows_recurring_booking = true
        WHERE id = $1`,
      [serviceId],
    );
    const customer = await h.makeCustomer('c');
    await h.makeTechnician('t');
    const [{ phone_number: phone }] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [customer.userId]);

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' })).newPage();
    const previews = [];
    page.on('request', (req) => {
      if (req.url().endsWith('/orders/preview') && req.method() === 'POST') previews.push(req.postDataJSON());
    });
    const shot = async (name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });

    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-phone').pressSequentially(phone, { delay: 15 });
    await page.getByTestId('login-pin').pressSequentially(LOGIN_PIN, { delay: 15 });
    await page.getByTestId('login-submit').click();
    await page.waitForFunction(() => !window.location.pathname.includes('login'), { timeout: 30_000 });

    const next = () => page.locator('button', { hasText: 'التالي' }).first();
    /** من أول الصفحة لحد الخطوة ٣ — `pickSchedule` بتحدد الموعد في الخطوة ٢. */
    const reachStep3 = async (pickSchedule) => {
      await page.goto(`${WEB}/services/${serviceId}`, { waitUntil: 'networkidle' });
      await page.locator('input[name="address"]').first().check();
      await page.waitForTimeout(1500);
      await next().click();
      await page.waitForTimeout(2000);
      await pickSchedule();
      // ADR-0118 §3 — الترشيح التلقائي بيحصل لوحده أول ما الموعد يكتمل (مفيش زرار «خلي أسطى يختار»).
      await page.getByTestId('auto-pick-result').waitFor({ timeout: 20_000 });
      await next().click();
      await page.waitForTimeout(3000);
    };

    // ── ١) مرن في الموعد ──
    const rangeStart = dayFromToday(3);
    const rangeEnd = dayFromToday(6);
    await reachStep3(async () => {
      await page.getByRole('button', { name: /مرن في الموعد/ }).click();
      const dates = page.locator('input[type="date"]');
      await dates.nth(0).fill(rangeStart);
      await dates.nth(1).fill(rangeEnd);
      await page.waitForTimeout(1500);
    });
    await shot('web-preview-flexible');
    const flexible = previews.at(-1);
    check(
      flexible?.scheduled_at?.startsWith(rangeStart) && flexible?.scheduled_at_range_end?.startsWith(rangeEnd),
      '«مرن في الموعد» ⇒ المعاينة بتاخد النطاق كله مش يوم البداية بس',
      JSON.stringify({ scheduled_at: flexible?.scheduled_at, scheduled_at_range_end: flexible?.scheduled_at_range_end }),
    );
    check(!('pay_full_amount' in (flexible ?? {})), 'المعاينة مابتبعتش pay_full_amount (العربون بيتقرّر منها)');

    // ── ٢) يوم محدد + أسبوعي ──
    const specificDay = dayFromToday(4);
    await reachStep3(async () => {
      await page.getByRole('button', { name: /اختار يوم محدد/ }).click();
      await page.locator('input[type="date"]').first().fill(specificDay);
      await page.waitForTimeout(1500);
      // الخدمة المزروعة دقتها «ساعة بداية» — العميل بيختار أول ساعة مقترحة.
      const firstTime = page.locator('.booking-time-chip').first();
      if (await firstTime.count()) await firstTime.click();
      await page.waitForTimeout(800);
    });
    const beforeRepeat = previews.length;
    const weekly = page.getByRole('button', { name: 'أسبوعي', exact: true });
    await weekly.waitFor({ timeout: 10_000 }).catch(async (err) => {
      await shot('web-preview-weekly-missing');
      throw err;
    });
    await weekly.click();
    await page.waitForTimeout(2500);
    await shot('web-preview-weekly');
    const repeated = previews.slice(beforeRepeat).at(-1);
    check(
      repeated?.repeat_frequency === 'weekly' && repeated?.scheduled_at?.startsWith(specificDay),
      '«أسبوعي» ⇒ نداء معاينة جديد بالتكرار',
      `نداءات بعد الضغط=${previews.length - beforeRepeat} · ${JSON.stringify(repeated ?? null)}`,
    );
    const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    check(!/حصل خطأ|تعذّر/.test(pageText), 'مفيش رسالة خطأ في صفحة الحجز');
  } finally {
    if (browser) await browser.close();
    await h.cleanup();
    await h.close();
  }
  console.log(failures === 0 ? '\n✅ الويب بيبعت للمعاينة نفس مدخلات الحجز.' : `\n❌ ${failures} فحص فشل.`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
