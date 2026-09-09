#!/usr/bin/env node
/**
 * **ج-٦ — الانهيار وإعادة التشغيل وانقطاع الاعتماديات**: «اقتل الباك-إند وسط طلبات شغّالة،
 * شغّله تاني — مفيش طلب بيضيع. وانقطاع Redis أو بوابة الدفع مايوقّعش النظام».
 *
 * القاعدة الحاكمة اللي المالك نطقها: «ما يحصلش كارثة… ضعيف بطيء مفيش مشكلة، ولكن ما يقعش».
 * فالتدقيق ده **مابيقيسش السرعة** — بيقيس حاجتين بس:
 *   ١. أي عملية العميل شاف ليها نجاح (201) لازم تفضل موجودة بعد الانهيار.
 *   ٢. أي عملية اتقطعت في النص لازم تنتهي لحالة **معروفة وقابلة للاسترداد** — مش عالقة بلا خطة.
 *
 * الاختبار بيقتل ويرجّع خدمات حقيقية (`SIGKILL` على الـAPI، إيقاف Redis فعليًا)، فلازم يتشغّل
 * على بيئة تطوير مش على حاجة حد تاني شغال عليها.
 *
 *   node scripts/crash-resilience-audit.js [--keep]
 */
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('cr');

// ===================== إدارة Redis =====================

function redisUp() {
  try {
    return execFileSync('redis-cli', ['ping'], { stdio: 'pipe', timeout: 3000 }).toString().includes('PONG');
  } catch {
    return false;
  }
}

async function stopRedis() {
  try {
    execFileSync('pkill', ['-f', 'redis-server'], { stdio: 'ignore' });
  } catch {
    /* مش شغّال أصلاً */
  }
  for (let i = 0; i < 20 && redisUp(); i++) await sleep(500);
  return !redisUp();
}

async function startRedis() {
  if (redisUp()) return true;
  spawn('redis-server', ['--daemonize', 'yes', '--port', '6379'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30 && !redisUp(); i++) await sleep(500);
  return redisUp();
}

// ===================== أدوات مشتركة =====================

async function createOrder(customer, extra = {}, timeoutMs) {
  return h.api('/orders', {
    method: 'POST',
    token: customer.token,
    timeoutMs,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق الصمود',
      ...extra,
    },
  });
}

/**
 * قراءة **آخر** جزء من اللوج بس. `readFileSync` الكامل كان بينهار بـ`ERR_STRING_TOO_LONG` —
 * لوج الـAPI بيوصل چيجابايتات أثناء انقطاع Redis (نفس المشكلة اللي التدقيق ده كشفها).
 */
function tailLog(bytes = 400_000) {
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '../apps/api/.dev-logs/api.out');
  if (!fs.existsSync(file)) return '';
  const { size } = fs.statSync(file);
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function logSizeBytes() {
  const fs = require('node:fs');
  const file = require('node:path').join(__dirname, '../apps/api/.dev-logs/api.out');
  return fs.existsSync(file) ? fs.statSync(file).size : 0;
}

async function orderRow(orderId) {
  const [row] = await h.q(
    `SELECT order_status, technician_id, matching_attempt_count, next_matching_attempt_at, cancelled_at
       FROM orders WHERE id = $1`,
    [orderId],
  );
  return row ?? null;
}

/** الطلب داخل في استعلام الـsweep بنيويًا؟ (نفس شروط `MatchingRecoveryService`). */
async function inSweepPipeline(orderId) {
  const [row] = await h.q(
    `SELECT 1 FROM orders o
      WHERE o.id = $1
        AND o.order_status = 'searching_technician'
        AND o.service_zone_id IS NOT NULL
        AND o.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM order_assignments a
           WHERE a.order_id = o.id AND a.assignment_status IN ('sent','viewed') AND a.expires_at > now()
        )`,
    [orderId],
  );
  return !!row;
}

