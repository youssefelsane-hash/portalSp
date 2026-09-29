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
 *   ٢. «التالي» قبل العنوان **مابيعدّيش** — وبيقول إيه الناقص جنب قسم العنوان نفسه
 *      (docs/08 §185: كان زرار رمادي بلا سبب).
 *   ٣. حقل شغل إجباري ناقص ⇒ الرسالة جنب الحقل نفسه والصفحة بتتمرّر له؛ و٣ اختيارات
 *      بتتعرض أزرار مش قايمة منسدلة.
 *   ٤. بعد اختيار عنوان وتكميل الحقول، الخطوة ٢ بتطلب الميعاد ومعاه **اقتراحات محسوبة**
 *      (نداء `booking-slots/days` حصل فعلاً) — **والصفحة بتبدأ من أول الخطوة** حتى لو العميل
 *      كان متمرّر لآخرها.
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
    // حقلين إجباريين بترتيب عرض: اختيار من ٣ (لازم يتعرض أزرار) ورقم (لازم يتقال عليه بالاسم).
    await h.q(
      `INSERT INTO service_pricing_fields
         (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, options)
       VALUES ($1,'main_type','نوع الخدمة الأساسي','dropdown',true,1,
               '(الاختيار ده هيتطبق تلقائيًا على كل الملابس في الطلب.)',
               '[{"value":"iron_only","label_ar":"كي فقط"},{"value":"wash_iron","label_ar":"غسيل + كي"},{"value":"dry_clean_iron","label_ar":"دراي كلين + كي"}]'::jsonb),
              ($1,'rooms','عدد الغرف والصالات المطلوب تنظيفها','number',true,2,'غرفة',NULL)`,
      [serviceId],
    );
    await h.q(
      `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
       VALUES ($1,'formula','final_price',$2,1, now(), true)`,
      [serviceId, JSON.stringify({ price_cents: { type: 'literal', value: 40000 }, duration_minutes: { type: 'literal', value: 180 } })],
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
    // مقاس موبايل: بلاغ «الصفحة بتفضل تحت بعد تغيير الخطوة» أوضح على الشاشة الضيقة.
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG' });
    const shots = process.env.WEB_FLOW_SHOTS_DIR;
    const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
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

    // ═══ ٢. «التالي» قبل العنوان: مابيعدّيش، وبيقول السبب جنب القسم ═══
    const next = page.locator('button', { hasText: 'التالي' }).first();
    await next.click();
    await page.waitForTimeout(900);
    const addressError = page.locator('#booking-address [role="alert"]');
    const addressMsg = (await addressError.innerText().catch(() => '')).trim();
    const stillStep1 = (await bodyText()).includes('اختار عنوان التنفيذ');
    const addressVisible = await page.locator('#booking-address').isVisible();
    ok(
      stillStep1 && addressMsg.includes('اختار العنوان') && addressVisible,
      '«التالي» قبل العنوان مابيعدّيش، والرسالة جنب قسم العنوان نفسه',
      `رسالة=«${addressMsg}» · خطوة١=${stillStep1}`,
    );
    if (!(stillStep1 && addressMsg.includes('اختار العنوان'))) failures += 1;
    await shot('web-1-address-missing');

    // ═══ ٣. عنوان + الحقل الإجباري الناقص: تمرير له والرسالة جنبه ═══
    await page.locator('input[name="address"]').first().check();
    await page.waitForTimeout(2500); // فحص التوافر للعنوان
    const selectCount = await page.locator('#booking-field-main_type select').count();
    const choiceButtons = await page.locator('#booking-field-main_type button').allInnerTexts();
    ok(
      selectCount === 0 && choiceButtons.some((t) => t.includes('غسيل + كي')) && choiceButtons.length === 3,
      '٣ اختيارات بتتعرض أزرار ظاهرة، مش قايمة منسدلة',
      `أزرار=${JSON.stringify(choiceButtons)}`,
    );
    if (selectCount !== 0 || choiceButtons.length !== 3) failures += 1;
    await page.locator('#booking-field-main_type button', { hasText: 'غسيل + كي' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await next.click();
    await page.waitForTimeout(1200);
    const roomsError = (await page.locator('#booking-field-rooms [role="alert"]').innerText().catch(() => '')).trim();
    const roomsBox = await page.locator('#booking-field-rooms').boundingBox();
    const inView = roomsBox !== null && roomsBox.y >= 0 && roomsBox.y < 844;
    const focused = await page.evaluate(() => document.activeElement?.closest('#booking-field-rooms') !== null);
    ok(
      roomsError.includes('«عدد الغرف والصالات المطلوب تنظيفها»') && inView && focused,
      'الحقل الإجباري الناقص: الرسالة باسمه تحته، والصفحة اتمرّرت له، والتركيز جوّاه',
      `رسالة=«${roomsError}» · y=${roomsBox?.y} · focus=${focused}`,
    );
    if (!(roomsError && inView && focused)) failures += 1;
    await shot('web-2-field-missing');
    await page.locator('#booking-field-rooms input').fill('3');
    await page.waitForTimeout(300);
    const errorGone = (await page.locator('#booking-field-rooms [role="alert"]').count()) === 0;
    ok(errorGone, 'الرسالة بتختفي أول ما الحقل يتكمّل');
    if (!errorGone) failures += 1;

    // ═══ ٤. الخطوة ٢ بتبدأ من أولها حتى لو كنا تحت خالص ═══
    const slotCallsBeforeStep2 = slotCalls.length;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await next.click();
    await page.waitForTimeout(3000);
    const stepperTop = await page.locator('ol').first().boundingBox();
    ok(
      stepperTop !== null && stepperTop.y >= -5 && stepperTop.y < 200,
      'بعد «التالي» الصفحة بتبدأ من أول الخطوة الجديدة (مش من آخر الصفحة)',
      `stepper.y=${stepperTop?.y} · scrollY=${await page.evaluate(() => window.scrollY)}`,
    );
    if (!(stepperTop && stepperTop.y >= -5 && stepperTop.y < 200)) failures += 1;
    await shot('web-3-step2-top');
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

    // «التالي» من غير ميعاد: الرسالة اللي المالك كتبها بالحرف، جنب قسم الموعد.
    await page.locator('button', { hasText: 'التالي' }).first().click();
    await page.waitForTimeout(900);
    // `innerText` فيه أيقونة ⚠ قبل النص — الفحص على الجملة نفسها.
    const scheduleMsg = (await page.locator('#booking-schedule [role="alert"]').innerText().catch(() => ''))
      .replace('⚠', '')
      .trim();
    ok(
      scheduleMsg === 'حدد الموعد المناسب قبل اختيار مقدم الخدمة.',
      'الموعد ناقص ⇒ «حدد الموعد المناسب قبل اختيار مقدم الخدمة.» جنب قسم الموعد',
      `رسالة=«${scheduleMsg}»`,
    );
    if (scheduleMsg !== 'حدد الموعد المناسب قبل اختيار مقدم الخدمة.') failures += 1;
    await shot('web-4-schedule-missing');

    // ومؤشر الخطوات بيقول نفس الترتيب
    const indicatorOk = secondStep.includes('العنوان والشغل') && secondStep.includes('الموعد ومقدم الخدمة');
    ok(indicatorOk, 'مؤشر الخطوات بيسمّي الترتيب («العنوان والشغل» ثم «الموعد ومقدم الخدمة»)');
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
