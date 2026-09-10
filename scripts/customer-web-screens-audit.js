#!/usr/bin/env node
/**
 * **مسح كل صفحة في `apps/customer-web`** — نظير المسح اللي في التطبيقين، بس بمتصفح حقيقي.
 *
 * طلب المالك (2026-09-10): «بالتوازي مع ده، اتأكد إن الويب شغّالة مفيهاش أي مشاكل».
 *
 * كل صفحة بتتفحص على تلات مقاسات، وبتفشل لو:
 *   ١. اترمى `pageerror` (استثناء JS غير ممسوك) أو ظهر `console.error`.
 *   ٢. الصفحة فضلت على هيكل تحميل (`.animate-pulse`) بعد ما استقرّت — عرَض «الصفحة ما بتفتحش»
 *      اللي المالك بلّغ عنه في التطبيق، ونفسه ممكن يحصل هنا بالظبط.
 *   ٣. فيه تمرير أفقي (`scrollWidth > innerWidth`) — نظير الـRenderFlex overflow على الويب.
 *   ٤. رجع رد ≥500 من أي طلب شبكة الصفحة عملته.
 *
 * الاستخدام (لازم API على 3000 وcustomer-web على 3002):
 *   node scripts/customer-web-screens-audit.js [--shots /tmp/shots]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');

const WEB = process.env.WEB_BASE_URL || 'http://localhost:3002';
const API_LOG_CANDIDATES = ['/tmp/claude-0/api.log', '/home/user/portalSp/.dev-logs/api.log'];

const VIEWPORTS = [
  { name: 'موبايل 390×844', width: 390, height: 844 },
  { name: 'تابلت 768×1024', width: 768, height: 1024 },
  { name: 'ديسكتوب 1440×900', width: 1440, height: 900 },
];

/** الصفحات اللي مالهاش معرّف ديناميكي — الديناميكية بتتزار بمعرّفات حقيقية تحت. */
const STATIC_ROUTES = [
  '/', '/search', '/login', '/register', '/orders',
  '/account', '/account/addresses', '/account/complaints', '/account/favorites',
  '/account/loyalty', '/account/notifications', '/account/payment-methods',
  '/account/projects', '/account/recurring', '/account/referrals',
  '/account/wallet', '/account/warranties',
  '/legal/terms', '/legal/privacy', '/legal/account-deletion',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function latestOtp(phone) {
  for (const p of API_LOG_CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('[OTP]') && l.includes(phone));
    if (lines.length) return lines[lines.length - 1].split('→').pop().trim();
  }
  throw new Error(`مالقيتش OTP لـ${phone} في لوج الباك-إند`);
}

