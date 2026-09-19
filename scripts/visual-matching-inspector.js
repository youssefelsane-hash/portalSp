/**
 * **لقطة حقيقية لقسم «مفتّش المطابقة» على كل شكل طلب** (docs/08 §166، بلاغ مالك 2026-09-19).
 *
 * > «التوزيع ده دخلت دلوقتي مش شايفه، مش ظاهر لحد الآن ليه.»
 *
 * `verify-matching-inspector-completeness.js` بيثبت إن **الـAPI** بيرجّع كل الأقسام. ده بيثبت
 * إن **الشاشة** بتعرضها فعلاً — وهو سؤال تاني خالص: القسم كان بيتبني صح في الباك-إند وبيختفي
 * في الواجهة لأن كل محتواه كان جوّه شرط واحد.
 *
 * بيسجّل دخول بالمسار الحقيقي (نفس طريقة `admin-visual.js`)، بيفتح صفحة كل طلب، وبيقرا نص
 * الكارت نفسه من الـDOM — فالفشل بيبان كنص ناقص مش كصورة محتاجة عين تبصّ لها.
 *
 *   node scripts/visual-matching-inspector.js [--out <dir>]
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const bcrypt = require('/home/user/portalSp/node_modules/bcryptjs');
const { chromium } = require('/home/user/portalSp/node_modules/playwright-core');
const { LiveHarness } = require('./lib/live-harness');

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const KNOWN_OTP = '123456';
const args = process.argv.slice(2);
const OUT_DIR = args.indexOf('--out') === -1 ? '/tmp/inspector-shots' : args[args.indexOf('--out') + 1];

/** نفس صلاحيات موظف العمليات في `admin-visual.js` — `operations.view` ضرورية لجدول الجولات. */
const VIEW_PERMISSIONS = ['orders.view', 'technicians.view', 'operations.view', 'customers.view'];

/** العناوين اللي **لازم** تكون في الكارت مهما كان شكل الطلب. */
const REQUIRED_HEADINGS = [
  'مسار التوزيع',
  'مجمّع الفنيين المؤهّلين',
  'العروض المبعوتة للفنيين',
  'فرص تجنيد الفريق',
  'حالة الطاقم',
  'جولات التوزيع',
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = new LiveHarness('vmi');
  await h.connect();
  let browser;
  const results = [];

  try {
    await h.seedCatalog({ priceCents: 45_000, durationMinutes: 180 });
    await h.q(`UPDATE services SET allows_team = true WHERE id = $1`, [h.catalog.service.id]);
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeEmployee(VIEW_PERMISSIONS, 'ops');
    const [adminUser] = await h.q(`SELECT phone_number FROM users WHERE id = $1`, [admin.userId]);

    const makeOrder = async ({ zone = true, bookingMode = 'individual', technician = null, status = 'searching_technician' }) => {
      const [o] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied,
           required_technicians, required_assistants, placed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '7 days', 180, $8, 45000,'cash',20.00,$9,$10, now())
         RETURNING id`,
        [
          customer.profileId, h.catalog.service.id, customer.addressId,
          zone ? h.catalog.zone.id : null,
          `VMI-${h.nextTag()}`, status, bookingMode, technician,
          bookingMode === 'team' ? 2 : 1,
          bookingMode === 'team' ? 1 : 0,
        ],
      );
      return o.id;
    };

    const cases = [
      { name: 'no-zone', label: 'طلب بلا نطاق خدمة (كان بيوقّع القسم كله)', id: await makeOrder({ zone: false }) },
      { name: 'individual', label: 'طلب فردي لسه ما اتوزّعش', id: await makeOrder({}) },
      { name: 'direct-assign', label: 'طلب راح للفني على طول', id: await makeOrder({ technician: tech.id, status: 'accepted' }) },
      { name: 'team', label: 'طلب فريق', id: await makeOrder({ bookingMode: 'team' }) },
    ];

    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' });
    const page = await context.newPage();

    // نفس مسار الدخول الحقيقي بالحرف: `pressSequentially` مش `fill` (الحقل مربوط بـuseState).
    await page.goto(`${ADMIN_URL}/login`, { waitUntil: 'networkidle' });
    await page.locator('#phone_number').click();
    await page.locator('#phone_number').pressSequentially(adminUser.phone_number, { delay: 15 });
    await page.locator('button[type=submit]').first().click();
    await page.waitForSelector('#otp_code', { timeout: 30_000 });
    // الكود متهشّر في القاعدة، فبنحطّ مكانه هاش كود معروف (المفتاح `phone_number` مش `user_id`).
    await h.q(`UPDATE otp_codes SET code_hash = $2, attempts_count = 0, is_used = false WHERE phone_number = $1`, [
      adminUser.phone_number,
      bcrypt.hashSync(KNOWN_OTP, 10),
    ]);
    await page.locator('#otp_code').click();
    await page.locator('#otp_code').pressSequentially(KNOWN_OTP, { delay: 15 });
    await page.locator('button[type=submit]').first().click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 });

    for (const c of cases) {
      await page.goto(`${ADMIN_URL}/orders/${c.id}`, { waitUntil: 'networkidle' });
      /*
        بنقرا من **نص الصفحة كله** مش من locator للكارت عن قصد: أي locator بيربط الاختبار
        بشكل الـDOM (class أو ترتيب)، فلو الكارت اتلفّ في عنصر تاني الاختبار يفشل والقسم
        ظاهر — إنذار كاذب. السؤال هنا «الأدمن شايف السطر ده؟» ونص الصفحة هو الجواب المباشر.
      */
      await page
        .waitForFunction(
          (headings) => {
            const t = document.body.innerText;
            return !t.includes('جاري التحميل...') && headings.every((hd) => t.includes(hd));
          },
          REQUIRED_HEADINGS,
          { timeout: 25_000 },
        )
        .catch(() => {});
      const text = await page.evaluate(() => document.body.innerText);
      const missing = REQUIRED_HEADINGS.filter((hd) => !text.includes(hd));
      // الكارت في آخر الصفحة عن قصد، فاللقطة لازم تتمرّر له — وإلا الصورة بتبقى لأول الصفحة
      // وتقول «مش موجود» وهو موجود.
      await page
        .locator('text=مفتّش المطابقة')
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {});
      await page.screenshot({ path: path.join(OUT_DIR, `inspector-${c.name}.png`), fullPage: false }).catch(() => {});
      // بنطبع الجزء اللي بيهمّنا بس — نص الصفحة كامل مش تقرير.
      const start = text.indexOf('مفتّش المطابقة');
      const excerpt = start === -1 ? '(الكارت مش موجود في الصفحة خالص)' : text.slice(start, start + 1200);
      results.push({ ...c, missing, text: excerpt });
    }

    await h.deleteOrders(`order_number LIKE $1`, ['VMI-%']);
  } finally {
    if (browser) await browser.close();
    await h.cleanup();
    await h.close();
  }

  console.log('\n— قسم «مفتّش المطابقة» كما يراه الأدمن على الشاشة —\n');
  let allOk = true;
  for (const r of results) {
    const ok = r.missing.length === 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${r.label}`);
    if (!ok) console.log(`     ناقص من الشاشة: ${r.missing.join(' · ')}`);
    console.log(
      r.text
        .split('\n')
        .filter(Boolean)
        .map((l) => `     ${l}`)
        .join('\n'),
    );
    console.log('');
  }
  console.log(`اللقطات في ${OUT_DIR}`);
  console.log(allOk ? '✅ كل قسم ظاهر على الشاشة في كل الحالات.' : '❌ فيه قسم مش ظاهر على الشاشة.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