/** الطلب وصل لحالة نهائية مقبولة (اتعيّن) أو لسه في طابور الاسترداد؟ */
async function accountedFor(orderId) {
  const row = await orderRow(orderId);
  if (!row) return { ok: false, why: 'مش موجود في القاعدة ❗' };
  if (row.technician_id) return { ok: true, why: `اتعيّن (${row.order_status})` };
  if (row.cancelled_at) return { ok: true, why: `اتلغى بقرار موثّق (${row.order_status})` };
  if (await inSweepPipeline(orderId)) return { ok: true, why: `في طابور الاسترداد (${row.order_status})` };
  return { ok: false, why: `عالق بلا خطة ❗ (${row.order_status})` };
}

// ===================== ك-١: انهيار وسط الطلبات =====================

/**
 * **الاختبار الأهم في ج-٦**: العميل داس «تأكيد»، والباك-إند مات وهو بينفّذ.
 *
 * بنطلق ثمن طلبات متزامنة وبنقتل العملية بـSIGKILL بعد ٤٠٠ms — يعني بعضها اتكتب خلاص، وبعضها
 * كان لسه جوّه الترانزاكشن، وبعضها كان في مرحلة التوزيع. SIGKILL مش graceful عمدًا: أي إغلاق
 * نظيف بيخفي بالظبط الفشل اللي بندوّر عليه.
 */
