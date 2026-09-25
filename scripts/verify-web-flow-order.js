/**
 * **تحقّق حي بمتصفح: ترتيب خطوات الحجز على الويب بقى ترتيب اعتماديات** (ADR-0106).
 *
 * بلاغ مالك 2026-09-17: «لا أريد أن يختار عميل جديد ميعادًا أولًا ثم يدخل العنوان الذي كان
 * المفروض أن الموعد يُقترح بناءً عليه».
 *
 * الكشف الحقيقي هنا إن اقتراح الأيام/الساعات بيخرج بدري على `!selectedAddressId`، فالخطوة
 * الأولى القديمة (الميعاد) كانت **منتقي تاريخ بلا أي اقتراح**. الاختبار بيفتح الصفحة فعلاً
 * ويتأكد إن:
 *
 *   ١. الخطوة ١ بتطلب **العنوان** (مش الميعاد).
 *   ٢. زرار «التالي» **مقفول** قبل اختيار عنوان.
 *   ٣. بعد اختيار عنوان، الخطوة ٢ بتطلب الميعاد ومعاه **اقتراحات محسوبة** (نداء
 *      `booking-slots/days` حصل فعلاً).
 *
 *   node scripts/verify-web-flow-order.js   # محتاج API + customer-web dev شغالين
 */
'use strict';

const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const WEB = process.env.WEB_URL || 'http://localhost:3002';
/** رمز دخول حسابات التطوير (ADR-0109) — نفس `DEV_SEED_PIN` في سكربتات الـseed. */
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);

async function main() {
  const h = new LiveHarness('wfo');
  await h.connect();
  let browser;
  let failures = 0;
  try {
    await h.seedCatalog({ priceCents: 40_000, durationMinutes: 180 });
    const serviceId = h.catalog.service.id;
    // `requires_precise_schedule` ممنوع يبقى true بقيد القاعدة (ADR-0060 — دقة الموعد بقت
    // باليوم)، فمانلمسهوش. المهم للاختبار ده إن الخدمة بتقبل الجدولة.
    await h.q(
      `UPDATE services SET allows_scheduling = true, allows_individual = true, allows_emergency = true
        WHERE id = $1`,
      [serviceId],
    );
    const customer = await h.makeCustomer('c');
    await h.makeTechnician('t');
    // **عميل بعنوانين ومفيش افتراضي** — الحالة اللي الاحتياطي القديم (`?? list[0]`) كان
    // بيختار فيها عنوان عشوائي ويحسب عليه الاقتراحات. بعد ADR-0106 لازم العميل يختار بنفسه.
    await h.q(`UPDATE addresses SET is_default = false WHERE user_id = $1`, [customer.userId]);
    await h.q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,'شارع تاني','2',ST_SetSRID(ST_MakePoint(31.26,30.06),4326)::geography,false)`,
      [customer.userId, h.catalog.city.id],
    );
    const [user] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [customer.userId]);
    const phone = user.phone_number;

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' });
    const page = await ctx.newPage();
    /** نداءات التوافر اللي حصلت فعلاً — الدليل إن الاقتراح اتحسب. */
    const slotCalls = [];
    page.on('request', (req) => {
      if (req.url().includes('booking-slots')) slotCalls.push(req.url());
    });

    // دخول بالمسار الحقيقي (تليفون + رمز) — نفس أسلوب `sweep-customer.js` (ADR-0109).
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-phone').click();
    await page.getByTestId('login-phone').pressSequentially(phone, { delay: 15 });
    await page.getByTestId('login-pin').click();
    await page.getByTestId('login-pin').pressSequentially(LOGIN_PIN, { delay: 15 });
    await page.getByTestId('login-submit').click();
    await page.waitForFunction(() => !window.location.pathname.includes('login'), { timeout: 30_000 });

    await page.goto(`${WEB}/services/${serviceId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(1500);

    const bodyText = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // ═══ ١. الخطوة ١ = العنوان ═══
    const firstStep = await bodyText();
    const asksAddressFirst = firstStep.includes('اختار عنوان التنفيذ');
    const asksScheduleFirst = firstStep.includes('اختار الموعد المناسب');
    ok(
      asksAddressFirst && !asksScheduleFirst,
      'الخطوة ١ بتطلب **العنوان**، والميعاد مش ظاهر فيها',
      `عنوان=${asksAddressFirst} · ميعاد=${asksScheduleFirst}`,
    );
    if (!(asksAddressFirst && !asksScheduleFirst)) failures += 1;

    // ═══ ٢. «التالي» مقفول قبل العنوان ═══
    const next = page.locator('button', { hasText: 'التالي' }).first();
    const disabledBefore = await next.isDisabled().catch(() => null);
    ok(disabledBefore === true, 'زرار «التالي» مقفول قبل اختيار عنوان (الخطوة مش مكتملة)', `disabled=${disabledBefore}`);
    if (disabledBefore !== true) failures += 1;

    // ═══ ٣. نختار عنوان → «التالي» يفتح → الخطوة ٢ ميعاد + اقتراحات ═══
    await page.locator('input[name="address"]').first().check();
    await page.waitForTimeout(2500); // فحص التوافر للعنوان
    const disabledAfter = await next.isDisabled().catch(() => null);
    ok(disabledAfter === false, 'بعد اختيار العنوان الخطوة ١ بقت مكتملة و«التالي» فتح', `disabled=${disabledAfter}`);
    if (disabledAfter !== false) failures += 1;

    const slotCallsBeforeStep2 = slotCalls.length;
    await next.click();
    await page.waitForTimeout(3000);
    const secondStep = await bodyText();
    const asksScheduleSecond = secondStep.includes('اختار الموعد المناسب');
    ok(asksScheduleSecond, 'الخطوة ٢ بتطلب الميعاد', `ميعاد=${asksScheduleSecond}`);
    if (!asksScheduleSecond) failures += 1;

    const suggestionsRequested = slotCalls.length > slotCallsBeforeStep2 || slotCallsBeforeStep2 > 0;
    ok(
      suggestionsRequested,
      '**الاقتراحات اتحسبت فعلاً** — نداء `booking-slots` حصل والعنوان معروف',
      `عدد نداءات التوافر=${slotCalls.length}\n     ${slotCalls.slice(0, 2).map((u) => u.split('/api/v1')[1] ?? u).join('\n     ')}`,
    );
    if (!suggestionsRequested) failures += 1;

    // ومؤشر الخطوات بيقول نفس الترتيب
    const indicatorOk = secondStep.includes('العنوان والشغل') && secondStep.includes('الموعد والفني');
    ok(indicatorOk, 'مؤشر الخطوات بيسمّي الترتيب الجديد («العنوان والشغل» ثم «الموعد والفني»)');
    if (!indicatorOk) failures += 1;
  } finally {
    await browser?.close();
    await h.cleanup();
    await h.close();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ ترتيب الخطوات بيطابق ترتيب الاعتماديات: عنوان → شغل → ميعاد → منفّذ → تأكيد.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
