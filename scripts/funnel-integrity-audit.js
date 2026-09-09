#!/usr/bin/env node
/**
 * **سلامة فنل الحجز — بلاغ المالك: أول خانتين دايمًا صفر**.
 *
 * ## ليه القاعدة وحدها مش دليل
 *
 * أول فحص للقاعدة في التطوير طلّع `order_placed` **وبس**. الاستنتاج السريع («المراحل مكسورة»)
 * كان هيبقى **غلط**: كل الترافيك في القاعدة دي جاي من سكريبتات تدقيق بتنادي `POST /orders`
 * على طول — من غير ما تفتح صفحة خدمة، ولا تطلب معاينة سعر، ولا تشوف فنيين. طبيعي إن المراحل
 * دي مالهاش صفوف: **محدش عملها أصلاً**.
 *
 * فالتدقيق ده بيمشي **رحلة عميل كاملة بنفس ترتيب التطبيق الحقيقي**، وبيقيس المراحل الخمسة
 * بعدها. ده الفرق بين «الجدول فاضي» و«التسجيل مكسور».
 *
 * ## المراحل ومين بيكتب كل واحدة
 *
 * | المرحلة | المصدر | إزاي بتتسجّل |
 * |---|---|---|
 * | `service_viewed` | كلاينت | `POST /analytics/funnel-events` |
 * | `booking_started` | كلاينت | نفس الـendpoint |
 * | `price_previewed` | سيرفر | `POST /orders/preview` |
 * | `providers_viewed` | سيرفر | `POST /orders/match-preview` |
 * | `order_placed` | سيرفر | `POST /orders` |
 *
 * الرابط بينهم كلهم هو هيدر `x-funnel-session` — من غيره كل حدث بيبقى جلسة لوحده والفنل
 * بيبقى أعمدة منفصلة مالهاش علاقة ببعض.
 *
 * ## اللي بيتقاس
 *
 * 1. كل مرحلة اتسجّلت **مرة واحدة بالظبط** — مش صفر (مكسورة) ومش اتنين (بتتحسب مرتين).
 * 2. تقرير الأدمن بيعرض نفس الأرقام (مش بس الجدول فيه صفوف).
 * 3. الفشل بيتسجّل كفشل مش كانسحاب، وبسبب **مفهوم** مش كود خام.
 *
 *   node scripts/funnel-integrity-audit.js [--keep]
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('fn');

/** جلسة الفنل — الخيط اللي بيربط كل مراحل الرحلة الواحدة. */
const SESSION = randomUUID();
const HDRS = { 'x-funnel-session': SESSION, 'x-client-channel': 'customer_app' };

async function stageCounts() {
  const rows = await h.q(
    `SELECT stage, outcome, count(*)::int AS n
       FROM booking_funnel_events
      WHERE funnel_session_id = $1
      GROUP BY stage, outcome`,
    [SESSION],
  );
  const map = new Map();
  for (const r of rows) map.set(`${r.stage}:${r.outcome}`, r.n);
  return map;
}

function messageOf(body) {
  return String(body?.message ?? body?.error?.message ?? '').slice(0, 120);
}

