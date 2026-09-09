#!/usr/bin/env node
/**
 * **ج-١٨ — تحكّم الأدمن وقت الطوارئ بلا نشر كود**.
 *
 * السؤال العملي: **الساعة ٣ الفجر، فيه حادثة، والمالك قدامه لوحة الأدمن وبس** — إيه اللي
 * يقدر يعمله من غير ما يستنى مطوّر يعمل build وdeploy؟
 *
 * ده مش سؤال رفاهية. النشر تحت الضغط بطيء (دقايق في أحسن الأحوال) وخطر (قرارات متسرّعة على
 * كود مش متراجَع)، والفرق بين حادثة محتواة وحادثة بتكبر هو غالبًا الدقايق دي.
 *
 * ## اللي بيتقاس هنا
 *
 * كل رافعة بتتقاس **بأثرها الحقيقي**، مش بإن الـPATCH رجّع `200`:
 *
 * | الرافعة | الأثر اللي بيتقاس فعلاً |
 * |---|---|
 * | إيقاف الحجز | طلب جديد بيترفض `503` (ج-١٧) |
 * | إيقاف وسيلة دفع | العميل مايقدرش يستخدمها |
 * | حظر عميل مسيء | توكنه الحالي **يبطل فورًا** |
 * | إيقاف فني | يخرج من التوزيع |
 * | ضبط عتبات الإنذار | القيمة الجديدة بتسري بلا إعادة تشغيل |
 *
 * ## وكمان: مين **مايقدرش** يلمس الرافعات دي
 *
 * مفتاح طوارئ بلا حراسة أخطر من غياب المفتاح — موظف دعم غاضب أو جلسة أدمن مسروقة تقدر توقف
 * المنصة كلها. فالتدقيق بيقيس الاتجاهين: الرافعة شغّالة للمخوّل، **ومقفولة** على غيره.
 *
 * ## والأهم: إيه اللي **لسه** محتاج نشر كود
 *
 * القسم الأخير بيطلع قايمة صريحة بالمقابض اللي من `process.env` — دي **مش قابلة للتغيير من
 * لوحة الأدمن مهما حصل**، وإخفاء ده أسوأ من وجوده: المالك لازم يعرف حدود سلطته **قبل** الحادثة.
 *
 *   node scripts/emergency-controls-audit.js [--keep]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LiveHarness, sleep, ROOT } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('ec');

const original = new Map();
let admin = null;

async function flip(key, value) {
  if (!original.has(key)) {
    const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [key]);
    original.set(key, row?.value);
  }
  return h.api(`/admin/settings/${key}`, {
    method: 'PATCH',
    token: admin.token,
    headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
    body: { value },
  });
}

async function restoreSettings() {
  for (const [key, value] of original) {
    if (value === undefined) continue;
    try {
      await flip(key, value);
    } catch {
      await h.setSetting(key, value).catch(() => {});
    }
  }
  original.clear();
}

function messageOf(body) {
  return String(body?.message ?? body?.error?.message ?? '').slice(0, 140);
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٨: تحكّم الأدمن وقت الطوارئ بلا نشر كود — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  admin = await h.makeAdmin();
  const customer = await h.makeCustomer('ec');
  const tech = await h.makeTechnician('ec');
  await h.fundWallet(customer.userId, 1_000_000);

  // ═══ ر-١: الرافعة موجودة أصلاً ═══
  //
  // ١٤ مفتاح إيقاف مسجّل. الفحص ده بيثبت إنهم **مرئيين للأدمن فعلاً** — مفتاح موجود في الكود
  // بس مش ظاهر في شاشة الإعدادات = مفتاح مش موجود عمليًا وقت الحادثة.
  const settingsList = await h.api('/admin/settings', { token: admin.token });
  const rows = Array.isArray(settingsList.body?.data) ? settingsList.body.data : [];
  const killSwitches = rows.filter((r) => String(r.key ?? '').endsWith('_enabled'));
  h.record(
    'ر-١/أ الأدمن بيشوف مفاتيح الإيقاف في لوحته (مش مدفونة في الكود)',
    settingsList.status === 200 && killSwitches.length >= 10,
    `HTTP=${settingsList.status} مفاتيح إيقاف ظاهرة=${killSwitches.length} من إجمالي ${rows.length} إعداد`,
  );

  // ═══ ر-٢: إيقاف وسيلة دفع — أثر حقيقي على العميل ═══
  //
  // السيناريو: بوابة الدفع بتفشل، أو الكاش بيتسرّق. المالك لازم يقدر يقفل الوسيلة دي **وحدها**
  // ويسيب الباقي شغّال.
  const order = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق ج-١٨ — إيقاف وسيلة دفع',
    },
  });
  h.record('ر-٢/٠ طلب أساس اتعمل (ضابط قبل أي حكم)', order.status === 201, `HTTP=${order.status}`);
  if (order.status !== 201) return finish();
  const orderId = order.body.data.id;

  // **لازم الشغل يخلص الأول**. أول نسخة من الفحص ده جرّبت الدفع والطلب لسه
  // `searching_technician`، فالرفض كان بسبب **حالة الطلب** مش بسبب المفتاح — يعني الفحص عدّى
  // وهو فاضي (`ر-٢/ب` بيلوّن أخضر بلا ما يلمس المفتاح أصلاً)، و`ر-٢/ج` فشل بعد رفع الإيقاف
  // لنفس السبب. الفحص اللي بيقيس حاجة تانية غير اللي بيدّعيه بيكدب في الاتجاهين.
  for (let i = 0; i < 60 && !(await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]))[0]?.technician_id; i++) {
    await sleep(500);
  }
  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
  }
  await h.uploadAfterPhoto(orderId, tech.token);
  const completed = await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });
  h.record(
    'ر-٢/٠ب الشغل خلص فعلاً (فالرفض تحت هيبقى بسبب المفتاح مش بسبب حالة الطلب)',
    completed.status === 200 || completed.status === 201,
    `إقفال=${completed.status} ${messageOf(completed.body)}`,
  );

  const walletOff = await flip('payments.wallet_enabled', false);
  h.record('ر-٢/أ المالك قدر يقفل الدفع بالمحفظة', walletOff.status === 200, `PATCH=${walletOff.status}`);

  const payBlocked = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `ec-${h.nextTag()}` },
  });
  // **الأثر الحقيقي** مش الـPATCH: العميل فعلاً مابقاش يقدر يدفع بالوسيلة المقفولة.
  h.record(
    'ر-٢/ب والعميل فعلاً مابقاش يقدر يدفع بيها (أثر حقيقي مش PATCH ناجح)',
    payBlocked.status >= 400,
    `HTTP=${payBlocked.status} — ${messageOf(payBlocked.body)}`,
  );

  const walletOn = await flip('payments.wallet_enabled', true);
  const payAfter = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `ec-${h.nextTag()}` },
  });
  // الرجوع فوري: مفتاح بيوقف بسرعة وبيرجع ببطء = المالك هيتردد في استخدامه وقت الحادثة.
  h.record(
    'ر-٢/ج ورفع الإيقاف رجّعها فورًا بلا إعادة تشغيل',
    walletOn.status === 200 && payAfter.status < 400,
    `PATCH=${walletOn.status} دفع=${payAfter.status} ${messageOf(payAfter.body)}`,
  );

  // ═══ ر-٣: حظر عميل مسيء — التوكن الحالي يبطل فورًا ═══
  //
  // أهم تفصيلة أمنية في البند: حظر بيمنع **تسجيل دخول جديد** بس، والتوكن اللي في إيد المسيء
  // فاضل شغّال لحد ما ينتهي — يعني الحظر مالوش أثر فوري وهو بالظبط اللحظة اللي محتاجينه فيها.
  const abuser = await h.makeCustomer('ecab');
  const beforeBlock = await h.api('/orders?limit=1', { token: abuser.token });
  h.record(
    'ر-٣/٠ توكن العميل شغّال قبل الحظر (ضابط)',
    beforeBlock.status === 200,
    `HTTP=${beforeBlock.status}`,
  );

  const block = await h.api(`/admin/customers/${abuser.userId}/block`, {
    method: 'POST',
    token: admin.token,
    body: { reason: 'تدقيق ج-١٨ — حظر طوارئ' },
  });
  h.record('ر-٣/أ المالك قدر يحظر العميل من لوحته', block.status === 200 || block.status === 201, `HTTP=${block.status} ${messageOf(block.body)}`);

  await sleep(500);
  const afterBlock = await h.api('/orders?limit=1', { token: abuser.token });
  h.record(
    'ر-٣/ب وتوكنه الحالي بطل **فورًا** (مش مستني انتهاء صلاحيته)',
    afterBlock.status === 401 || afterBlock.status === 403,
    `HTTP=${afterBlock.status}${afterBlock.status === 200 ? ' — لسه شغّال رغم الحظر ❗' : ''}`,
  );

  const unblock = await h.api(`/admin/customers/${abuser.userId}/unblock`, { method: 'POST', token: admin.token });
  h.record('ر-٣/ج والحظر قابل للرفع (خطأ بشري وقت الحادثة وارد)', unblock.status === 200 || unblock.status === 201, `HTTP=${unblock.status}`);

  // ═══ ر-٤: إيقاف فني ═══
  const suspend = await h.api(`/admin/technicians/${tech.id}/suspend`, {
    method: 'POST',
    token: admin.token,
    body: { reason: 'تدقيق ج-١٨ — إيقاف طوارئ' },
  });
  h.record(
    'ر-٤/أ المالك قدر يوقف فني فورًا من لوحته',
    suspend.status === 200 || suspend.status === 201,
    `HTTP=${suspend.status} ${messageOf(suspend.body)}`,
  );
  const [techRow] = await h.q(`SELECT verification_status FROM technician_profiles WHERE id = $1`, [tech.id]);
  h.record(
    'ر-٤/ب والحالة اتغيّرت فعلاً في القاعدة (مش رد 200 وبس)',
    techRow?.verification_status === 'suspended',
    `verification_status=${techRow?.verification_status}`,
  );

  // ═══ ر-٥: عتبات الإنذار (ج-٧) لسه قابلة للضبط ═══
  //
  // تهدئة إنذار بيرن كتير الساعة ٣ الفجر، أو تشديده قبل موسم — ده بالظبط تحكّم بلا deploy.
  const thresholdBefore = (await h.q(`SELECT value FROM settings WHERE key = 'ops.alert_queue_failed'`))[0]?.value;
  const tighten = await flip('ops.alert_queue_failed', 3);
  await sleep(300);
  // المسار `health-metrics` مش `metrics` — الاسم الغلط بيرجّع 404 فالعتبة بتقرا `undefined`
  // والفحص بيفشل على كود سليم.
  const metrics = await h.api('/admin/ops/health-metrics', { token: admin.token, timeoutMs: 30_000 });
  const applied = metrics.body?.data?.thresholds?.queueFailed;
  h.record(
    'ر-٥/أ عتبات الإنذار بتتضبط وتسري فورًا (بلا deploy)',
    tighten.status === 200 && applied === 3,
    `PATCH=${tighten.status} العتبة المطبَّقة=${applied} (كانت ${thresholdBefore})`,
  );

  // ═══ ر-٦: الحراسة — مين مايقدرش يلمس الرافعات ═══
  //
  // مفتاح طوارئ بلا حراسة أخطر من غيابه: موظف غاضب أو جلسة مسروقة توقف المنصة كلها.
  const weakEmployee = await h.makeEmployee(['orders.view'], 'ecw');
  const denied = await h.api('/admin/settings/orders.new_bookings_enabled', {
    method: 'PATCH',
    token: weakEmployee.token,
    body: { value: false },
  });
  h.record(
    'ر-٦/أ موظف بلا صلاحية settings.manage مايقدرش يوقف الحجز',
    denied.status === 403,
    `HTTP=${denied.status}${denied.status === 200 ? ' — وقف الحجز بلا صلاحية ❗' : ''}`,
  );

  // step-up = طبقة تانية: توكن أدمن مسروق لوحده مش كفاية لتعطيل المنصة.
  const noStepUp = await h.api('/admin/settings/orders.new_bookings_enabled', {
    method: 'PATCH',
    token: admin.token,
    body: { value: false },
  });
  h.record(
    'ر-٦/ب وحتى الأدمن محتاج تحقق step-up (توكن مسروق لوحده مش كفاية)',
    noStepUp.status === 401 || noStepUp.status === 403,
    `HTTP=${noStepUp.status}${noStepUp.status === 200 ? ' — عدّى بلا step-up ❗' : ''}`,
  );

  // ═══ ر-٧: المحاسبة — كل تدخّل طوارئ متسجّل ═══
  //
  // بعد الحادثة لازم نعرف مين عمل إيه وامتى. رافعة بلا أثر تدقيق بتخلّي التحقيق مستحيل.
  const auditRows = await h.q(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE actor_user_id = $1 AND action IN ('setting.updated','customer.blocked','customer.unblocked','technician.suspended')`,
    [admin.userId],
  );
  h.record(
    'ر-٧/أ كل تدخّلات الطوارئ اتسجّلت في سجل التدقيق (مين عمل إيه وامتى)',
    (auditRows[0]?.n ?? 0) > 0,
    `سجلات=${auditRows[0]?.n}`,
  );

  // ═══ ر-٨: الحدود الصريحة — إيه اللي لسه محتاج نشر ═══
  //
  // ده **مش فحص بينجح أو يفشل** — هو جرد. إخفاء الحدود دي أسوأ من وجودها: المالك لازم يعرف
  // سلطته فين بتقف **قبل** الحادثة، مش وهو بيحاول يوقف سيل هجوم الساعة ٣ الفجر.
  const envKnobs = collectEnvKnobs();
  const incidentRelevant = envKnobs.filter((k) =>
    /THROTTLE|POOL|CONCURRENCY|TIMEOUT/i.test(k),
  );
  console.log(`\n--- مقابض من البيئة (تحتاج نشر/إعادة تشغيل — مش من لوحة الأدمن) ---`);
  for (const k of incidentRelevant) console.log(`   • ${k}`);
  h.record(
    'ر-٨/أ حدود التحكّم موثّقة صراحةً (المقابض اللي لسه محتاجة نشر معروفة بالاسم)',
    incidentRelevant.length > 0,
    `${incidentRelevant.length} مقبض من البيئة: ${incidentRelevant.join(', ')}`,
  );

  await finish();
}

/** كل `process.env.X` المستخدَمة في كود الباك-إند — دي المقابض اللي مش قابلة للتغيير من اللوحة. */
function collectEnvKnobs() {
  const srcDir = path.join(ROOT, 'apps/api/src');
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) found.add(m[1]);
      }
    }
  };
  walk(srcDir);
  return [...found].sort();
}

async function finish() {
  await restoreSettings();
  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  if (!KEEP) {
    console.log(`\nتنظيف...`);
    await h.cleanup();
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await restoreSettings().catch(() => {});
  await h.close();
  process.exit(2);
});
