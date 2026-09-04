#!/usr/bin/env node
/**
 * زحف بصري/وظيفي على **كل لينك في قائمة الأدمن** — الأداة اللي بتمسك بلاغات المالك قبل
 * ما توصله (docs/08 §133).
 *
 * بتعمل دخول أدمن حقيقي (OTP + Passkey بمصادق افتراضي عبر CDP) وبعدين بتزور كل صفحة و:
 *   • تسجّل أي خطأ كونسول أو استثناء صفحة
 *   • تسجّل أي طلب شبكة رجع ‏≥400 (ده اللي مسك بَقّة `warranty-plans`: كانت بتنادي الـAPI
 *     قبل ما التوكن يجهز، بـdeps فاضية فمافيش إعادة محاولة — الصفحة تفضل فاضية للأبد)
 *   • تكشف التجاوز الأفقي (بلاغ متكرر)
 *   • تكشف الصفحة «شبه الفاضية»
 *   • تاخد لقطة لكل صفحة تحت `--out`
 *
 * الاستخدام (لازم API + admin dev شغالين):
 *   ADMIN_PHONE=+201555000999 node scripts/sweep-admin.js
 *
 * الحساب لازم يكون `user_type='admin'` وله دور. الـPasskey المتسجّل بيتمسح في أول كل تشغيلة
 * لأن المصادق الافتراضي بيتولد جديد — يعني الفلو بيعدّي على التسجيل من أوله في كل مرة.
 */
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const SP = process.env.SWEEP_OUT || '/tmp/baytak-sweep';
require('fs').mkdirSync(SP, { recursive: true });
const PHONE = process.env.ADMIN_PHONE || '+201555000999';
const OTP_HASH = '$2a$10$PoWE4iYX5toQG0ZL6pQo8eiCMWo4jIRewyXxmehAefIs/uKGwvPJ2'; // = 123456

// اسم قاعدة البيانات كان مكتوب بالإيد (`baytak_main`) — الأداة كانت بتفشل من أول استعلام على
// أي جهاز اسم قاعدته مختلف (الجهاز ده اسمها `baytak`). بيتقرا من البيئة دلوقتي.
const DB = process.env.PGDATABASE || (process.env.DATABASE_URL || '').split('/').pop() || 'baytak';
const sql = (q) => execFileSync('psql', ['-h','localhost','-U','baytak','-d',DB,'-Atc',q],
  { env: { ...process.env, PGPASSWORD: 'baytak' }, encoding: 'utf8' }).trim();