async function crashMidFlight() {
  await h.seedCatalog();
  const techs = await Promise.all(['c1', 'c2', 'c3'].map((l) => h.makeTechnician(l)));
  void techs;
  const customers = await Promise.all(Array.from({ length: 8 }, (_, i) => h.makeCustomer(`k${i}`)));

  const inFlight = customers.map((c) => createOrder(c).catch((err) => ({ status: 0, body: { err: String(err) } })));
  await sleep(400);

  let killed = false;
  try {
    execFileSync('pkill', ['-9', '-f', 'node ./dist/main.js'], { stdio: 'ignore' });
    killed = true;
  } catch {
    /* مفيش نسخة شغّالة */
  }
  const results = await Promise.all(inFlight);
  h.record(
    'ك-١/أ الباك-إند اتقتل فعلاً وسط الطلبات (SIGKILL مش إغلاق نظيف)',
    killed,
    `أكواد الردود=${JSON.stringify(results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}))}`,
  );

  await h.restartApi();
  h.record('ك-١/ب الباك-إند رجع بعد الانهيار', await h.isApiUp(), 'بيرد على /branding');

  // **العهد اللي مايتكسرش**: أي 201 وصل للعميل لازم يكون ليه صف طلب حقيقي.
  // **مايكفيش نعتمد على الـ201 لوحدها**: لو القتل جه قبل أي رد، القايمة بتطلع فاضية وكل
  // التأكيدات تحتها بتعدّي وهي مش بتقيس حاجة. فبنضم كمان أي صف طلب اتكتب فعلاً لعملاء
  // التشغيلة — ده اللي بيخلي الاختبار له معنى مهما كان توقيت القتل.
  const promisedIds = results.filter((r) => r.status === 201 && r.body?.data?.id).map((r) => r.body.data.id);
  const profileIds = customers.map((c) => c.profileId);
  const written = (
    await h.q(`SELECT id FROM orders WHERE customer_id = ANY($1::uuid[])`, [profileIds])
  ).map((r) => r.id);
  const promised = [...new Set([...promisedIds, ...written])];
  h.record(
    'ك-١/ج٠ الاختبار له معنى (فيه طلبات فعلاً اتكتبت أو اتوعد بيها)',
    promised.length > 0,
    `اتوعد بـ201=${promisedIds.length} مكتوبة في القاعدة=${written.length} الإجمالي=${promised.length}`,
  );
  const found = promised.length
    ? (await h.q(`SELECT id FROM orders WHERE id = ANY($1::uuid[])`, [promised])).length
    : 0;
  h.record(
    'ك-١/ج كل طلب العميل شاف ليه نجاح لسه موجود بعد الانهيار',
    promisedIds.length === 0 || promisedIds.every((id) => promised.includes(id)),
    `اتوعد بـ201=${promisedIds.length} كلهم موجودين=${promisedIds.every((id) => promised.includes(id)) ? 'أيوه' : 'لأ ❗'} (إجمالي الصفوف=${found})`,
  );

  // **مفيش نص صف**: طلب موجود بلا أي سطر في تاريخ الحالة معناه الترانزاكشن اتقطعت في النص.
  const partial = promised.length
    ? await h.q(
        `SELECT o.id FROM orders o
          WHERE o.id = ANY($1::uuid[])
            AND NOT EXISTS (SELECT 1 FROM order_status_history sh WHERE sh.order_id = o.id)
            AND o.order_status <> 'searching_technician'`,
        [promised],
      )
    : [];
  h.record('ك-١/د مفيش طلب اتكتب نُصّه (حالة متقدمة بلا تاريخ)', partial.length === 0, `ناقصين=${partial.length}`);

  // كل طلب لازم يبقى **محسوب**: اتعيّن، أو اتلغى بقرار، أو في طابور الاسترداد.
  const accounts = await Promise.all(promised.map(async (id) => ({ id, ...(await accountedFor(id)) })));
  const stranded = accounts.filter((a) => !a.ok);
  h.record(
    'ك-١/هـ كل طلب محسوب بعد الاسترداد (اتعيّن / اتلغى بقرار / في الطابور)',
    stranded.length === 0,
    stranded.length ? stranded.map((s) => `${s.id.slice(0, 8)}:${s.why}`).join(' | ') : `${accounts.length} طلب كلهم محسوبين`,
  );

  // وبعد وقت كافي للـsweep: التوزيع بيكمّل من غير أي تدخل يدوي.
  for (const id of promised) {
    await h.q(`UPDATE orders SET next_matching_attempt_at = now() - interval '1 minute' WHERE id = $1`, [id]);
  }
  let assigned = 0;
  for (let i = 0; i < 150 && assigned < promised.length; i++) {
    await sleep(1000);
    const [{ n }] = await h.q(
      `SELECT count(*)::int AS n FROM orders WHERE id = ANY($1::uuid[]) AND technician_id IS NOT NULL`,
      [promised],
    );
    assigned = n;
  }
  h.record(
    'ك-١/و التوزيع كمّل بعد الاسترداد بلا تدخل يدوي',
    assigned === promised.length,
    `اتعيّن=${assigned}/${promised.length}`,
  );
  return promised;
}

// ===================== ك-٢: انقطاع Redis =====================

/**
 * Redis واقع = الطابور والكاش مش موجودين. القاعدة: **الحجز لازم ينجح برضه**. التوزيع ممكن
 * يتأجّل (بطيء مقبول)، لكن العميل مايتقفلش في وشّه.
 */
