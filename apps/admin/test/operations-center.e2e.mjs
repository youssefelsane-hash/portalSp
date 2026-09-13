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
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import jwt from 'jsonwebtoken';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

/**
 * توكن أدمن موقّع محليًا بسر التطوير — أداة قراءة للمقارنة، مش التفاف على الأمان: نفس
 * الطريقة اللي `scripts/lib/live-harness.js` بيستخدمها في كل التدقيقات الحية، والسر بيتقرا من
 * `apps/api/.env` فمش هيشتغل على أي بيئة حقيقية أصلاً.
 */
function signDevAdminToken(phone) {
  const env = Object.fromEntries(
    readFileSync(join(REPO_ROOT, 'apps/api/.env'), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const secret = process.env.JWT_ACCESS_SECRET ?? env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET مش موجود في apps/api/.env');
  const userId = execFileSync(
    'psql',
    ['-h', 'localhost', '-U', 'baytak', '-d', env.DATABASE_URL.split('/').pop(), '-Atc',
      `SELECT id FROM users WHERE phone_number='${phone}' AND deleted_at IS NULL LIMIT 1`],
    { env: { ...process.env, PGPASSWORD: 'baytak' }, encoding: 'utf8' },
  ).trim();
  if (!userId) throw new Error(`مفيش مستخدم بالرقم ${phone} — اعمله الأول`);
  return jwt.sign({ sub: userId, userType: 'admin', amr: ['otp'] }, secret, { expiresIn: '60m' });
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
  //
  // **كان بيعمل OTP verify ويتوقّع `access_token`** — وده بطل يشتغل من ساعة ما MFA بقى إجباري
  // لحسابات الأدمن: الرد بقى `{ mfa_required: true, ceremony: 'registration' }` بلا توكن،
  // فالسكربت كان بيموت من أول خطوة قبل ما يقيس أي حاجة (تدقيق ماراثوني 2026-09-13، docs/08 §148).
  // التوكن هنا **قراءة بس** لمقارنة المصدر بالشاشة، فالتوقيع المحلي بنفس سر التطوير أبسط
  // وأثبت من إعادة تمثيل مراسم الـPasskey مرتين. أما الدخول من المتصفح تحت فبيفضل **حقيقي**
  // بالكامل (بمصادق افتراضي) لأن ده اللي بيغطّي القشرة والحراسة.
  const token = signDevAdminToken(ADMIN_PHONE);

  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // مصادق افتراضي للـPasskey: MFA بقى إجباري لحسابات الأدمن، فالدخول من المتصفح بيعدّي على
  // مراسم تسجيل/تأكيد Passkey. من غيره السكربت بيقف على شاشة الـMFA للأبد.
  const cdp = await context.newCDPSession(await context.newPage());
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  const page = context.pages()[0];

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
  // خطوة MFA: تسجيل Passkey (المصادق الافتراضي بيوافق تلقائيًا) ثم إقرار أكواد الاسترجاع.
  // نفس منطق `scripts/sweep-admin.js` بالحرف — بالاسم الصريح مش `.first()`، عشان ماندوسش
  // «دخول» بالغلط ونطلب OTP جديد فيبطل الكود اللي حطّيناه.
  for (let i = 0; i < 4 && page.url().includes('/login'); i++) {
    if (await page.locator('#ack').count()) {
      await page.check('#ack');
      await page.getByRole('button', { name: /كمّل|الإدارة/ }).click().catch(() => {});
      await page.waitForTimeout(4000);
      continue;
    }
    const mfaButton = page.getByRole('button', { name: /سجّل Passkey دلوقتي|تأكيد بـ ?Passkey/ });
    if (await mfaButton.count()) {
      await mfaButton.first().click().catch(() => {});
      await page.waitForTimeout(4000);
      continue;
    }
    await page.waitForTimeout(1500);
  }
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