(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'ar-EG' });
  const cdp = await ctx.newCDPSession(await ctx.newPage());
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const page = ctx.pages()[0];

  // المصادق الافتراضي بيتولد جديد كل تشغيلة، فأي Passkey متسجّل من تشغيلة سابقة مش معانا —
  // بنمسحه عشان الفلو يعدّي على التسجيل من أوله في كل مرة.
  sql(`DELETE FROM webauthn_credentials WHERE user_id IN (SELECT id FROM users WHERE phone_number='${PHONE}')`);
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle', timeout: 45000 });
  await page.fill('#phone_number', PHONE);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#otp_code', { timeout: 20000 });
  // **كل** الصفوف الصالحة للرقم ده، مش الأحدث بس. السبب سباق حقيقي اتلقط: الواجهة ممكن
  // تطلب OTP تاني (إعادة إرسال/إعادة رندر) **بعد** ما نحدّث الهاش، فالصف اللي عدّلناه يبقى
  // مش اللي السيرفر بيتحقق منه — والدخول بيفشل بشكل متقطّع بلا سبب ظاهر. تحديث كل الصفوف
  // الصالحة بيخلّي النتيجة واحدة مهما كان الصف اللي هيتقارن بيه.
  sql(`UPDATE otp_codes SET code_hash='${OTP_HASH}', attempts_count=0, is_used=false WHERE phone_number='${PHONE}' AND expires_at > now()`);
  // حارس صريح: لو مفيش صف OTP صالح بعد ما شاشة الكود ظهرت، يبقى الواجهة بتكلّم **API تاني**
  // غير اللي إحنا بنعدّل قاعدته (شائع لما تفضل عمليات dev قديمة ماسكة بورت 3000). الرسالة دي
  // بتوفّر نص ساعة تشخيص: الفشل بيبان كأنه «كود غلط» وهو أصلاً «إحنا بنعدّل قاعدة تانية».
  const otpRows = Number(sql(`SELECT count(*) FROM otp_codes WHERE phone_number='${PHONE}' AND expires_at > now()`));
  if (otpRows === 0) {
    console.log('❌ مفيش صف OTP صالح في قاعدة البيانات دي رغم إن شاشة الكود ظهرت.');
    console.log('   يعني الأدمن بيكلّم API تاني (بورت 3000 ماسكه process قديم؟) أو قاعدة تانية.');
    console.log('   اتأكد: DATABASE_URL بتاع الـAPI الشغّال فعلاً = القاعدة اللي السكربت بيعدّلها.');
    await browser.close();
    return;
  }
  await page.fill('#otp_code', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SP}/admin-after-otp.png` });
  // خطوة MFA: تسجيل Passkey (المصادق الافتراضي بيوافق تلقائيًا) ثم إقرار حفظ أكواد الاسترجاع.
  //
  // **الضغط بالاسم الصريح مش `.first()`** — النسخة القديمة كانت بتضغط أول زرار في الصفحة أيًا
  // كان. لو الفلو كان لسه على خطوة الـOTP (أو رجعلها)، أول زرار هو «دخول» — فالحلقة كانت
  // بتعيد طلب OTP جديد كل دورة (٣ أكواد لتسجيل دخول واحد)، والهاش اللي حطيناه يبقى على صف
  // قديم، والدخول يفشل بسبب **الأداة نفسها** مش بسبب التطبيق. اتلقطت لما عدّ صفوف `otp_codes`
  // طلع ٣ لتشغيلة واحدة.
  for (let i = 0; i < 4; i++) {
    if (!page.url().includes('/login')) break;

    // إقرار أكواد الاسترجاع (بيظهر بعد تسجيل الـPasskey بنجاح)
    if (await page.locator('#ack').count()) {
      await page.check('#ack');
      await page.getByRole('button', { name: /كمّل|الإدارة/ }).click().catch(() => {});
      await page.waitForTimeout(4000);
      continue;
    }

    // زرار الـMFA نفسه — بالاسم اللي الصفحة بتعرضه فعلاً في الحالتين (تسجيل/تأكيد)
    const mfaButton = page.getByRole('button', { name: /سجّل Passkey دلوقتي|تأكيد بـ ?Passkey/ });
    if (await mfaButton.count()) {
      await mfaButton.first().click().catch(() => {});
      await page.waitForTimeout(4000);
      continue;
    }

    // مفيش زرار MFA ولا إقرار ⇒ إحنا مش في خطوة MFA أصلاً (غالبًا الـOTP فشل). نوقف بدل ما
    // نضغط عشوائي ونطلب OTP جديد — الفشل هنا لازم يبان زي ما هو مش يتحوّل لسبب تاني مضلّل.
    console.log('⚠️ مش في خطوة MFA — الفلو واقف عند:', await page.locator('h1, [class*="CardTitle"]').first().textContent().catch(() => '?'));
    break;
  }
  await page.screenshot({ path: `${SP}/admin-after-mfa.png` });
  console.log('URL بعد الدخول:', page.url());
  if (page.url().includes('/login')) { console.log('❌ الدخول فشل — شوف admin-after-mfa.png'); await browser.close(); return; }

  // بدل تخمين الروابط: بنزحف على **كل لينك موجود في قائمة الأدمن فعلاً** — كده أي عنصر
  // قائمة بيودّي لـ404 بيتكشف، وده بلاغ حقيقي مش افتراضي.
  const navLinks = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('nav a[href^="/"]')].map((a) => a.getAttribute('href')))]);

  // **صفحات التفاصيل مكانتش بتتزار خالص** — الزحف كان على عناصر القائمة بس، وعناصر القائمة
  // كلها قوايم. صفحات التفاصيل (طلب، فني، خدمة، عميل، موظف، تذكرة) هي أغنى الصفحات وأكترها
  // عرضة للبَقّات، وهي اللي بلاغات المالك بتيجي منها. بنجيب **معرّفات حقيقية** من قاعدة
  // البيانات بدل UUIDs مخترعة (اللي كانت هتدّي 404 مالهاش معنى).
  const first = (q) => (sql(q).split('\n')[0] || '').trim();
  const detail = [
    ['/orders', `SELECT id FROM orders WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`],
    ['/technicians', `SELECT id FROM technician_profiles WHERE deleted_at IS NULL LIMIT 1`],
    // KPI: لازم فني **عنده سنابشوت** فعلاً — الصفحة بتقرا السنابشوت مش الفني.
    ['/technician-kpi', `SELECT technician_id FROM technician_kpi_snapshots LIMIT 1`],
    ['/catalog/services', `SELECT id FROM services WHERE deleted_at IS NULL LIMIT 1`],
    // المعرّفات لازم تتجاب **بنفس الـjoin اللي القايمة بتلينك بيه**، مش بأول صف في `users`:
    // صفحة العملاء بتلينك بـ`customer.user_id` الجاي من `customer_profiles`، فمستخدم بلا
    // بروفايل بيدّي 404 صحيح — بَقّة في الأداة مش في المنتج.
    ['/customers', `SELECT u.id FROM users u JOIN customer_profiles cp ON cp.user_id=u.id
                    WHERE u.deleted_at IS NULL AND cp.deleted_at IS NULL LIMIT 1`],
    // الموظفين: القايمة مبنية على `employee_profiles` (inner join)، فالتفاصيل بتطلب بروفايل
    // موجود. مستخدم أدمن بلا بروفايل بيدّي 404 صحيح ومستحيل يظهر في القايمة أصلاً.
    ['/employees', `SELECT user_id FROM employee_profiles LIMIT 1`],
    ['/roles', `SELECT id FROM roles LIMIT 1`],
    ['/technician-companies', `SELECT id FROM technician_companies WHERE deleted_at IS NULL LIMIT 1`],
    ['/support-tickets', `SELECT id FROM support_tickets LIMIT 1`],
  ]
    .map(([base, q]) => { try { const id = first(q); return id ? `${base}/${id}` : null; } catch { return null; } })
    .filter(Boolean);

  const links = [...navLinks, ...detail];
  console.log(`\nزاحف على ${navLinks.length} لينك من القائمة + ${detail.length} صفحة تفاصيل بمعرّفات حقيقية:`);
  const problems = [];
  for (const path of links) {
    const errors = [], failed = [];
    const onC = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0,180)); };
    const onE = (e) => errors.push('PAGEERROR: ' + String(e).slice(0,180));
    const onResp = (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url().replace('http://localhost:3000','API').replace('http://localhost:3001','')}`.slice(0,110)); };
    page.on('console', onC); page.on('pageerror', onE); page.on('response', onResp);
    let status = 'ok';
    try {
      const resp = await page.goto('http://localhost:3001' + path, { waitUntil: 'networkidle', timeout: 40000 });
      status = String(resp?.status() ?? '?');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SP}/adm${path.replace(/\//g,'_')}.png` });
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)) errors.push('⚠️ تجاوز أفقي');
      const len = await page.evaluate(() => (document.body.innerText||'').trim().length);
      if (len < 60) errors.push(`⚠️ شبه فاضية (${len} حرف)`);
    } catch (e) { status = 'FAIL ' + String(e).slice(0,110); }
    page.off('console', onC); page.off('pageerror', onE); page.off('response', onResp);
    const e = [...new Set(errors)], f = [...new Set(failed)];
    if (status !== '200' || e.length || f.length) {
      problems.push(path);
      console.log(`\n── ${path} [${status}]`);
      e.slice(0,4).forEach(x=>console.log('   ❌ '+x));
      f.slice(0,4).forEach(x=>console.log('   🌐 '+x));
    }
  }
  console.log(`\n═══ ${links.length - problems.length}/${links.length} صفحة نضيفة تمامًا ═══`);
  if (problems.length) console.log('فيها ملاحظات: ' + problems.join(', '));
  await browser.close();
})();
