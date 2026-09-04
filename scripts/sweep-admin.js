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

const sql = (q) => execFileSync('psql', ['-h','localhost','-U','baytak','-d','baytak_main','-Atc',q],
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
  sql(`UPDATE otp_codes SET code_hash='${OTP_HASH}', attempts_count=0, is_used=false WHERE id=(SELECT id FROM otp_codes WHERE phone_number='${PHONE}' ORDER BY created_at DESC LIMIT 1)`);
  await page.fill('#otp_code', '123456');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SP}/admin-after-otp.png` });
  // خطوة MFA: تسجيل Passkey (المصادق الافتراضي بيوافق تلقائيًا) ثم إقرار حفظ أكواد الاسترجاع
  for (let i = 0; i < 4; i++) {
    if (!page.url().includes('/login')) break;
    if (await page.locator('#ack').count()) {
      await page.check('#ack');
      await page.getByRole('button', { name: /كمّل|الإدارة/ }).click().catch(()=>{});
    } else {
      await page.getByRole('button').first().click().catch(()=>{});
    }
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: `${SP}/admin-after-mfa.png` });
  console.log('URL بعد الدخول:', page.url());
  if (page.url().includes('/login')) { console.log('❌ الدخول فشل — شوف admin-after-mfa.png'); await browser.close(); return; }

  // بدل تخمين الروابط: بنزحف على **كل لينك موجود في قائمة الأدمن فعلاً** — كده أي عنصر
  // قائمة بيودّي لـ404 بيتكشف، وده بلاغ حقيقي مش افتراضي.
  const links = await page.evaluate(() =>
    [...new Set([...document.querySelectorAll('nav a[href^="/"]')].map((a) => a.getAttribute('href')))]);
  console.log(`\nزاحف على ${links.length} لينك من القائمة:`);
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
