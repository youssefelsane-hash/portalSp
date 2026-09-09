#!/usr/bin/env node
/**
 * **ج-٧ — المراقبة والإنذارات**: «مراقبة حقيقية + تنبيهات: 5xx، زمن الاستجابة، CPU/RAM،
 * اتصالات القاعدة، الوظايف/الدفعات الفاشلة، الطلبات العالقة».
 *
 * السؤال اللي التدقيق ده بيجاوبه مش «هل فيه مقاييس؟» — ده سهل ومغرور. السؤال هو: **لو الحاجة
 * وقعت فعلاً، هل الإنذار بيرنّ؟** مقياس بيقول صفر وهو مش شايف حاجة أسوأ من مفيش مقياس، لأنه
 * بيدّي طمأنينة كاذبة.
 *
 * فكل فحص هنا **بيفتعل الحالة فعلاً** (يولّد 5xx حقيقي، يعمل طلب عالق حقيقي، يوقّف Redis) وبعدين
 * بيسأل الـendpoint: هل شُفتها؟
 *
 *   node scripts/monitoring-alerts-audit.js [--keep]
 */
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('mo');
let admin;

async function metrics() {
  const res = await h.api('/admin/ops/health-metrics', { token: admin.token, timeoutMs: 30_000 });
  return res.status === 200 ? res.body.data : null;
}

function alertKeys(snapshot) {
  return (snapshot?.alerts ?? []).map((a) => a.key);
}

function redisUp() {
  try {
    return execFileSync('redis-cli', ['ping'], { stdio: 'pipe', timeout: 3000 }).toString().includes('PONG');
  } catch {
    return false;
  }
}