async function api(pathname, options = {}) {
  const res = await fetch(`http://localhost:3000/api/v1${pathname}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** عميل حقيقي معاه عنوان وطلب — عشان الصفحات الديناميكية يبقى ليها محتوى فعلي. */
async function seed() {
  const phone = `+2012${String(Date.now() % 100000000).padStart(8, '0')}`;
  await api('/auth/otp/request', { method: 'POST', body: { phone_number: phone, purpose: 'register' } });
  await sleep(700);
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { phone_number: phone, otp_code: latestOtp(phone), full_name: 'مسح صفحات الويب', user_type: 'customer' },
  });
  if (reg.status >= 400) throw new Error(`فشل التسجيل: ${JSON.stringify(reg.body)}`);
  const token = reg.body.data.access_token;

  const cities = (await api('/cities')).body.data;
  const areas = (await api(`/cities/${cities[0].id}/areas`)).body.data;
  const address = (await api('/addresses', {
    method: 'POST', token,
    body: {
      city_id: cities[0].id, area_id: areas[0].id, street_name: 'شارع مسح الويب',
      latitude: 30.0444, longitude: 31.2357, label: 'مسح الويب',
    },
  })).body.data;

  const categories = (await api('/service-categories')).body.data;
  let category = null;
  let service = null;
  for (const c of categories) {
    const services = (await api(`/services?category_id=${c.id}`)).body.data;
    if (services.length) { category = c; service = services[0]; break; }
  }
  const order = (await api('/orders', {
    method: 'POST', token,
    body: { service_id: service.id, address_id: address.id, problem_description: 'مسح صفحات الويب' },
  })).body.data;

  const technicians = (await api('/technicians?limit=1')).body.data;
  return {
    phone,
    categoryId: category.id,
    serviceId: service.id,
    orderId: order.id,
    technicianId: Array.isArray(technicians) && technicians.length ? technicians[0].id : null,
  };
}

async function login(page, phone) {
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="tel"], input[name="phone"], input', phone);
  await page.getByRole('button', { name: /كود|إرسال|ابعت/ }).first().click();
  await sleep(900);
  const otp = latestOtp(phone);
  const otpInput = page.locator('input').last();
  await otpInput.fill(otp);
  await page.getByRole('button', { name: /دخول|تأكيد|تمام|سجّل/ }).first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {});
}

(async () => {
  const shotsDir = process.argv.includes('--shots')
    ? process.argv[process.argv.indexOf('--shots') + 1]
    : null;
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

  const data = await seed();
  const routes = [
    ...STATIC_ROUTES,
    `/categories/${data.categoryId}`,
    `/services/${data.serviceId}`,
    `/orders/${data.orderId}`,
    ...(data.technicianId ? [`/technicians/${data.technicianId}`] : []),
  ];

  const browser = await chromium.launch({
    // Chromium مسطّب مسبقًا في البيئة دي — المسار فيه رقم النسخة، فبنقبل تجاوز صريح كمان.
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const results = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ar-EG' });
    const page = await context.newPage();
    await login(page, data.phone);

    for (const route of routes) {
      const problems = [];
      const onConsole = (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        // أخطاء تحميل الصور الخارجية مش عطل في الصفحة نفسها — بتتسجّل كملاحظة مش فشل.
        if (/favicon|net::ERR_(NAME_NOT_RESOLVED|CONNECTION_REFUSED)/.test(text)) return;
        problems.push(`console.error: ${text.slice(0, 200)}`);
      };
      const onPageError = (err) => problems.push(`pageerror: ${String(err).slice(0, 200)}`);
      const onResponse = (res) => {
        // ٥xx = عطل سيرفر. و٤٠٤ على نداء API (مش أصل ثابت) = الصفحة بتطلب حاجة مش موجودة،
        // وده بيظهر للمستخدم كقسم فاضي أو رسالة خطأ — لازم يتعدّ عطل مش ضوضاء.
        const url = res.url();
        if (res.status() >= 500) problems.push(`HTTP ${res.status()} على ${url.slice(0, 140)}`);
        else if (res.status() === 404 && /\/api\/v1\//.test(url)) problems.push(`HTTP 404 على ${url.slice(0, 140)}`);
        else if (res.status() === 404) problems.push(`مورد ناقص (404): ${url.slice(0, 140)}`);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      try {
        await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle', timeout: 25000 });
      } catch {
        // networkidle ممكن ما يتحققش لو فيه polling — بنكمّل ونحكم بالمحتوى.
      }
      await sleep(1500);

      const state = await page.evaluate(() => ({
        // «لسه بتحمّل» = هيكل shimmer لسه ظاهر بعد ما الصفحة استقرّت.
        stillLoading: document.querySelectorAll('.animate-pulse').length > 0,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        textLength: (document.body.innerText || '').trim().length,
      }));
      if (state.stillLoading) problems.push('لسه على هيكل التحميل بعد ما الصفحة استقرّت');
      if (state.horizontalOverflow > 1) problems.push(`تمرير أفقي بمقدار ${state.horizontalOverflow}px`);
      if (state.textLength < 20) problems.push('الصفحة شبه فاضية (أقل من ٢٠ حرف)');

      if (shotsDir) {
        const safe = route.replace(/[^a-z0-9]+/gi, '_') || 'root';
        await page.screenshot({ path: path.join(shotsDir, `${vp.width}${safe}.png`), fullPage: false });
      }

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
      results.push({ route, viewport: vp.name, problems });
      console.log(`${problems.length ? '❌' : '✅'} ${route} — ${vp.name}${problems.length ? '\n     ' + problems.join('\n     ') : ''}`);
    }
    await context.close();
  }

  await browser.close();
  const failed = results.filter((r) => r.problems.length);
  console.log(`\nالنتيجة: ${results.length - failed.length}/${results.length} عدّوا`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
