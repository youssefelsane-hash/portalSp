/**
 * مصفوفة E2E حقيقية بمتصفح لمركز العمليات كله (docs/08 §36.2-14 + §117).
 *
 * الفجوة اللي بيقفلها: كل مرحلة من مراحل مركز العمليات اتحققت لوحدها حيًا، لكن التحقق كان
 * **تشغيلة عابرة** نتيجتها بتتكتب في README وبتموت. السكريبت ده هو نفس التحقق بس **ملتزم في
 * الريبو وقابل لإعادة التشغيل** — أي سيشن جاية تقدر تثبت إن الشاشات لسه شغالة بأمر واحد.
 *
 * الأهم فيه مش «الصفحة فتحت»: التأكيدات الحقيقية هي **اتساق الرقم بين الـAPI والشاشة**،
 * و**اتفاق شاشتين مختلفتين على نفس الطلب** — وde بالظبط الادعاء المركزي في §117 (مصدر اشتقاق
 * واحد). لو حد كسر المصدر الواحد واشتق الحالة في الواجهة، السكريبت ده بيسقط.
 *
 * التشغيل (محتاج الباك-إند على 3000 والأدمن على 3001 وPostgres/Redis شغالين):
 *   node apps/admin/test/operations-center.e2e.mjs
 *
 * متغيرات البيئة:
 *   ADMIN_URL      الافتراضي http://localhost:3001
 *   API_URL        الافتراضي http://localhost:3000/api/v1
 *   ADMIN_PHONE    رقم أدمن **بلا مفتاح مرور (passkey)** — الافتراضي +201000000077
 *   API_LOG        مسار لوج الباك-إند اللي بيتقرا منه كود الـOTP (مطلوب)
 *   CHROMIUM       مسار المتصفح — الافتراضي /opt/pw-browsers/chromium
 *   SHOTS_DIR      مجلد اللقطات — الافتراضي مجلد مؤقت
 *
 * **ليه الـOTP بيتقرا من اللوج**: الكود متخزّن مجزّأ (`otp_codes.code_hash`) فمستحيل يترد من
 * القاعدة، والتسجيل الخام مسموح في التطوير بس ومقفول بـfail-fast في الإنتاج (§P0-4). يعني
 * السكريبت ده أداة تطوير/CI عن قصد، مش حاجة تشتغل على بيئة حقيقية.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const ADMIN_URL = process.env.ADMIN_URL ?? 'http://localhost:3001';
const API_URL = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? '+201000000077';
const API_LOG = process.env.API_LOG;
const CHROMIUM = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium';
const SHOTS_DIR = process.env.SHOTS_DIR ?? mkdtempSync(join(tmpdir(), 'ops-e2e-'));

/** تبويبات مركز العمليات وعلامة نصية بتثبت إن محتوى التبويب اتحمّل فعلاً مش سكيليتون. */
const TABS = [
  { value: 'exceptions', marker: /مركز الاستثناءات|مفيش استثناءات/ },
  { value: 'live-dispatch', marker: /التحكم اللحظي في التوزيع/ },
  { value: 'workforce', marker: /مصفوفة القوى العاملة/ },
  { value: 'workload', marker: /الحمل|فنيين/ },
  { value: 'delivery', marker: /مراقبة تسليم الطلبات/ },
  { value: 'coverage', marker: /التغطية|منطقة/ },
];

const results = [];
function record(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      results.push({ name, ok: false, error: err.message });
      console.log(`  ✕ ${name}\n      ${err.message.split('\n')[0]}`);
    });
}

function latestOtp(phone) {
  if (!API_LOG) throw new Error('API_LOG مطلوب — السكريبت بيقرا كود الـOTP من لوج الباك-إند');
  const log = readFileSync(API_LOG, 'utf8');
  const matches = [...log.matchAll(new RegExp(`OTP\\] \\${phone} .*?→ (\\d{6})`, 'g'))];
  if (matches.length === 0) throw new Error(`مالقيتش كود OTP لـ${phone} في ${API_LOG}`);
  return matches[matches.length - 1][1];
}

async function apiGet(path, token) {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  assert.equal(res.status, 200, `${path} رجّع ${res.status}`);
  return body.data;
}

