/**
 * **تحقق End-to-End بمتصفح حقيقي لجولة UX على الويب** (docs/08 §185) — مكمّل لـ
 * `verify-web-flow-order.js` (الخطوات والتمرير والرسايل):
 *
 *   ١. افتراضي الأدمن (`default_value`) على سؤال اختياري بيظهر مختار في فورم الحجز.
 *   ٢. فورم «+ عنوان جديد» الحقيقي بيبعت العمارة/الدور/الشقة/العلامة/**ملاحظات الوصول**، وPostgres
 *      بيسجّلهم — ده المنتِج الوحيد لـ«ملاحظات الوصول» اللي بتظهر عند مقدم الخدمة.
 *   ٣. رقم الدعم في الفوتر (من `legal.support_phone` في الإعدادات) بيفتح واتساب مش `tel:`.
 *
 *   node scripts/verify-web-ux-round-e2e.js   # محتاج API + customer-web شغّالين
 */
'use strict';

const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const SUPPORT_PHONE = '+201505988990';

async function main() {
  const h = new LiveHarness('wux');
  await h.connect();
  let browser;
  const [{ value: previousSupportPhone }] = await h.q(`SELECT value FROM settings WHERE key = 'legal.support_phone'`);
  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
    const serviceId = h.catalog.service.id;
    await h.q(
      `INSERT INTO service_pricing_fields
         (service_id, field_key, label_ar, field_type, is_required, display_order, options, default_value)
       VALUES ($1,'shirts_type','نوع الخدمة للقمصان','dropdown',false,1,
               '[{"value":"same_as_main","label_ar":"نفس الخدمة الأساسية"},{"value":"dry_clean_iron","label_ar":"دراي كلين + كي"}]'::jsonb,
               'same_as_main')`,
      [serviceId],
    );
    const customer = await h.makeCustomer('c');
    const [user] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [customer.userId]);
    await h.setSetting('legal.support_phone', SUPPORT_PHONE);

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' })).newPage();
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-phone').click();
    await page.getByTestId('login-phone').pressSequentially(user.phone_number, { delay: 15 });
    await page.getByTestId('login-pin').click();
    await page.getByTestId('login-pin').pressSequentially(LOGIN_PIN, { delay: 15 });
    await page.getByTestId('login-submit').click();
    await page.waitForFunction(() => !window.location.pathname.includes('login'), { timeout: 30_000 });

    await page.goto(`${WEB}/services/${serviceId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1500);

    // ═══ ١. افتراضي الأدمن ظاهر مختار ═══
    await page.locator('input[name="address"]').first().check();
    await page.waitForTimeout(2000);
    const pressed = await page
      .locator('#booking-field-shirts_type button', { hasText: 'نفس الخدمة الأساسية' })
      .getAttribute('aria-pressed');
    h.record('افتراضي الأدمن على سؤال اختياري بيظهر مختار في فورم الويب', pressed === 'true', `aria-pressed=${pressed}`);

    // ═══ ٢. فورم العنوان الحقيقي ⇒ Postgres ═══
    await page.locator('button', { hasText: '+ عنوان جديد' }).click();
    const form = page.locator('form', { has: page.locator('textarea') }).last();
    const citySelect = form.locator('select').nth(0);
    await citySelect.waitFor();
    await page.waitForFunction(() => document.querySelectorAll('form select')[0]?.options.length > 1, null, { timeout: 15_000 });
    const cityValue = await citySelect.locator('option').nth(1).getAttribute('value');
    await citySelect.selectOption(cityValue);
    await page.waitForFunction(() => document.querySelectorAll('form select')[1]?.options.length > 1, null, { timeout: 15_000 });
    const areaSelect = form.locator('select').nth(1);
    await areaSelect.selectOption(await areaSelect.locator('option').nth(1).getAttribute('value'));
    await form.getByPlaceholder('اسم الشارع').fill('شارع ويب E2E');
    await form.getByPlaceholder('رقم العمارة').fill('15');
    await form.getByPlaceholder('الدور').fill('3');
    await form.getByPlaceholder('الشقة').fill('7');
    await form.getByPlaceholder('علامة مميزة (اختياري)').fill('جنب شركة الكهرباء');
    await form.locator('textarea').fill('الجرس مش شغال، كلمني قبل ما تطلع');
    await form.locator('.leaflet-container').click({ position: { x: 120, y: 90 } });
    await page.waitForTimeout(400);
    await form.locator('button[type="submit"]').click();
    await page.waitForTimeout(2500);
    const [saved] = await h.q(
      `SELECT building_number, floor_number, apartment_number, landmark, delivery_notes
         FROM addresses WHERE user_id = $1 AND street_name = 'شارع ويب E2E' ORDER BY created_at DESC LIMIT 1`,
      [customer.userId],
    );
    h.record(
      'فورم العنوان على الويب بيسجّل العمارة/الدور/الشقة/العلامة/ملاحظات الوصول',
      saved?.building_number === '15' &&
        saved?.floor_number === '3' &&
        saved?.apartment_number === '7' &&
        saved?.landmark === 'جنب شركة الكهرباء' &&
        saved?.delivery_notes === 'الجرس مش شغال، كلمني قبل ما تطلع',
      JSON.stringify(saved ?? null),
    );

    // ═══ ٣. رقم الدعم في الفوتر ⇒ واتساب ═══
    // الويب بيكاش `/legal-entity` ٥ دقايق (`revalidate: 300` في `lib/legal-content.ts`) — ده
    // التصميم: تعديل الأدمن بيوصل للفوتر خلال ٥ دقايق. فبنقيس السلوك ده بالظبط: نعيد التحميل لحد
    // ما النسخة الجديدة تتولّد (stale-while-revalidate)، بحد أقصى ٦٫٥ دقيقة.
    let supportLink;
    let footerLinks = [];
    const deadline = Date.now() + 390_000;
    while (Date.now() < deadline) {
      await page.goto(`${WEB}/services/${serviceId}`, { waitUntil: 'domcontentloaded' });
      footerLinks = await page.locator('footer a').evaluateAll((links) =>
        links.map((a) => ({ href: a.getAttribute('href'), text: a.textContent?.trim() })),
      );
      supportLink = footerLinks.find((l) => l.text?.includes('201505988990'));
      if (supportLink) break;
      await page.waitForTimeout(20_000);
    }
    h.record(
      'رقم الدعم في الفوتر (من إعدادات الأدمن) بيفتح واتساب مش tel: — خلال مدة كاش الويب',
      supportLink?.href === 'https://wa.me/201505988990',
      JSON.stringify(supportLink ?? footerLinks.slice(0, 3)),
    );
  } finally {
    await browser?.close();
    await h.setSetting('legal.support_phone', previousSupportPhone);
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