async function run() {
  await h.connect();
  console.log(`\n=== سلامة فنل الحجز — تشغيلة ${h.runId} (جلسة ${SESSION.slice(0, 8)}) ===\n`);
  await h.seedCatalog();
  const customer = await h.makeCustomer('fn');
  const tech = await h.makeTechnician('fn');
  await h.fundWallet(customer.userId, 1_000_000);
  const admin = await h.makeAdmin();

  // ── ف-١: مراحل الكلاينت ──────────────────────────────────────────────
  //
  // دول بالظبط الخانتين اللي المالك بيقول إنهم دايمًا صفر. الـendpoint مفتوح بلا مصادقة عمدًا
  // («شاف الخدمة» بيحصل قبل تسجيل الدخول).
  for (const stage of ['service_viewed', 'booking_started']) {
    const res = await h.api('/analytics/funnel-events', {
      method: 'POST',
      headers: HDRS,
      body: { stage, service_id: h.catalog.service.id },
    });
    h.record(
      `ف-١ الكلاينت سجّل «${stage}»`,
      res.status === 204 || res.status === 201 || res.status === 200,
      `HTTP=${res.status} ${messageOf(res.body)}`,
    );
  }

  // ── ف-٢: مراحل السيرفر ───────────────────────────────────────────────
  const scheduledAt = h.nextDay();
  const preview = await h.api('/orders/preview', {
    method: 'POST',
    token: customer.token,
    headers: HDRS,
    body: { service_id: h.catalog.service.id, address_id: customer.addressId, scheduled_at: scheduledAt },
  });
  h.record('ف-٢/أ معاينة السعر نجحت (بتسجّل price_previewed)', preview.status === 200 || preview.status === 201, `HTTP=${preview.status} ${messageOf(preview.body)}`);

  const match = await h.api('/orders/match-preview', {
    method: 'POST',
    token: customer.token,
    headers: HDRS,
    // `selection_mode` مطلوب في `CreateBookingMatchPreviewDto` — من غيره الـDTO بيرفض بـ400
    // والمرحلة بتتسجّل كـ«فشل» بدل ما تتسجّل كنجاح، فالفحص بيتهم كودًا سليمًا.
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: scheduledAt,
      selection_mode: 'auto',
    },
  });
  h.record('ف-٢/ب معاينة الفنيين نجحت (بتسجّل providers_viewed)', match.status === 200 || match.status === 201, `HTTP=${match.status} ${messageOf(match.body)}`);

  const order = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { ...HDRS, 'Idempotency-Key': `fn-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: scheduledAt,
      problem_description: 'تدقيق سلامة الفنل',
    },
  });
  h.record('ف-٢/ج الطلب اتعمل (بيسجّل order_placed)', order.status === 201, `HTTP=${order.status} ${messageOf(order.body)}`);

  // التسجيل detached (مابيعطّلش رد العميل) — فلازم مهلة قصيرة قبل القراءة.
  await sleep(1500);

  // ── ف-٣: كل مرحلة **مرة واحدة بالظبط** ───────────────────────────────
  //
  // صفر = التسجيل مكسور. اتنين = بيتحسب مرتين (وده بيضخّم الفنل ويخلّي قرار تسويقي يتبني على
  // رقم مضروب). الاتنين بيتقاسوا هنا بنفس الفحص.
  const counts = await stageCounts();
  for (const stage of ['service_viewed', 'booking_started', 'price_previewed', 'providers_viewed', 'order_placed']) {
    const n = counts.get(`${stage}:success`) ?? 0;
    h.record(
      `ف-٣ «${stage}» اتسجّلت مرة واحدة بالظبط`,
      n === 1,
      n === 0 ? 'صفر — التسجيل مكسور ❗' : n === 1 ? 'مرة واحدة ✓' : `${n} مرات — بتتحسب مرتين ❗`,
    );
  }

  // ── ف-٤: تقرير الأدمن بيعرض نفس الأرقام ──────────────────────────────
  //
  // الجدول ممكن يبقى مليان والتقرير لسه بيعرض صفر (فلترة/تجميع غلط) — فالقياس على التقرير
  // نفسه، مش على القاعدة بس.
  // **المدى نصف مفتوح** (`occurred_at >= from AND < to`) و`resolveRange` بيحوّل تاريخ بلا وقت
  // لمنتصف الليل. يعني `from=to=النهارده` = نافذة **فاضية**، وكل المراحل بترجع صفر — وده
  // بالظبط اللي خلّى أول تشغيلة تتهم التقرير وهو سليم. الصح: من إمبارح لبكرة.
  const dayMs = 86_400_000;
  const from = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const to = new Date(Date.now() + dayMs).toISOString().slice(0, 10);
  const report = await h.api(`/admin/analytics/funnel?from=${from}&to=${to}`, { token: admin.token });
  const stages = report.body?.data?.stages ?? [];
  h.record('ف-٤/أ تقرير الأدمن رجع بالمراحل', report.status === 200 && stages.length > 0, `HTTP=${report.status} مراحل=${stages.length}`);

  for (const name of ['service_viewed', 'booking_started']) {
    const row = stages.find((s) => s.stage === name);
    h.record(
      `ف-٤/ب «${name}» ظاهرة بعدد > 0 في التقرير (البلاغ الأصلي)`,
      (row?.count ?? 0) > 0,
      `count=${row?.count ?? 'مش موجودة'} trust=${row?.trust ?? '-'}`,
    );
  }

  // **المراحل المشتقة مستحيل تتعدّى الطلبات نفسها.**
  //
  // مقارنة الخمس مراحل المسجّلة ببعضها على مدى الشهر **مش فحص صالح**: النافذة فيها ترافيك
  // سكريبتات تدقيق تانية بتنادي `POST /orders` مباشرةً بلا أي مرحلة قبلها، فالفنل بيطلع
  // صاعد لسبب مالوش علاقة بالكود (هي دي اللي كانت بتفشل قبل كده وتتهم كود سليم).
  //
  // اللي **له معنى** على مستوى النافذة هو النص التاني: `technician_assigned` و`arrived`
  // و`completed` كلهم مشتقين من نفس مجموعة الطلبات اللي `order_placed` بيعدّها، فأي واحد
  // فيهم أكبر منه = وحدتين عد مختلفتين (البَقّة اللي `COALESCE(order_id, …)` اتحطت لها).
  const placedCount = stages.find((s) => s.stage === 'order_placed')?.count ?? 0;
  const derivedOver = ['technician_assigned', 'technician_arrived', 'order_completed']
    .map((s) => ({ s, n: stages.find((x) => x.stage === s)?.count ?? 0 }))
    .filter((r) => r.n > placedCount);
  h.record(
    'ف-٤/ج المراحل المشتقة مابتتعدّاش الطلبات (نفس وحدة العد)',
    derivedOver.length === 0,
    derivedOver.length
      ? `أكبر من order_placed(${placedCount}): ${derivedOver.map((r) => `${r.s}=${r.n}`).join(', ')}`
      : `order_placed=${placedCount} وكل المشتق تحته`,
  );

  // والفحص التنازلي بيتعمل على **جلستي أنا بس** — رحلة واحدة كاملة، فالنتيجة حتمية.
  const order5 = ['service_viewed', 'booking_started', 'price_previewed', 'providers_viewed', 'order_placed'];
  const mine = order5.map((s) => counts.get(`${s}:success`) ?? 0);
  h.record(
    'ف-٤/د رحلة الجلسة نفسها متناقصة (١ لكل مرحلة، مفيش مرحلة زادت)',
    mine.every((c, i) => i === 0 || c <= mine[i - 1]),
    mine.join(' ← '),
  );

  // ── ف-٥: الفشل بسبب مفهوم ────────────────────────────────────────────
  //
  // طلب بتاريخ ماضي بيترفض — لازم يتسجّل كـ`failed` بسبب **مقروء**، مش كود خام زي `VAL_001`.
  const badOrder = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { ...HDRS, 'Idempotency-Key': `fn-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: '2020-01-01T09:00:00.000Z',
      problem_description: 'فشل متعمّد لقياس تسجيل السبب',
    },
  });
  await sleep(1200);
  const after = await stageCounts();
  h.record(
    'ف-٥/أ المحاولة الفاشلة اتسجّلت كفشل مش كانسحاب',
    (after.get('order_placed:failed') ?? 0) === 1,
    `HTTP=${badOrder.status} فشل مسجّل=${after.get('order_placed:failed') ?? 0}`,
  );

  const [reason] = await h.q(
    `SELECT failure_reason FROM booking_funnel_events
      WHERE funnel_session_id = $1 AND outcome = 'failed' LIMIT 1`,
    [SESSION],
  );
  const raw = String(reason?.failure_reason ?? '');
  // **القاعدة بتفضل تخزّن الكود الخام عن قصد** (بيتجمّع بـ`GROUP BY`؛ نص فيه اسم خدمة أو مبلغ
  // بيخلّي كل صف فريد فالتجميع بلا معنى). الشرط إن اللوحة تعرف تترجمه — يعني الكود المسجّل
  // موجود في خريطة الأسماء المشتركة، مش إن القاعدة تخزّن عربي.
  const { funnelFailureLabelAr } = require('@baytak/shared-types');
  const label = raw ? funnelFailureLabelAr(raw) : '';
  h.record(
    'ف-٥/ب سبب الفشل بيتعرض بجملة مفهومة مش كود خام (بلاغ المالك)',
    /[؀-ۿ]/.test(label) && !label.startsWith('سبب غير معروف'),
    `الكود المسجّل: "${raw}" ← المعروض: "${label}"`,
  );

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
    await h.q(`DELETE FROM booking_funnel_events WHERE funnel_session_id = $1`, [SESSION]).catch(() => {});
    await h.cleanup();
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await h.close().catch(() => {});
  process.exit(2);
});
