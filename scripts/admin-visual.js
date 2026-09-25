/**
 * **لقطات حقيقية من لوحة الأدمن** — عشان بلاغات المالك البصرية تتشاف مش تتخمّن.
 *
 * بلاغ المالك (2026-09-17): «الأدمين لما يبقى شايف، يبقى شايف الحاجة منظمة… ما يبقاش شايف
 * كلام كله كده، كلام مش معروف الكلام ده يعني متلخبط على بعضه».
 *
 * `npm run build`/`typecheck` بيقولوا إن الصفحة **بتتجمّع**، مش إنها **مقروءة**. السكربت ده
 * بيزرع بيانات واقعية، بيسجّل دخول بالمسار الحقيقي (تليفون + OTP)، وبياخد لقطات للصفحات على
 * مقاسين — فأي تكدّس أو نص متلخبط بيبان.
 *
 * ### إزاي بيسجّل دخول
 *
 * التوكن في الأدمن في الذاكرة بس (والتحديث في كوكي httpOnly)، فمفيش حقن في `localStorage`.
 * فالسكربت بيمشي على المسار الحقيقي: بيكتب الرقم ورمز الدخول في نفس الشاشة اللي الأدمن بيشوفها
 * (ADR-0109). قبل التبديل كان لازم يطلب OTP و**يستبدل الهاش في القاعدة** بهاش كود معروف — خطوة
 * اتشالت بالكامل، والرمز بيتحط على الحساب من `scripts/seed-dev-accounts.js`.
 *
 *   node scripts/admin-visual.js [--out <dir>] [--keep]
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
/**
 * رمز دخول حسابات التطوير (ADR-0109) — نفس `DEV_SEED_PIN` في `scripts/seed-dev-accounts.js`.
 * مش سر: حساب وهمي في قاعدة محلية.
 */