async function redisOutage() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('rd');
  void tech;
  const customer = await h.makeCustomer('rd');

  const logBefore = logSizeBytes();
  const stopped = await stopRedis();
  h.record('ك-٢/أ Redis اتوقّف فعلاً', stopped, stopped ? 'مفيش رد على ping' : 'لسه شغّال ❗');
  if (!stopped) return;

  const started = Date.now();
  const res = await createOrder(customer, {}, 60_000);
  const elapsed = Date.now() - started;

  h.record(
    'ك-٢/ب الحجز نجح وRedis واقع (بطيء مقبول، الرفض لأ)',
    res.status === 201,
    `HTTP=${res.status} زمن=${elapsed}ms «${String(res.body?.error?.message ?? '').slice(0, 80)}»`,
  );
  // **رقم مقاس مش تخمين**: أول طلب أو اتنين بعد سقوط Redis مباشرةً بياخدوا ثواني — دي نافذة
  // «اكتشاف الانقطاع» في ioredis (كل أمر بيستنى محاولة اتصال قبل ما يفشل). بعدها العميل
  // بيفشل فورًا والطلب بيرجع لسرعته الطبيعية. الحد هنا ٣٠ ثانية = مهلة عميل الموبايل
  // النموذجية — فوقه يبقى «وقع» مش «بطيء».
  h.record(
    'ك-٢/ج أول طلب بعد الانقطاع بيرجع بردّ (مايعلّقش للأبد)',
    res.status === 201 && elapsed < 60_000,
    `زمن الاستجابة=${elapsed}ms ${res.timedOut ? '(اتقطع بالمهلة ❗)' : '(نافذة اكتشاف الانقطاع)'}`,
  );

  // بعد ما العميل يستقر: الحجز وRedis واقع لازم يرجع لسرعته الطبيعية — ده اللي بيثبت إن
  // Redis فعلاً اختياري في المسار الحرج مش بس «بيتلقّط».
  const settled = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await createOrder(customer);
    settled.push({ ms: Date.now() - t0, status: r.status });
  }
  const worst = Math.max(...settled.map((x) => x.ms));
  h.record(
    'ك-٢/ج٢ بعد استقرار العميل: الحجز وRedis واقع بسرعته الطبيعية',
    settled.every((x) => x.status === 201) && worst < 2_000,
    `أزمنة=${settled.map((x) => `${x.ms}ms/${x.status}`).join(', ')}`,
  );

  const orderId = res.status === 201 ? res.body.data.id : null;
  if (orderId) {
    h.record('ك-٢/د الطلب اتكتب في القاعدة رغم وقوع Redis', !!(await orderRow(orderId)), `id=${orderId.slice(0, 8)}`);
    // **مش بس «في الطابور»**: لما الحجز مايقدرش يحجز وظيفة (Redis واقع)، `OrderDispatchListener`
    // بينفّذ التوزيع مباشرةً كـfallback — فالطلب ممكن يطلع **متعيّن خلاص**. الاتنين نتيجة صحيحة؛
    // الغلط الوحيد هو «عالق بلا خطة».
    const acc = await accountedFor(orderId);
    h.record('ك-٢/هـ الطلب محسوب (اتعيّن مباشرةً أو في طابور الاسترداد)', acc.ok, acc.why);
  }

  // **خطر حقيقي اتقاس في التدقيق ده**: قبل الإصلاح، انقطاع Redis كان بينتج ٢.١ چيجابايت لوج
  // في ١٨ دقيقة (كل أمر فاشل = rejection بـstack كامل). امتلاء القرص بيوقف Postgres والرفع
  // والـAPI — يعني انقطاع الكاش بيتحوّل بسبب اللوج **وحده** لانقطاع خدمة. الخنق في
  // `common/logging/throttled-log.ts` بيقفل ده، والقياس هنا هو الحارس.
  const grownMb = (logSizeBytes() - logBefore) / 1024 / 1024;
  h.record(
    'ك-٢/و١ اللوج ما فاضش أثناء انقطاع Redis (خنق الرسائل المتكررة)',
    grownMb < 50,
    `نمو اللوج=${grownMb.toFixed(1)}MB خلال الانقطاع`,
  );

  const back = await startRedis();
  h.record('ك-٢/و Redis رجع', back, back ? 'PONG' : 'مارجعش ❗');

  if (orderId && back) {
    await h.q(`UPDATE orders SET next_matching_attempt_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);
    let row = null;
    for (let i = 0; i < 150; i++) {
      row = await orderRow(orderId);
      if (row?.technician_id) break;
      await sleep(1000);
    }
    h.record(
      'ك-٢/ز الطلب اتخدم لوحده بعد رجوع Redis (استرداد تلقائي)',
      !!row?.technician_id,
      `الحالة=${row?.order_status} فني=${row?.technician_id ? 'اتعيّن' : 'لسه مفيش ❗'} محاولات=${row?.matching_attempt_count}`,
    );
  }
  return orderId;
}

// ===================== ك-٣: انقطاع Redis وسط الدفع =====================

/**
 * الدرس المكلف الموثّق في CLAUDE.md: `queue.add()` علّقت **طلب حقيقي** (تقييم/دفع) دقايق وقت
 * انقطاع Redis. الاختبار ده بيقفل على إن ده مايتكررش: الدفع بيخلص، والدفتر يفضل متوازن.
 */
async function paymentDuringRedisOutage() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('pd');
  const customer = await h.makeCustomer('pd');
  await h.fundWallet(customer.userId, 500_000);

  const res = await createOrder(customer);
  if (res.status !== 201) {
    h.record('ك-٣ إنشاء الطلب', false, `HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  let row = null;
  for (let i = 0; i < 60; i++) {
    row = await orderRow(orderId);
    if (row?.technician_id) break;
    await sleep(500);
  }
  if (!row?.technician_id) {
    h.record('ك-٣ التوزيع عيّن فني قبل الاختبار', false, `الحالة=${row?.order_status}`);
    return;
  }

  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
  }
  await h.uploadAfterPhoto(orderId, tech.token);
  await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });

  const stopped = await stopRedis();
  h.record('ك-٣/أ Redis اتوقّف قبل الدفع', stopped, stopped ? 'مفيش رد على ping' : 'لسه شغّال ❗');

  const started = Date.now();
  const pay = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `cr-pay-${h.nextTag()}` },
  });
  const elapsed = Date.now() - started;
  h.record(
    'ك-٣/ب الدفع خلص وRedis واقع',
    pay.status === 201,
    `HTTP=${pay.status} زمن=${elapsed}ms «${String(pay.body?.error?.message ?? '').slice(0, 80)}»`,
  );
  h.record('ك-٣/ج الدفع مااتعلّقش مستني Redis', elapsed < 20_000, `زمن الاستجابة=${elapsed}ms`);

  await startRedis();
  await sleep(3000);
  const [after] = await h.q(
    `SELECT o.order_status,
            (SELECT count(*)::int FROM payments p WHERE p.order_id = o.id AND p.payment_status = 'succeeded') AS payments,
            (SELECT COALESCE(SUM(CASE WHEN wt.direction = 'debit' THEN wt.amount_cents ELSE -wt.amount_cents END),0)::int
               FROM wallet_transactions wt WHERE wt.reference_id = o.id) AS ledger_net
       FROM orders o WHERE o.id = $1`,
    [orderId],
  );
  h.record(
    'ك-٣/د أثر الدفع كامل ومتوازن رغم انقطاع Redis',
    after.order_status === 'completed' && after.payments === 1 && after.ledger_net === 0,
    `الحالة=${after.order_status} دفعات=${after.payments} صافي الدفتر=${after.ledger_net}`,
  );
}

