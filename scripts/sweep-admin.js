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
/** رمز دخول حسابات التطوير (ADR-0109) — نفس `DEV_SEED_PIN` في سكربتات الـseed. */
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';

// اسم قاعدة البيانات كان مكتوب بالإيد (`baytak_main`) — الأداة كانت بتفشل من أول استعلام على
// أي جهاز اسم قاعدته مختلف (الجهاز ده اسمها `baytak`). بيتقرا من البيئة دلوقتي.
// اسم القاعدة بيتقرا من نفس المصدر اللي الـAPI بيقلع بيه — التخمين هنا كان بيخلّي
// تسجيل الدخول يفشل بصمت والزحف يكمّل كزائر، والمعرّفات ترجّع 404 مالهاش وجود.
const { resolveApiDatabase } = require('./lib/resolve-api-db');
const DB = resolveApiDatabase();
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
  // **ADR-0109 — خطوة واحدة**: الرقم والرمز مع بعض.
  //
  // اللي اتشال مع الـOTP: تحديث هاش **كل** صفوف `otp_codes` الصالحة (كان لازم بسبب سباق حقيقي
  // — الواجهة ممكن تطلب كود تاني بعد ما نحدّث الهاش فالصف المعدَّل مايكونش اللي السيرفر بيقارن
  // بيه)، والحارس اللي كان بيكتشف إن الأدمن بيكلّم API على قاعدة تانية. الرمز بيتحط على الحساب
  // من `scripts/seed-dev-accounts.js` فمفيش أي تلاعب في القاعدة هنا خلاص.
  await page.fill('#phone_number', PHONE);
  await page.fill('#pin', LOGIN_PIN);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4500);
  await page.screenshot({ path: `${SP}/admin-after-login.png` });
  // خطوة MFA: تسجيل Passkey (المصادق الافتراضي بيوافق تلقائيًا) ثم إقرار حفظ أكواد الاسترجاع.
  //
  // **الضغط بالاسم الصريح مش `.first()`** — النسخة القديمة كانت بتضغط أول زرار في الصفحة أيًا
  // كان، فلو الفلو كان لسه على خطوة الدخول (أو رجعلها) بتدوس «دخول» تاني بدل زرار الـMFA
  // والحلقة تلف على نفسها. الفشل كان بيبان كأنه عيب في التطبيق وهو عيب في الأداة.
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
    // المتصفح بيطبع «Failed to load resource… 404» تلقائيًا لأي fetch فاشل — مش من كود الصفحة،
    // فلو الرد نفسه في قايمة المستثنى فوق، السطر ده ضجيج تابع ليه ولازم يتشال معاه.
    let suppressed4xx = 0;
    // رسايل «إعداد بيئة ناقص» اللي الصفحة بتطبعها **عمدًا** عشان توجّه الأدمن — مش عطل،
    // والزحف على بيئة تطوير بلا مفاتيح خارجية كان بيرصدها كمشكلة كل مرة.
    const EXPECTED_CONSOLE = [/NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN/];
    const onC = (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
      if (suppressed4xx > 0 && /Failed to load resource/i.test(text)) {
        suppressed4xx -= 1;
        return;
      }
      errors.push(text.slice(0, 180));
    };
    const onE = (e) => errors.push('PAGEERROR: ' + String(e).slice(0,180));
    // ردود ≥400 **مقصودة وموثّقة** — عقد حقيقي مش عطل. أي استثناء هنا لازم يكون مكتوب بسببه،
    // وإلا التقرير بيفضل فيه ضجيج ثابت والناس بتتعوّد تتجاهله فتفوت عطل حقيقي.
    const EXPECTED_4XX = [
      {
        // المحافظ بتتعمل **كسول** عند أول حركة مالية (`getOrCreateWallet`)، فعميل/فني لسه مادفعش
        // ولا كسب حاجة مالوش صف محفظة أصلاً. الصفحة بتتعامل مع الـ404 صراحةً وبتعرض «لسه مفيش
        // محفظة» بدل خطأ أحمر — راجع `loadWallet()` في customers/[userId]/page.tsx.
        test: (status, url) => status === 404 && /\/admin\/wallets\/[^/]+$/.test(url),
        why: 'محفظة لسه ما اتعملتش (كسولة) — الصفحة بتعرض حالة فاضية مقصودة',
      },
    ];
    // **401 اللي بعده نجاح لنفس الرابط = دورة تجديد التوكن العادية، مش عطل.**
    // `authedFetch` في لوحة الأدمن بيتعامل مع 401 تلقائيًا: refresh مرة واحدة ثم إعادة نفس
    // الطلب (auth-context.tsx). الزحف كان بيسجّل الـ401 الأولاني كمشكلة، فأي صفحة صادف إن
    // التوكن خلص عندها بتترصد حمرا وهي شغالة تمام — وده بالظبط الضجيج اللي بيخلّي التقرير
    // يتجاهل. بنأجّل الحكم لآخر الصفحة: لو نفس الـURL رجع 2xx بعد كده، الـ401 بيتشال.
    const recovered = new Set();
    const onResp = (r) => {
      const status = r.status();
      const url = r.url();
      if (status < 400) {
        recovered.add(url);
        return;
      }
      if (EXPECTED_4XX.some((e) => e.test(status, url))) {
        suppressed4xx += 1;
        return;
      }
      failed.push({
        line: `${status} ${r.request().method()} ${url.replace('http://localhost:3000','API').replace('http://localhost:3001','')}`.slice(0,110),
        url,
        status,
      });
    };
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
    // 401 اتعافى بعده (refresh + إعادة محاولة ناجحة) مش عطل — وسطر الكونسول التابع له كمان.
    const recoveredAuth = failed.filter((x) => x.status === 401 && recovered.has(x.url)).length;
    const e = [...new Set(errors)].filter((line) => {
      if (recoveredAuth === 0) return true;
      return !/401 \(Unauthorized\)/.test(line);
    });
    const f = [...new Set(failed.filter((x) => !(x.status === 401 && recovered.has(x.url))).map((x) => x.line))];
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