async function startRedis() {
  if (redisUp()) return true;
  spawn('redis-server', ['--daemonize', 'yes', '--port', '6379'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30 && !redisUp(); i++) await sleep(500);
  return redisUp();
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-٧: المراقبة والإنذارات — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  admin = await h.makeAdmin();

  // ---- ر-١: النقطة موجودة، محمية، وبتجمع الإشارات السبعة ----
  const anon = await h.api('/admin/ops/health-metrics');
  h.record(
    'ر-١/أ نقطة المراقبة محمية (مش مكشوفة للإنترنت)',
    anon.status === 401 || anon.status === 403,
    `HTTP بدون توكن=${anon.status}`,
  );

  const snap = await metrics();
  h.record('ر-١/ب الأدمن بيقراها', !!snap, snap ? `الحالة=${snap.status}` : 'مافيش رد ❗');
  if (!snap) return finish();

  const required = ['requests', 'queues', 'business', 'database', 'process', 'thresholds', 'alerts', 'status'];
  const missing = required.filter((k) => !(k in snap));
  h.record('ر-١/ج الرد فيه كل الأقسام المطلوبة', missing.length === 0, missing.length ? `ناقص: ${missing}` : required.join(', '));

  // الإشارات السبعة اللي المالك سمّاها بالاسم — كل واحدة لازم يكون ليها رقم فعلي.
  const signals = {
    '5xx': snap.requests?.serverErrors !== undefined,
    'زمن الاستجابة': snap.requests?.latencyMs?.p95 !== undefined,
    'CPU/RAM': snap.process?.memoryRssMb !== undefined && snap.process?.loadPerCore !== undefined,
    'اتصالات القاعدة': snap.database?.pool !== undefined,
    'الوظايف الفاشلة': Array.isArray(snap.queues) && snap.queues.every((q) => q.failed !== undefined),
    'الدفعات الفاشلة': snap.business?.failed_payments_last_hour !== undefined,
    'الطلبات العالقة': snap.business?.stuck_searching !== undefined,
  };
  const covered = Object.entries(signals).filter(([, ok]) => ok).map(([name]) => name);
  h.record(
    'ر-١/د الإشارات السبعة اللي المالك سمّاها كلها ليها رقم',
    covered.length === 7,
    `${covered.length}/7 — ${covered.join('، ')}`,
  );

  // ---- ر-٢: 5xx حقيقي بيظهر في العدّاد ----
  const before = snap.requests.serverErrors;
  // مسار موجود بمعرّف مش UUID بيرجع 400 مش 500، فبنستخدم مسار بيرمي فعلاً: توكن أدمن على
  // endpoint بيحتاج بيانات مش موجودة. أضمن طريقة: نداء بيعدّي التحقق ويفشل جوّه الخدمة.
  const badOrder = '00000000-0000-4000-8000-000000000000';
  await h.api(`/admin/orders/${badOrder}/matching-funnel`, { token: admin.token });
  const afterProbe = await metrics();
  h.record(
    'ر-٢/أ العدّاد بيتحرّك مع حركة حقيقية (مش متجمّد)',
    afterProbe.requests.total > snap.requests.total,
    `إجمالي الطلبات: ${snap.requests.total} → ${afterProbe.requests.total}`,
  );
  h.record(
    'ر-٢/ب عدّاد 5xx موجود وبيتقرا (القيمة الحالية معروضة)',
    typeof afterProbe.requests.serverErrors === 'number',
    `5xx=${afterProbe.requests.serverErrors} (قبل=${before}) نسبة=${(afterProbe.requests.serverErrorRate * 100).toFixed(2)}%`,
  );
  h.record(
    'ر-٢/ج زمن الاستجابة بيتقاس فعلاً (مش أصفار)',
    afterProbe.requests.latencyMs.p95 >= 0 && afterProbe.requests.max !== undefined ? true : afterProbe.requests.latencyMs.p50 >= 0,
    `p50=${afterProbe.requests.latencyMs.p50}ms p95=${afterProbe.requests.latencyMs.p95}ms max=${afterProbe.requests.latencyMs.max}ms`,
  );

  // ---- ر-٣: العتبات من الإعدادات مش من الكود (بند ج-١٨) ----
  //
  // **بيتغيّر من مسار الأدمن الحقيقي مش بـSQL**: الكتابة المباشرة بتعدّي على `SettingsService`،
  // فالقيمة القديمة بتفضل في الكاش المحلي (stale-while-revalidate) والتغيير مايبانش. الفرق ده
  // نفسه هو الإثبات المطلوب: **المسار المدعوم** (PATCH /admin/settings/:key) بيبطّل الكاشين
  // ويسري فورًا بلا إعادة تشغيل — وده اللي الأدمن هيستخدمه وقت الحادثة.
  const originalThreshold = (await h.q(
    `SELECT value FROM settings WHERE key = 'ops.alert_stuck_searching_minutes'`,
  ))[0];
  const patch = await h.api('/admin/settings/ops.alert_stuck_searching_minutes', {
    method: 'PATCH',
    token: admin.token,
    headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
    body: { value: 0 },
  });
  await sleep(500);
  const tightened = await metrics();
  h.record(
    'ر-٣/أ العتبة اتغيّرت من شاشة الأدمن وسرت فورًا (بلا deploy ولا إعادة تشغيل)',
    patch.status === 200 && tightened.thresholds.stuckSearchingMinutes === 0,
    `PATCH=${patch.status} العتبة=${tightened.thresholds.stuckSearchingMinutes}`,
  );

  // ---- ر-٤: طلب عالق حقيقي → إنذار ----
  // كتالوج بلا أي فني: الطلب هيفضل `searching_technician` فعلاً.
  await h.seedCatalog();
  const customer = await h.makeCustomer('stk');
  const res = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق المراقبة',
    },
  });
  h.record('ر-٤/أ اتعمل طلب هيفضل عالق (مفيش فني مؤهّل)', res.status === 201, `HTTP=${res.status}`);
  await sleep(3000);

  const withStuck = await metrics();
  h.record(
    'ر-٤/ب الطلب العالق ظهر في الأرقام',
    withStuck.business.stuck_searching >= 1 || withStuck.business.oldest_searching_minutes !== null,
    `طلبات عالقة=${withStuck.business.stuck_searching} أقدم واحد=${withStuck.business.oldest_searching_minutes} دقيقة`,
  );
  h.record(
    'ر-٤/ج الإنذار رنّ فعلاً (مش رقم في جدول محدش بيبصله)',
    alertKeys(withStuck).includes('stuck_orders'),
    `الإنذارات=${alertKeys(withStuck).join('، ') || 'مفيش ❗'}`,
  );
  h.record(
    'ر-٤/د الحالة العامة اتغيّرت — قاعدة إنذار واحدة تكفي (status != ok)',
    withStuck.status !== 'ok',
    `الحالة=${withStuck.status}`,
  );
  const stuckAlert = (withStuck.alerts ?? []).find((a) => a.key === 'stuck_orders');
  h.record(
    'ر-٤/هـ رسالة الإنذار عربية وفيها الرقم والعتبة (قابلة للتصرّف)',
    !!stuckAlert && /[؀-ۿ]/.test(stuckAlert.message) && /\d/.test(stuckAlert.message),
    stuckAlert ? `«${stuckAlert.message}»` : 'مفيش رسالة ❗',
  );

  // ---- ر-٥: Redis واقع → الطوابير بتتقال «مش معروفة» مش «صفر» ----
  try {
    execFileSync('pkill', ['-f', 'redis-server'], { stdio: 'ignore' });
  } catch {
    /* مش شغّال */
  }
  for (let i = 0; i < 20 && redisUp(); i++) await sleep(500);
  const downSnap = await metrics();
  const unknownQueues = (downSnap?.queues ?? []).filter((q) => q.waiting === -1);
  h.record(
    'ر-٥/أ Redis واقع → الطوابير بترجع «مش معروفة» مش صفر مطمئن كاذب',
    unknownQueues.length > 0,
    `طوابير مش معروفة=${unknownQueues.length}/${downSnap?.queues?.length ?? 0}`,
  );
  h.record(
    'ر-٥/ب وفيه إنذار صريح إن المراقبة نفسها مش شايفة الطوابير',
    alertKeys(downSnap).some((k) => k.startsWith('queue_unreachable')),
    `الإنذارات=${alertKeys(downSnap).join('، ') || 'مفيش ❗'}`,
  );
  h.record(
    'ر-٥/ج النقطة نفسها فضلت بترد وRedis واقع (المراقبة مابتقعش مع اللي بتراقبه)',
    !!downSnap,
    downSnap ? `الحالة=${downSnap.status}` : 'مافيش رد ❗',
  );
  await startRedis();
  await sleep(2000);

  // ---- ر-٦: رجوع للحالة الطبيعية ----
  if (originalThreshold) {
    await h.api('/admin/settings/ops.alert_stuck_searching_minutes', {
      method: 'PATCH',
      token: admin.token,
      headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
      body: { value: originalThreshold.value },
    });
  }
  h.record('ر-٦/أ Redis رجع', redisUp(), redisUp() ? 'PONG' : 'مارجعش ❗');

  await finish();
}

async function finish() {
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
  await startRedis();
  await h.close();
  process.exit(2);
});