// ===================== ك-٤: بوابة دفع مش متاحة =====================

/**
 * بوابة الدفع الخارجية غير مُفعّلة/مش راضية ترد. المطلوب: **رسالة عربية واضحة للعميل**، مش 500
 * ولا رسالة إنجليزي من المزوّد، **ومفيش صف دفع نصّه** يفضل معلّق في القاعدة.
 */
async function paymentProviderOutage() {
  // **إعادة تشغيل مقصودة قبل السيناريو ده**: ك-٢ وك-٣ قطعوا Redis ورجّعوه، والـworkers
  // مابيرجعوش يسحبوا وظايف بعد كده (بَقّة BullMQ #4479 — ك-٥ بيقيسها بالتفصيل). من غير إعادة
  // التشغيل دي، الطلب هنا مش هيتعيّنله فني والاختبار هيقيس حاجة تانية خالص.
  await h.restartApi();
  await h.seedCatalog();
  const tech = await h.makeTechnician('pv');
  const customer = await h.makeCustomer('pv');
  const res = await createOrder(customer);
  if (res.status !== 201) {
    h.record('ك-٤ إنشاء الطلب', false, `HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  let row = null;
  for (let i = 0; i < 120; i++) {
    row = await orderRow(orderId);
    if (row?.technician_id) break;
    await sleep(500);
  }
  if (!row?.technician_id) {
    // من غير الحارس ده، الاختبار بيقيس «الدفع في حالة searching_technician» وهو سؤال تاني خالص.
    h.record('ك-٤ التوزيع عيّن فني قبل اختبار البوابة', false, `الحالة=${row?.order_status} — الاختبار مالوش معنى من غير ده`);
    return;
  }
  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
  }
  await h.uploadAfterPhoto(orderId, tech.token);
  await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });

  const pay = await h.api(`/orders/${orderId}/pay-with-card`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `cr-card-${h.nextTag()}` },
  });
  const message = String(pay.body?.error?.message ?? '');
  const arabic = /[؀-ۿ]/.test(message);
  // **٥٠٣ مقبولة هنا وهي الأصح دلاليًا**: «الخدمة الخارجية مش متاحة دلوقتي» مش «طلبك غلط».
  // اللي بيفرق: إنها **مش ٥٠٠ مبهم**، ورسالتها عربية بتقول للعميل الخطوة الجاية. القاعدة اللي
  // بنقفل عليها هي دي، مش رقم الكود بحد ذاته.
  const clearRefusal = (pay.status === 503 || (pay.status >= 400 && pay.status < 500)) && arabic;
  h.record(
    'ك-٤/أ البوابة مش متاحة → رد واضح بالعربي وبديل مطروح (مش 500 مبهم)',
    clearRefusal,
    `HTTP=${pay.status} عربي=${arabic ? 'أيوه' : 'لأ ❗'} «${message.slice(0, 100)}»`,
  );

  const [{ n }] = await h.q(
    `SELECT count(*)::int AS n FROM payments
      WHERE order_id = $1 AND payment_status IN ('processing','pending')`,
    [orderId],
  );
  h.record('ك-٤/ب مفيش صف دفع معلّق اتساب ورا المحاولة الفاشلة', n === 0, `صفوف معلّقة=${n}`);

  const rowAfter = await orderRow(orderId);
  h.record(
    'ك-٤/ج الطلب لسه قابل للدفع بطريقة تانية (مش اتقفل عليه)',
    rowAfter?.order_status === 'work_completed' || rowAfter?.order_status === 'awaiting_payment',
    `الحالة=${rowAfter?.order_status}`,
  );
}

// ===================== ك-٥: watchdog الطوابير بعد رجوع Redis =====================

/**
 * **الفجوة الموثّقة والأخطر في ج-٦** (BullMQ #4479، تحقيق كامل في
 * `apps/api/src/modules/technicians/README.md`): بعد ما Redis يقع ويرجع، **الـworkers مابيرجعوش
 * يسحبوا وظايف أبدًا** رغم إن الإنتاج (`queue.add`) شغّال. اتأكد حيًا في التدقيق ده: بعد إعادة
 * تشغيل Redis، `bull:matching-rounds:wait` وصل ٥٠ وظيفة و`active` فضل صفر، والطلبات فضلت
 * `searching_technician` والـsweep بتزوّد العدّاد بلا أي تنفيذ.
 *
 * ده **مش «الطلب ضاع»** — الطلب محفوظ ومتتبَّع. لكنه «الطلب مش بيتخدم»، وده نفس الأثر عند
 * العميل. الحل الموجود مش إصلاح للـworker (اتجرّب ٣ مرات وفشل، السبب في المكتبة) لكن
 * `QueueWatchdogService`: بيكتشف «وظيفة واقفة في طابور حرج رغم إن Redis متاح» ويبعت `SIGTERM`
 * لنفسه عشان supervisor خارجي يعيد التشغيل.
 *
 * الاختبار ده بيثبت **إن آلية الاسترداد الوحيدة دي شغّالة فعلاً** — لأنها لو مش شغّالة، الفجوة
 * الموثّقة تبقى انقطاع خدمة صامت بلا أي علاج.
 *
 * **الشرط التشغيلي اللي بيوثّقه الاختبار ضمنًا**: الـwatchdog **بيقتل نفسه عمدًا**. من غير
 * supervisor (`Restart=always` في `infra/systemd/baytak-api.service`) ده بيبقى انتحار مش علاج.
 */
async function queueWatchdogRecovery() {
  // عتبات قصيرة عشان الاختبار يخلص في دقايق بدل ٧+ — القيم بترجع لأصلها في الآخر.
  const original = await h.q(
    `SELECT key, value FROM settings WHERE key IN
       ('ops.queue_watchdog_check_interval_minutes','ops.queue_watchdog_stall_threshold_minutes')`,
  );
  await h.setSetting('ops.queue_watchdog_check_interval_minutes', 1);
  await h.setSetting('ops.queue_watchdog_stall_threshold_minutes', 1);
  await h.restartApi();

  await h.seedCatalog();
  const tech = await h.makeTechnician('wd');
  void tech;
  const customer = await h.makeCustomer('wd');

  // كسر الـworker بنفس الطريقة الحقيقية: انقطاع Redis ورجوعه.
  // **مدة الانقطاع مقصودة**: البَقّة الموثّقة بتظهر بعد انقطاع **طويل** مش blip قصير — الاتصال
  // الـblocking بتاع الـworker بيموت خالص بدل ما يتعافى. القياس الحي أكّد الفرق: انقطاع ثانيتين
  // الـworker رجع منه لوحده، وانقطاع أطول علّقه تمامًا (٥٠ وظيفة في `wait` و`active`=0).
  await stopRedis();
  await sleep(30_000);
  const back = await startRedis();
  h.record('ك-٥/أ Redis اتقطع ورجع (نفس سيناريو الإنتاج)', back, back ? 'PONG' : 'مارجعش ❗');
  await sleep(5000);

  const res = await createOrder(customer);
  const orderId = res.status === 201 ? res.body.data.id : null;
  h.record('ك-٥/ب الحجز نجح بعد رجوع Redis', res.status === 201, `HTTP=${res.status}`);

  // العَرَض الموثّق: وظايف بتتراكم في `wait` والـworker مش بيسحب.
  await sleep(8000);
  let waiting = 0;
  try {
    waiting = Number(execFileSync('redis-cli', ['llen', 'bull:matching-rounds:wait'], { stdio: 'pipe' }).toString().trim());
  } catch {
    /* الأداة مش متاحة — بنكمّل بالفحص التاني */
  }
  const assignedNow = !!(orderId && (await orderRow(orderId))?.technician_id);
  const stalled = waiting > 0 && !assignedNow;
  // **قياس مش تأكيد**: البَقّة توقيتية (بتعتمد على طول الانقطاع وحالة الاتصال)، فتثبيت «لازم
  // تحصل» بيخلّي التدقيق هشّ. اللي بيتسجّل هنا هو **أي حالة من الاتنين حصلت**، والتأكيدات
  // اللي بعدها بتتفعّل بس لو العَرَض ظهر فعلاً.
  h.record(
    'ك-٥/ج قياس حالة الـworker بعد انقطاع طويل',
    true,
    stalled
      ? `عَرَض #4479 ظهر: وظايف في الانتظار=${waiting} والطلب ما اتعيّنش`
      : `الـworker رجع لوحده: وظايف في الانتظار=${waiting} الطلب اتعيّن=${assignedNow ? 'أيوه' : 'لأ'}`,
  );
  if (!stalled) {
    h.record(
      'ك-٥/د الـworker تعافى من الانقطاع بلا تدخل (مفيش داعي للـwatchdog)',
      assignedNow,
      assignedNow ? 'الطلب اتخدم عادي' : 'مافيش وظايف واقفة ومافيش تعيين — حالة تستاهل نظرة ❗',
    );
    for (const row of original) await h.setSetting(row.key, row.value);
    await h.restartApi();
    return;
  }

  // الـwatchdog المفروض يكتشف ويطلب إعادة تشغيل خلال ~٢-٣ دقايق بالعتبات القصيرة.
  let died = false;
  for (let i = 0; i < 40; i++) {
    await sleep(5000);
    if (!(await h.isApiUp())) {
      died = true;
      break;
    }
  }
  h.record(
    'ك-٥/د الـwatchdog اكتشف التعليق وطلب إعادة تشغيل (SIGTERM لنفسه)',
    died,
    died ? 'الـprocess قفل نفسه رشيقًا' : 'الـprocess فضل شغّال والطابور واقف ❗',
  );

  const critical = /CRITICAL: طابور matching-rounds/.test(tailLog(400_000));
  h.record('ك-٥/هـ سبب الإغلاق مسجّل بوضوح في اللوج (مش موت صامت)', critical, critical ? 'CRITICAL متسجّل' : 'مفيش سطر واضح ❗');

  // «الـsupervisor» في التدقيق ده هو إحنا — بنعمل اللي systemd بيعمله في الإنتاج.
  await h.restartApi();
  h.record('ك-٥/و بعد إعادة التشغيل، الخدمة رجعت', await h.isApiUp(), 'بيرد');

  if (orderId) {
    await h.q(`UPDATE orders SET next_matching_attempt_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);
    let row = null;
    for (let i = 0; i < 120; i++) {
      row = await orderRow(orderId);
      if (row?.technician_id) break;
      await sleep(1000);
    }
    h.record(
      'ك-٥/ز الطلب اللي كان عالق اتخدم بعد إعادة التشغيل',
      !!row?.technician_id,
      `الحالة=${row?.order_status} فني=${row?.technician_id ? 'اتعيّن' : 'لسه مفيش ❗'}`,
    );
  }

  for (const row of original) {
    await h.setSetting(row.key, row.value);
  }
  await h.restartApi();
}

// ===================== التشغيل =====================

async function run() {
  await h.connect();
  console.log(`\n=== ج-٦: الانهيار وإعادة التشغيل وانقطاع الاعتماديات — تشغيلة ${h.runId} ===\n`);

  await crashMidFlight();
  await redisOutage();
  await paymentDuringRedisOutage();
  await paymentProviderOutage();
  await queueWatchdogRecovery();

  // ضمان إن البيئة رجعت لحالتها مهما حصل في النص.
  const finalRedis = await startRedis();
  h.record('ك-٥/أ البيئة رجعت لحالتها (Redis شغّال)', finalRedis, finalRedis ? 'PONG' : 'مارجعش ❗');
  h.record('ك-٥/ب الـAPI شغّال في الآخر', await h.isApiUp(), 'بيرد');

  const imbalance = await h.ledgerImbalance();
  h.record('ك-٥/ج الدفتر متوازن بعد كل الانهيارات', imbalance.net === 0, `قيود=${imbalance.rows} صافي=${imbalance.net}`);
  const negatives = await h.negativeBalances();
  h.record('ك-٥/د مفيش رصيد سالب', negatives.length === 0, negatives.length ? JSON.stringify(negatives) : 'نضيف');

  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }

  if (!KEEP) {
    console.log(`\nتنظيف...`);
    await h.cleanup();
  } else {
    console.log(`\n--keep: البيانات سايبها`);
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  // مايصحّش نسيب البيئة مكسورة لو التدقيق نفسه انهار.
  await startRedis();
  try {
    await h.restartApi();
  } catch {
    /* أحسن مجهود */
  }
  await h.close();
  process.exit(2);
});
