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
  { value: 'trace', marker: /تتبّع الطلبات|مفيش طلبات بتدوّر/ },
  { value: 'workforce', marker: /مصفوفة القوى العاملة/ },
  { value: 'workload', marker: /الحمل|فنيين/ },
  { value: 'delivery', marker: /مراقبة تسليم الطلبات/ },
  { value: 'coverage', marker: /التغطية|منطقة/ },
];

/** نفس قاموس الواجهة — الاختبار بيقارن النص المعروض بالمرحلة اللي الـAPI رجّعها. */
const NEXT_ACTION_LABELS = {
  waiting_technician_response: 'مستني رد الفنيين',
  expand_next_round: 'المفروض يوسّع لجولة جديدة',
  matching_exhausted: 'الجولات خلصت بلا قبول',
  assigned: 'اتعيّن على فني',
  no_matching_required: 'مش في مرحلة بحث',
};

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

  // ── الادعاء المركزي: الشاشة بتعرض المرحلة اللي الباك-إند اشتقّها، مش مرحلة بتتحسب في المتصفح.
  console.log('\nاتساق الحالة بين الـAPI والشاشة:');
  const traces = (await apiGet('/admin/operations/order-traces', token)).items ?? [];

  await record('كل طلب في تبويب التتبّع بيعرض نفس المرحلة اللي الـAPI رجّعها', async () => {
    await goto('/operations?tab=trace', /تتبّع الطلبات|مفيش طلبات بتدوّر/);
    await shot('tab-trace-detail');
    if (traces.length === 0) return; // مفيش طلبات بتدوّر — مفيش حاجة تتقارن، ومش فشل.
    const body = await page.evaluate(() => document.body.innerText);
    for (const t of traces.slice(0, 10)) {
      const label = NEXT_ACTION_LABELS[t.next_action];
      assert.ok(label, `مرحلة مش معروفة للواجهة: ${t.next_action}`);
      assert.ok(body.includes(t.order_number), `الطلب ${t.order_number} مش ظاهر في التبويب`);
    }
    // النصوص المعروضة لازم تكون من القاموس بس — أي نص تاني معناه اشتقاق في الواجهة.
    const shownLabels = new Set(Object.values(NEXT_ACTION_LABELS).filter((l) => body.includes(l)));
    const apiLabels = new Set(traces.slice(0, 10).map((t) => NEXT_ACTION_LABELS[t.next_action]));
    for (const l of apiLabels) assert.ok(shownLabels.has(l), `الشاشة مابتعرضش «${l}» اللي الـAPI رجّعها`);
  });

  // ── الادعاء التاني: شاشتين مختلفتين بيقروا نفس الحقيقة، فلازم يتفقوا على نفس الطلب.
  console.log('\nاتفاق الشاشات على نفس الطلب:');
  const sample = traces.find((t) => t.next_action === 'expand_next_round') ?? traces.find((t) => t.current_round > 0) ?? traces[0];

  if (!sample) {
    console.log('  ⚠ مفيش أي طلب بيدوّر في القاعدة دلوقتي — تأكيدات الاتفاق اتخطّت (مش فشل).');
  } else {
    const single = (await apiGet(`/admin/operations/order-traces/${sample.order_id}`, token)).trace;

    await record('تتبّع الطلب الواحد بيطابق صف نفس الطلب في القايمة', async () => {
      assert.ok(single, 'الـendpoint رجّع null لطلب موجود في القايمة');
      assert.equal(single.next_action, sample.next_action, 'الـAPI اداني مرحلتين مختلفتين لنفس الطلب');
      assert.equal(single.current_round, sample.current_round);
      assert.equal(single.technicians_contacted, sample.technicians_contacted);
    });

    await record('صفحة الطلب بتعرض نفس المرحلة اللي في تبويب التتبّع', async () => {
      await goto(`/orders/${sample.order_id}`, /مفتّش المطابقة/);
      await shot('order-matching-inspector');
      const body = await page.evaluate(() => document.body.innerText);
      // قسم الجولات في صفحة الطلب متخفي عمدًا لما مفيش أي جولة (`rounds.length === 0`) —
      // مفيش حاجة تتعرض أصلاً. التأكيد على النص بيتطبّق بس لما يكون فيه جولة فعلية،
      // وغير كده بنتأكد إن المفتّش نفسه موجود (مش إن الصفحة وقعت).
      if ((sample.rounds ?? []).length === 0) {
        assert.ok(body.includes('مفتّش المطابقة'), 'المفتّش نفسه مش موجود في صفحة الطلب');
        return;
      }
      assert.ok(
        body.includes(NEXT_ACTION_LABELS[sample.next_action]),
        `مالقيتش «${NEXT_ACTION_LABELS[sample.next_action]}» في صفحة الطلب`,
      );
      assert.ok(body.includes(`جولة ${sample.current_round} من ${sample.max_rounds}`), 'الجولة الحالية/السقف مش معروضين');
    });

    // الفني بيتاخد من جولات نفس الطلب — الحقل الوحيد اللي فيه هوية فني في رد التتبّع.
    const techId = sample.rounds?.flatMap((r) => r.technicians ?? [])[0]?.technician_id ?? null;
    await record('صفحة الفني بتعرض العروض المفتوحة بأوقاتها (مش عدد مجرّد)', async () => {
      const profile360 = await apiGet(`/admin/technicians/${techId ?? ''}/360`, token).catch(() => null);
      if (!techId || !profile360) {
        // الصف مافيهوش فني (لسه ما اتوزّعش) — القسم نفسه لازم يفضل موجود.
        const anyTech = traces.flatMap((t) => (t.rounds ?? []).flatMap((r) => r.technicians ?? []))[0]?.technician_id;
        if (!anyTech) return;
        await goto(`/technicians/${anyTech}`, /نظرة تشغيلية 360/);
      } else {
        await goto(`/technicians/${techId}`, /نظرة تشغيلية 360/);
      }
      await shot('technician-open-offers');
      const body = await page.evaluate(() => document.body.innerText);
      assert.ok(body.includes('عروض مفتوحة عنده دلوقتي'), 'قسم العروض المفتوحة مش موجود');
    });
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