const LOGIN_PIN = process.env.DEV_SEED_PIN || '417253';
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const OUT_DIR = argValue('--out', '/tmp/admin-shots');
/** `--only <a,b>` بيقصر اللقطات على صفحات بالاسم — للتحقق السريع بعد إصلاح صفحة واحدة. */
const ONLY = (argValue('--only', '') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
/** `--viewport <name>` بيقصر على مقاس واحد. */
const ONLY_VIEWPORT = argValue('--viewport', '');
const KEEP_DATA = args.includes('--keep');

/**
 * سماحية العرض: الجدول عنده `overflow-x-auto` فالسحب الأفقي مش كسر في ذاته، بس أي تجاوز
 * كبير معناه إن عمود حقيقي (الإجمالي مثلاً) بره الشاشة من غير ما الأدمن يعرف. اللي فوق كده
 * بيتعلّم عليه في التقرير.
 */
const OVERFLOW_TOLERANCE_PX = 24;

/** المقاسات اللي الأدمن بيشتغل عليها فعلاً — اللابتوب الضيّق هو اللي بيكشف التكدّس. */
/** صلاحيات عرض بس — بتعدّي بوابة MFA (ADR-0011) وبتفتح الصفحات اللي بناخد لقطاتها. */
const VIEW_PERMISSIONS = [
  'orders.view', 'technicians.view', 'catalog.view', 'customers.view', 'payments.view',
  'analytics.view', 'operations.view', 'geo.view', 'employees.view', 'audit.view',
  'complaints.view', 'settings.view', 'reports.view', 'promotions.view', 'roles.view',
  // ADR-0114 + شاشة CAC: من غيرهم الصفحتين الجديدتين بيترسموا كـ«ماعندكش صلاحية» — يعني
  // اللقطة بتثبت الحارس وماتقولش حاجة عن الشاشة نفسها.
  'marketing.manage', 'analytics.financial.view', 'analytics.marketing_spend.manage',
  'payment_policies.manage',
];

const VIEWPORTS = [
  { name: 'laptop-1280', width: 1280, height: 900 },
  { name: 'wide-1680', width: 1680, height: 1050 },
];

async function seed(h) {
  await h.seedCatalog({ priceCents: 45_000, durationMinutes: 180 });
  await h.q(`UPDATE services SET allows_team = true, allows_emergency = true WHERE id = $1`, [h.catalog.service.id]);
  const customer = await h.makeCustomer('c');
  const tech = await h.makeTechnician('t');
  // **موظف عمليات بصلاحيات عرض** مش super_admin: ADR-0011 بيفرض Passkey على أي حساب عنده
  // صلاحية حساسة (تحويل فلوس/إعدادات)، وده مايتعملش في متصفح مؤتمت. والعرض ده أصدق كمان —
  // ده اللي موظف العمليات بيشوفه فعلاً.
  const admin = await h.makeEmployee(VIEW_PERMISSIONS, 'ops');

  /** طلبات بحالات ومواعيد متنوّعة — الصفحة الفاضية مابتكشفش أي مشكلة تنظيم. */
  const scenarios = [
    { status: 'searching_technician', days: -2, tech: null, label: 'متأخر وغير معيّن' },
    { status: 'searching_technician', days: 0, tech: null, label: 'اليوم وغير معيّن' },
    { status: 'accepted', days: 0, tech: true, label: 'اليوم ومعيّن' },
    { status: 'technician_on_way', days: 0, tech: true, label: 'في الطريق' },
    { status: 'in_progress', days: 0, tech: true, label: 'تحت التنفيذ' },
    { status: 'accepted', days: 1, tech: true, label: 'بكرة' },
    { status: 'accepted', days: 2, tech: true, label: 'بعد بكرة' },
    { status: 'awaiting_payment', days: -1, tech: true, label: 'مستني دفع' },
    { status: 'disputed', days: -3, tech: true, label: 'نزاع' },
    { status: 'completed', days: -30, tech: true, label: 'مكتمل قديم' },
    { status: 'completed', days: -200, tech: true, label: 'مكتمل أقدم' },
    { status: 'cancelled_by_customer', days: -10, tech: null, label: 'ملغي' },
  ];

  const orderIds = [];
  for (const s of scenarios) {
    const at = new Date(Date.now() + s.days * 86_400_000);
    at.setUTCHours(9, 0, 0, 0);
    const [o] = await h.q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, estimated_duration_days,
         technician_id, required_technicians, required_assistants,
         work_started_at, work_completed_at, placed_at,
         total_amount_cents, payment_method, commission_rate_applied, problem_description)
       VALUES ($1,$2,$3,$4,$5,$6,'individual',$7,180,NULL,$8,2,1,$9,$10,$11,45000,'cash',20.00,$12)
       RETURNING id`,
      [
        customer.profileId, h.catalog.service.id, customer.addressId, h.catalog.zone.id,
        `VIS-${h.nextTag()}`, s.status, at.toISOString(),
        s.tech ? tech.id : null,
        s.status === 'completed' || s.status === 'in_progress' ? at.toISOString() : null,
        s.status === 'completed' ? new Date(at.getTime() + 200 * 60_000).toISOString() : null,
        at.toISOString(),
        `${s.label} — وصف مشكلة واقعي بطول معقول عشان نشوف الكلام في الجدول بيتقصّ ولا بيتكدّس`,
      ],
    );
    orderIds.push(o.id);
  }
  return {
    customer,
    tech,
    admin,
    orderIds,
    technicianId: tech.id,
    customerUserId: customer.userId,
    serviceId: h.catalog.service.id,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = new LiveHarness('vis');
  await h.connect();
  let browser;
  const shots = [];
  /** قياس عرض كل صفحة — التقرير تحت بيلخّصه. */
  const overflows = [];

  try {
    const { admin, orderIds, technicianId, customerUserId, serviceId } = await seed(h);
    const [adminUser] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [admin.userId]);
    const phone = adminUser.phone_number;

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

    const pages = [
      { name: 'orders-current', url: '/orders' },
      { name: 'orders-overdue', url: '/orders?bucket=overdue' },
      { name: 'orders-completed', url: '/orders?scope=completed' },
      { name: 'orders-calendar', url: '/orders?view=calendar&scope=all' },
      { name: 'order-detail', url: `/orders/${orderIds[4]}` },
      { name: 'dashboard', url: '/' },
      { name: 'technicians', url: '/technicians' },
      { name: 'catalog', url: '/catalog' },
      { name: 'settings', url: '/settings' },
      { name: 'customers', url: '/customers' },
      { name: 'operations', url: '/operations' },
      { name: 'audit-log', url: '/audit-log' },
      { name: 'geo', url: '/geo' },
      { name: 'employees', url: '/employees' },
      { name: 'review-center', url: '/review-center' },
      { name: 'risk-center', url: '/risk-center' },
      { name: 'security', url: '/security' },
      { name: 'earnings-policy', url: '/earnings-policy' },
      { name: 'projects', url: '/projects' },
      { name: 'technician-detail', url: `/technicians/${technicianId}` },
      { name: 'customer-detail', url: `/customers/${customerUserId}` },
      { name: 'service-detail', url: `/catalog/services/${serviceId}` },
      // باقي مسارات اللوحة الثابتة — الغرض تغطية كاملة مش عيّنة.
      { name: 'academy', url: '/academy' },
      { name: 'analytics', url: '/analytics' },
      { name: 'analytics-funnel', url: '/analytics/funnel' },
      { name: 'analytics-money', url: '/analytics/money' },
      { name: 'analytics-workforce', url: '/analytics/workforce' },
      { name: 'analytics-marketing', url: '/analytics/marketing' },
      { name: 'ops', url: '/ops' },
      { name: 'payment-policies', url: '/payment-policies' },
      { name: 'branding', url: '/branding' },
      { name: 'buildings', url: '/buildings' },
      { name: 'campaigns', url: '/campaigns' },
      { name: 'cancellation-reasons', url: '/cancellation-reasons' },
      { name: 'employees-workforce', url: '/employees/workforce' },
      { name: 'feature-flags', url: '/feature-flags' },
      { name: 'homepage-content', url: '/homepage-content' },
      { name: 'installments', url: '/installments' },
      { name: 'instapay-confirmations', url: '/instapay-confirmations' },
      { name: 'internal-chat', url: '/internal-chat' },
      { name: 'marketing', url: '/marketing' },
      { name: 'notification-routing', url: '/notification-routing' },
      { name: 'notification-type-configs', url: '/notification-type-configs' },
      { name: 'notifications', url: '/notifications' },
      { name: 'operations-live-map', url: '/operations/live-map' },
      { name: 'payouts', url: '/payouts' },
      { name: 'pricing', url: '/pricing' },
      { name: 'promotions', url: '/promotions' },
      { name: 'recurring-orders', url: '/recurring-orders' },
      { name: 'refunds', url: '/refunds' },
      { name: 'reports', url: '/reports' },
      { name: 'roles', url: '/roles' },
      { name: 'security-center', url: '/security-center' },
      { name: 'support', url: '/support' },
      { name: 'support-chat', url: '/support-chat' },
      { name: 'support-tickets', url: '/support-tickets' },
      { name: 'technician-companies', url: '/technician-companies' },
      { name: 'technician-kpi', url: '/technician-kpi' },
      { name: 'technician-levels', url: '/technician-levels' },
      { name: 'technician-progression', url: '/technician-progression' },
      { name: 'technician-referrals', url: '/technician-referrals' },
      { name: 'technicians-category-declarations', url: '/technicians/category-declarations' },
      { name: 'warranty-claims', url: '/warranty-claims' },
      { name: 'warranty-plans', url: '/warranty-plans' },
      { name: 'assessment-queue', url: '/assessment-queue' },
      { name: 'order-create-for-customer', url: '/orders/create-for-customer' },
      { name: 'employee-new', url: '/employees/new' },
    ];

    const targetPages = ONLY.length > 0 ? pages.filter((p) => ONLY.includes(p.name)) : pages;
    const targetViewports = ONLY_VIEWPORT ? VIEWPORTS.filter((v) => v.name === ONLY_VIEWPORT) : VIEWPORTS;

    for (const vp of targetViewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        locale: 'ar-EG',
      });
      const page = await context.newPage();
      // أي خطأ console بيتسجّل — صفحة «شكلها ماشي» وفيها استثناء مش صفحة سليمة.
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
      });

      // **ADR-0109 — خطوة واحدة**: الرقم والرمز مع بعض. قبل كده كان لازم يطلب OTP، يستنى خانة
      // الكود تظهر، يستبدل الهاش في `otp_codes` بهاش كود معروف، وبعدين يكتبه. الرمز بيتحط على
      // الحساب من الـseed فمفيش أي تلاعب في القاعدة هنا خلاص.
      //
      // **`pressSequentially` مش `fill`**: الحقول مربوطة بـ`useState` في React، و`fill` بيحط
      // القيمة ويدوس فورًا قبل ما الـstate تتحدّث — فالطلب كان بيتبعت برقم ناقص ويرجع 400.
      // اتلقط فعليًا أول تشغيل.
      await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
      await page.locator('#phone_number').click();
      await page.locator('#phone_number').pressSequentially(phone, { delay: 15 });
      await page.locator('#pin').click();
      await page.locator('#pin').pressSequentially(LOGIN_PIN, { delay: 15 });
      await page.locator('button[type=submit]').first().click();
      await page.waitForFunction(() => !window.location.pathname.startsWith('/login'), { timeout: 30_000 });

      for (const target of targetPages) {
        await page.goto(`${ADMIN_URL}${target.url}`, { waitUntil: 'domcontentloaded' });
        // الصفحات بتجيب بياناتها بعد الرندر — بننتظر سكون الشبكة بدل انتظار عنصر بعينه.
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(1200);
        const file = path.join(OUT_DIR, `${target.name}--${vp.name}.png`);
        // **لقطة الشاشة المرئية مش `fullPage`**: هيكل اللوحة `h-screen overflow-hidden`
        // والتمرير جوّه العمود، فـ`fullPage: true` بيرندر المستند كله ويطلّع "نزيف" أفقي
        // **مش موجود فعلاً** على الشاشة (اتأكدنا بالقياس تحت: `documentElement.scrollWidth`
        // بيساوي `clientWidth` بالظبط). اللقطة المرئية هي اللي الأدمن بيشوفها.
        await page.screenshot({ path: file });
        shots.push(file);

        // القياس بيحوّل «الواجهة مش منظمة» لرقم: أي جدول أعرض من حاويته معناه إن الأدمن
        // لازم يسحب أفقيًا عشان يشوف آخر عمود — وده اللي حصل فعلاً في /orders و/catalog.
        const metrics = await page.evaluate(() => {
          const doc = document.documentElement;
          const widest = [...document.querySelectorAll('[data-slot="table-container"]')]
            .map((el) => ({ box: el.clientWidth, content: el.scrollWidth }))
            .sort((a, b) => b.content - b.box - (a.content - a.box))[0];
          return {
            pageOverflow: doc.scrollWidth - doc.clientWidth,
            tableBox: widest?.box ?? 0,
            tableContent: widest?.content ?? 0,
          };
        });
        const tableOverflow = metrics.tableContent - metrics.tableBox;
        overflows.push({ page: target.name, viewport: vp.name, ...metrics, tableOverflow });
        const flag = metrics.pageOverflow > 0 || tableOverflow > OVERFLOW_TOLERANCE_PX ? '⚠️ ' : '';
        console.log(
          `📸 ${flag}${target.name} @ ${vp.name}` +
            (tableOverflow > 0 ? ` — أوسع جدول ${metrics.tableContent}px جوّه ${metrics.tableBox}px` : ''),
        );
      }

      if (consoleErrors.length > 0) {
        console.log(`\n⚠️  أخطاء console على ${vp.name}:`);
        for (const e of [...new Set(consoleErrors)].slice(0, 10)) console.log(`   - ${e}`);
      }
      await context.close();
    }

    if (KEEP_DATA) {
      console.log(`\nℹ️  البيانات متسيبة (--keep). تليفون الأدمن: ${phone} / رمز الدخول: ${LOGIN_PIN}`);
    }
  } finally {
    await browser?.close();
    if (!KEEP_DATA) {
      await h.deleteOrders(`order_number LIKE $1`, ['VIS-%']);
      await h.cleanup();
    }
    await h.close();
  }

  console.log(`\n✅ ${shots.length} لقطة في ${OUT_DIR}`);

  const pageBleed = overflows.filter((m) => m.pageOverflow > 0);
  const tight = overflows.filter((m) => m.tableOverflow > OVERFLOW_TOLERANCE_PX);
  if (pageBleed.length === 0) {
    console.log('✅ مفيش صفحة بتتجاوز عرض الشاشة (المستند ما بيسحبش أفقيًا في أي مقاس).');
  } else {
    console.log('❌ صفحات بتتجاوز عرض الشاشة نفسها:');
    for (const m of pageBleed) console.log(`   - ${m.page} @ ${m.viewport}: +${m.pageOverflow}px`);
  }
  if (tight.length === 0) {
    console.log('✅ كل الجداول جوّه حاوياتها (مفيش عمود مخفي محتاج سحب أفقي).');
  } else {
    console.log(`⚠️  جداول محتاجة سحب أفقي (أكتر من ${OVERFLOW_TOLERANCE_PX}px):`);
    for (const m of tight) console.log(`   - ${m.page} @ ${m.viewport}: ${m.tableContent}px جوّه ${m.tableBox}px (+${m.tableOverflow})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