async function main() {
  console.log(`مصفوفة E2E — مركز العمليات\n  admin=${ADMIN_URL}  api=${API_URL}  shots=${SHOTS_DIR}\n`);

  // توكن مستقل للـAPI عشان نقارن **الحقيقة من المصدر** بالمعروض على الشاشة.
  await fetch(`${API_URL}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: ADMIN_PHONE, purpose: 'login' }),
  });
  await new Promise((r) => setTimeout(r, 1200));
  const verify = await fetch(`${API_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: ADMIN_PHONE, otp_code: latestOtp(ADMIN_PHONE) }),
  }).then((r) => r.json());
  if (!verify?.data?.access_token) {
    throw new Error(`تسجيل الدخول للـAPI فشل: ${JSON.stringify(verify?.error ?? verify)}`);
  }
  const token = verify.data.access_token;

  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  // أخطاء الصفحة بتتجمّع طول التشغيلة وبتتفحص في النهاية — بَقّة جرس الإشعارات (§117) كانت
  // بتوقّع القشرة كلها، ونوع الخطأ ده لازم يفشّل المصفوفة مش يعدّي بصمت.
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(`PAGEERROR ${page.url()}: ${e.message}`));

  async function goto(path, marker) {
    await page.goto(`${ADMIN_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (marker) await page.getByText(marker).first().waitFor({ timeout: 60_000 });
  }

  async function shot(name) {
    await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: true });
  }

  // ── تسجيل دخول حقيقي من الواجهة (مش حقن توكن): التوكن في state مش localStorage،
  //    فالحقن مستحيل أصلاً — والدخول الحقيقي بيغطّي القشرة والحراسة كمان.
  await goto('/login');
  await page.fill('#phone_number', ADMIN_PHONE);
  await page.click('button[type="submit"]');
  await page.waitForSelector('#otp_code', { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.fill('#otp_code', latestOtp(ADMIN_PHONE));
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 40_000 });
  console.log('تسجيل الدخول تم.\n');

  console.log('كل تبويبات مركز العمليات:');
  for (const tab of TABS) {
    await record(`تبويب «${tab.value}» بيحمّل محتوى حقيقي`, async () => {
      await goto(`/operations?tab=${tab.value}`, tab.marker);
      await shot(`tab-${tab.value}`);
      const body = await page.evaluate(() => document.body.innerText);
      assert.ok(!/حصل خطأ في تحميل/.test(body), 'الشاشة عرضت رسالة خطأ تحميل');
    });

    // الجداول العريضة لازم تسكرول جوّه حاويتها — الصفحة نفسها ممنوع تسكرول أفقيًا.
    await record(`تبويب «${tab.value}» بلا سكرول أفقي للصفحة`, async () => {
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      assert.ok(m.scrollW <= m.clientW + 1, `عرض المستند ${m.scrollW} أكبر من ${m.clientW}`);
    });
  }

  // ── الادعاء المركزي: الشاشة بتعرض رقم الباك-إند مش رقمها.
  console.log('\nاتساق الأرقام بين الـAPI والشاشة:');
  const live = await apiGet('/admin/operations/live-dispatch', token);
  const liveDelayed = await apiGet('/admin/operations/live-dispatch?only_delayed=true', token);

  const tileValue = (labelText) =>
    page.evaluate((t) => {
      const label = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === t);
      return label?.parentElement?.querySelector('span')?.textContent?.trim() ?? null;
    }, labelText);

  await record('عدّاد «طلبات بتدوّر» = العدد الحقيقي من الـAPI', async () => {
    await goto('/operations?tab=live-dispatch', /التحكم اللحظي في التوزيع/);
    assert.equal(await tileValue('طلبات بتدوّر'), String(live.summary.total_searching));
  });

  await record('عدّاد «متأخر (النظام واقف)» = عدد الصفوف المتأخرة من الـAPI', async () => {
    assert.equal(await tileValue('متأخر (النظام واقف)'), String(liveDelayed.orders.items.length));
  });

  /**
   * **التأكيد الحاسم**: مع فلتر «المتأخر بس» الصفوف بتقلّ والإجمالي المفروض **مايتغيّرش**.
   * لولا الفلتر ده التأكيد اللي فوق بيبقى فاضي: من غير قصّ ومن غير فلترة `items.length` بيساوي
   * `total_searching` بالصدفة، فحتى لو الشاشة رجعت تعرض عدد الصفوف مكان الإجمالي الاختبار
   * هيعدّي. اتجرّب فعليًا: حقنت الرجعة دي والاختبار عدّى — فاتزاد التأكيد ده.
   */
  await record('الإجمالي مابيتغيّرش لما «المتأخر بس» يقصّ الصفوف (بيفرّق بين الإجمالي وعدد الصفوف)', async () => {
    assert.notEqual(
      liveDelayed.orders.items.length,
      live.summary.total_searching,
      'البيانات الحالية مش بتفرّق بين الاتنين — التأكيد ده محتاج طلب متأخر واحد على الأقل وطلبات سليمة معاه',
    );
    await page.getByText('المتأخر بس').click();
    await page.waitForFunction(
      (expected) => {
        const label = [...document.querySelectorAll('span')].find((s) => s.textContent?.trim() === 'متأخر (النظام واقف)');
        return label?.parentElement?.querySelector('span')?.textContent?.trim() === expected;
      },
      String(liveDelayed.orders.items.length),
      { timeout: 30_000 },
    );
    await shot('live-dispatch-only-delayed');
    assert.equal(
      await tileValue('طلبات بتدوّر'),
      String(live.summary.total_searching),
      'الإجمالي اتغيّر مع الفلتر — الشاشة بتعرض عدد الصفوف مش العدد الحقيقي',
    );
  });

  await record('فلتر «المتأخر بس» بيقصّ الصفوف ومابيغيّرش الإجمالي', async () => {
    assert.equal(liveDelayed.summary.total_searching, live.summary.total_searching);
    assert.ok(liveDelayed.orders.items.length <= live.orders.items.length);
  });

  // ── الادعاء التاني: شاشتين مختلفتين بيقروا من نفس الاشتقاق، فلازم يتفقوا على نفس الطلب.
  console.log('\nاتفاق الشاشات على نفس الطلب (مصدر اشتقاق واحد):');
  const sample = liveDelayed.orders.items[0] ?? live.orders.items.find((i) => i.current_round > 0) ?? live.orders.items[0];

  if (!sample) {
    console.log('  ⚠ مفيش أي طلب بيدوّر في القاعدة دلوقتي — تأكيدات الاتفاق اتخطّت (مش فشل).');
  } else {
    const state = await apiGet(`/admin/orders/${sample.order_id}/matching-state`, token);

    await record('صفحة الطلب بتعرض نفس المرحلة اللي في التوزيع اللحظي', async () => {
      assert.equal(state.workflow.phase, sample.workflow_phase, 'الـAPI نفسه اداني مرحلتين مختلفتين');
      await goto(`/orders/${sample.order_id}`, /التحكم في المطابقة/);
      await shot('order-matching-control');
      const body = await page.evaluate(() => document.body.innerText);
      assert.ok(body.includes(state.workflow.phase_label_ar), `مالقيتش «${state.workflow.phase_label_ar}» في الصفحة`);
      assert.ok(body.includes(sample.workflow_phase_ar), 'نص المرحلة في الشاشتين مش واحد');
    });

    await record('صفحة الطلب بتعرض عدد الجولات والفنيين زي الـAPI', async () => {
      const body = await page.evaluate(() => document.body.innerText);
      assert.ok(body.includes(`${state.current_round} / ${state.max_rounds}`), 'الجولة الحالية/السقف مش معروضين');
      assert.ok(body.includes(String(state.technicians_contacted)), 'عدد الفنيين اللي اتبعتلهم مش معروض');
    });

    const attempt = state.rounds.flatMap((r) => r.attempts)[0];
    if (attempt) {
      await record('صفحة الفني بتعرض نفس العرض المفتوح اللي في صفحة الطلب', async () => {
        const profile = await apiGet(`/admin/technicians/${attempt.technician_id}/360`, token);
        await goto(`/technicians/${attempt.technician_id}`, /نظرة تشغيلية 360/);
        await shot('technician-open-offers');
        const body = await page.evaluate(() => document.body.innerText);
        const offer = profile.open_offers.find((o) => o.order_id === sample.order_id);
        if (offer) {
          assert.ok(body.includes(offer.order_number), `رقم الطلب ${offer.order_number} مش ظاهر في عروض الفني`);
        } else {
          // العرض ممكن يكون اترد عليه — ساعتها مايظهرش في «المفتوحة»، وde سلوك صح مش فشل.
          assert.ok(body.includes('عروض مفتوحة عنده دلوقتي'), 'قسم العروض المفتوحة نفسه مش موجود');
        }
      });
    }
  }

  await record('مفيش أي خطأ JavaScript في أي شاشة اتفتحت', () => {
    assert.deepEqual(pageErrors, []);
  });

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} نجحت — اللقطات في ${SHOTS_DIR}`);
  if (failed.length > 0) {
    console.error('\nفشل:');
    for (const f of failed) console.error(`  - ${f.name}: ${f.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
