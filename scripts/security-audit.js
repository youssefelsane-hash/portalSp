#!/usr/bin/env node
/**
 * **ج-٨ — تدقيق أمني**: «IDOR، صلاحيات (موظف ≠ أدمن)، endpoints بلا مصادقة، أسرار في الريبو
 * أو في باندل Flutter».
 *
 * المنهج هنا مختلف عن «مراجعة كود أمنية»: كل بند بيتحوّل لمحاولة **هجوم حقيقية** على API شغّال.
 * مراجعة الكود بتقول «الحارس موجود»؛ المحاولة الحقيقية بتقول «الحارس اشتغل». الفرق ده هو اللي
 * بيمسك الحالة اللي الحارس متسجّل فيها بس مش متطبّق على المسار ده بالذات.
 *
 * **قاعدة القراءة**: أي نجاح هنا معناه «الهجمة اتصدّت»، مش «الهجمة نجحت».
 *
 *   node scripts/security-audit.js [--keep]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { LiveHarness, sleep, ROOT } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('sec');

/** أكواد «اتصدّ» المقبولة: 401 مش مصادق، 403 مش مصرّح، 404 إخفاء الوجود (وده مقبول ضد IDOR). */
const DENIED = [401, 403, 404];

/**
 * فحص IDOR واحد: المهاجم بيحاول يوصل لمورد الضحية.
 *
 * **ليه 404 مقبولة زي 403**: إخفاء وجود المورد أصلاً (`404`) أقوى أمنيًا من الاعتراف بوجوده
 * ورفض الوصول (`403`) — الاتنين بيمنعوا التسريب، و404 كمان بتمنع عدّ الموارد.
 */
async function idor(name, pathname, { token, method = 'GET', body, headers, leakNeedles = [] } = {}) {
  const res = await h.api(pathname, { method, token, body, headers });
  const raw = JSON.stringify(res.body ?? {});
  const leaked = leakNeedles.filter((n) => n && raw.includes(n));
  const ok = DENIED.includes(res.status) && leaked.length === 0;
  h.record(
    name,
    ok,
    ok
      ? `HTTP=${res.status} (اتصدّ)`
      : `HTTP=${res.status}${leaked.length ? ` — سرّب: ${leaked.join('، ')} ❗` : ' — عدّى ❗'}`,
  );
  return ok;
}

/** فحص صلاحية: موظف من غير الصلاحية دي لازم يترفض (403 تحديدًا — هو مصادق فعلاً). */
async function rbac(name, pathname, { token, method = 'GET', body, headers } = {}) {
  const res = await h.api(pathname, { method, token, body, headers });
  const ok = res.status === 403 || res.status === 401;
  h.record(name, ok, ok ? `HTTP=${res.status} (اترفض)` : `HTTP=${res.status} — عدّى بلا صلاحية ❗`);
  return ok;
}

async function createOrder(customer, extra = {}) {
  const res = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق أمني',
      ...extra,
    },
  });
  if (res.status !== 201) throw new Error(`فشل إنشاء الطلب: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body.data;
}

async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const [row] = await h.q(`SELECT technician_id, order_status FROM orders WHERE id = $1`, [orderId]);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return null;
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-٨: تدقيق أمني — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();

  // ============ أ: IDOR — عميل ضد عميل ============
  //
  // ده أخطر تصنيف في التطبيقات دي: كل الحُرّاس ممكن تكون موجودة والمصادقة سليمة، ولسه المستخدم
  // «أ» يقرا بيانات المستخدم «ب» لمجرّد إنه عارف الـid. المهاجم هنا **مستخدم حقيقي مسجّل**
  // بتوكن صالح — مش مجهول.
  const victim = await h.makeCustomer('victim');
  const attacker = await h.makeCustomer('attacker');
  const tech = await h.makeTechnician('t1');
  const stranger = await h.makeTechnician('t2');

  await h.fundWallet(victim.userId, 500_000);
  const vOrder = await createOrder(victim);
  const assigned = await waitAssigned(vOrder.id);
  h.record('أ-٠ تجهيز: طلب الضحية اتعيّن لفني', !!assigned?.technician_id, assigned ? 'اتعيّن' : 'ماتعيّنش ❗');

  const [vUser] = await h.q(`SELECT phone_number, full_name FROM users WHERE id = $1`, [victim.userId]);
  const needles = [vUser.phone_number, vOrder.order_number].filter(Boolean);

  await idor('أ-١ عميل بيقرا طلب عميل تاني', `/orders/${vOrder.id}`, {
    token: attacker.token,
    leakNeedles: needles,
  });
  await idor('أ-٢ عميل بيلغي طلب عميل تاني', `/orders/${vOrder.id}/cancel`, {
    token: attacker.token,
    method: 'POST',
    body: { cancellation_reason_id: null },
  });
  // **الهيدر مطلوب عمدًا**: من غيره النداء بيترفض 400 على التحقق قبل ما يوصل لفحص الملكية أصلاً،
  // فالفحص بيبقى فاضي — بيقيس تحقق DTO مش حارس أمني. (اتلقط في أول تشغيلة: 400 كان بيتقرا كأنه
  // «عدّى» وهو أصلاً ماوصلش.)
  await idor('أ-٣ عميل بيدفع من محفظته على طلب عميل تاني', `/orders/${vOrder.id}/pay-with-wallet`, {
    token: attacker.token,
    method: 'POST',
    headers: { 'Idempotency-Key': `sec-${h.nextTag()}` },
  });
  await idor('أ-٤ عميل بيقرا عنوان عميل تاني', `/addresses/${victim.addressId}`, { token: attacker.token });
  await idor('أ-٥ عميل بيعدّل عنوان عميل تاني', `/addresses/${victim.addressId}`, {
    token: attacker.token,
    method: 'PATCH',
    body: { street_name: 'اختراق' },
  });
  await idor('أ-٦ عميل بيقرا رسايل شات طلب عميل تاني', `/orders/${vOrder.id}/messages`, {
    token: attacker.token,
    leakNeedles: needles,
  });
  await idor('أ-٧ عميل بيبعت رسالة في شات طلب عميل تاني', `/orders/${vOrder.id}/messages`, {
    token: attacker.token,
    method: 'POST',
    body: { content: 'اختراق' },
  });
  await idor('أ-٨ عميل بيقرا صور طلب عميل تاني', `/orders/${vOrder.id}/media`, {
    token: attacker.token,
    leakNeedles: needles,
  });
  await idor('أ-٩ عميل بيقيّم طلب عميل تاني', `/orders/${vOrder.id}/rating`, {
    token: attacker.token,
    method: 'POST',
    body: { rating: 1, comment: 'اختراق' },
  });

  // القايمة مش IDOR بمعرّف — هي **تسريب بالنطاق**: لو الفلترة بالمستخدم ناقصة، طلبات الضحية
  // بتظهر في قايمة المهاجم من غير ما يعرف أي id أصلاً. ده أخطر لأنه مايحتاجش استكشاف.
  const list = await h.api('/orders?limit=50', { token: attacker.token });
  const listRaw = JSON.stringify(list.body ?? {});
  h.record(
    'أ-١٠ قايمة طلبات المهاجم مافيهاش ولا طلب للضحية (تسريب بالنطاق)',
    list.status === 200 && !listRaw.includes(vOrder.id),
    list.status === 200 ? (listRaw.includes(vOrder.id) ? 'طلب الضحية ظهر ❗' : 'نظيفة') : `HTTP=${list.status}`,
  );

  // ============ ب: IDOR — فني ضد فني/طلب مش بتاعه ============
  await idor('ب-١ فني غريب بيقرا طلب مش متعيّن له', `/technician/orders/${vOrder.id}`, {
    token: stranger.token,
    leakNeedles: needles,
  });
  await idor('ب-٢ فني غريب بيقول «في الطريق» لطلب مش بتاعه', `/technician/orders/${vOrder.id}/depart`, {
    token: stranger.token,
    method: 'POST',
  });
  await idor('ب-٣ فني غريب بيقفل طلب مش بتاعه', `/technician/orders/${vOrder.id}/complete`, {
    token: stranger.token,
    method: 'POST',
  });
  await idor('ب-٤ فني بيقرا أرباح فني تاني', `/technician/earnings?technician_id=${tech.id}`, {
    token: stranger.token,
    leakNeedles: [],
  }).catch(() => {});

  // ============ ج: عبور الأدوار — عميل/فني على مسارات الأدمن ============
  //
  // `@Roles(UserType.ADMIN)` على الكنترولر بيمنع ده. الفحص هنا إن **كل** مسار أدمن حسّاس فعلاً
  // متغطّى — مش الكنترولر اللي حد فكّر فيه.
  const adminPaths = [
    ['/admin/orders', 'GET'],
    ['/admin/technicians', 'GET'],
    ['/admin/customers', 'GET'],
    ['/admin/employees', 'GET'],
    ['/admin/roles', 'GET'],
    ['/admin/settings', 'GET'],
    ['/admin/audit-logs', 'GET'],
    ['/admin/ops/health-metrics', 'GET'],
    ['/admin/payouts', 'GET'],
    ['/admin/wallets', 'GET'],
    ['/admin/analytics/kpis', 'GET'],
    ['/admin/security/events', 'GET'],
  ];
  let crossed = [];
  for (const [p, method] of adminPaths) {
    for (const [who, token] of [['عميل', attacker.token], ['فني', stranger.token]]) {
      const res = await h.api(p, { method, token });
      if (!DENIED.includes(res.status)) crossed.push(`${who}→${p}=${res.status}`);
    }
  }
  h.record(
    'ج-١ ولا عميل ولا فني بيعدّي على أي مسار أدمن',
    crossed.length === 0,
    crossed.length ? `عدّى: ${crossed.join('، ')} ❗` : `${adminPaths.length} مسار × ٢ دور = كلهم اتصدّوا`,
  );

  const anonPaths = adminPaths.map(([p]) => p);
  let anonCrossed = [];
  for (const p of anonPaths) {
    const res = await h.api(p);
    if (!DENIED.includes(res.status)) anonCrossed.push(`${p}=${res.status}`);
  }
  h.record(
    'ج-٢ مجهول (بلا توكن) مابيعدّيش على أي مسار أدمن',
    anonCrossed.length === 0,
    anonCrossed.length ? `عدّى: ${anonCrossed.join('، ')} ❗` : `${anonPaths.length} مسار كلهم 401/403`,
  );

  // ============ د: موظف ≠ أدمن — الصلاحيات الدقيقة ============
  //
  // ده البند اللي المالك سمّاه «employee↛admin». الموظف هنا **مصادق كأدمن-تايب** وعنده دور
  // حقيقي بصلاحية `orders.view` وبس. أي مسار تاني لازم يترفض بـ403 — مش 200.
  const employee = await h.makeEmployee(['orders.view'], 'viewer');
  // **الفحص ده مش تجميلي**: من غيره، سيرفر بيرفض كل حاجة لكل حد كان هيعدّي كل فحوصات «د» تحته
  // بامتياز. لازم نثبت إن الحجب انتقائي مش أعمى.
  const allowed = await h.api('/admin/orders?page=1&per_page=5', { token: employee.token });
  h.record(
    'د-٠ الموظف بيقدر يعمل اللي مصرّح له بيه (الفحص مش بيقيس حجب أعمى)',
    allowed.status === 200,
    `GET /admin/orders = ${allowed.status}`,
  );

  await rbac('د-١ موظف «عرض طلبات» مايقدرش يشوف الموظفين', '/admin/employees', { token: employee.token });
  await rbac('د-٢ موظف «عرض طلبات» مايقدرش يعدّل الأدوار', '/admin/roles', { token: employee.token });
  // مسار حقيقي بمعرّف مستخدم موجود — `/admin/wallets` وحده مالوش handler، فكان بيرجع 404
  // «المسار مش موجود» وده فحص فاضي بيعدّي على طول (اتلقط في أول تشغيلة).
  await rbac('د-٣ موظف «عرض طلبات» مايقدرش يشوف محفظة مستخدم', `/admin/wallets/${victim.userId}`, {
    token: employee.token,
  });
  await rbac('د-٤ موظف «عرض طلبات» مايقدرش يعتمد صرف فلوس', '/admin/payouts', { token: employee.token });
  await rbac('د-٥ موظف «عرض طلبات» مايقدرش يقرا سجل التدقيق', '/admin/audit-logs', { token: employee.token });
  await rbac('د-٦ موظف «عرض طلبات» مايقدرش يقرا مقاييس التشغيل', '/admin/ops/health-metrics', {
    token: employee.token,
  });
  await rbac('د-٧ موظف «عرض طلبات» مايقدرش يغيّر الإعدادات', '/admin/settings/ops.alert_queue_failed', {
    token: employee.token,
    method: 'PATCH',
    body: { value: 1 },
    headers: { 'X-Step-Up-Token': await h.stepUpToken(employee.userId) },
  });
  await rbac('د-٨ موظف «عرض طلبات» مايقدرش يلغي طلب', `/admin/orders/${vOrder.id}/cancel`, {
    token: employee.token,
    method: 'POST',
    body: { reason: 'اختبار' },
  });

  // **تصعيد الامتياز الذاتي**: الموظف بيحاول يدّي دوره صلاحيات أعلى. حتى لو عنده `roles.manage`
  // (وهو مش عنده هنا)، ده لازم يترفض — بس الفحص ده بيقيس الحالة الأبسط والأخطر: بلا صلاحية خالص.
  await rbac('د-٩ موظف مايقدرش يضيف صلاحيات لدوره هو (تصعيد ذاتي)', `/admin/roles/${employee.roleId}/permissions`, {
    token: employee.token,
    method: 'PUT',
    body: { permission_names: ['roles.manage', 'wallets.adjust'] },
  });

  const [selfEsc] = await h.q(
    `SELECT count(*)::int AS n FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND p.name <> 'orders.view'`,
    [employee.roleId],
  );
  h.record(
    'د-١٠ ودوره فعلاً ما اتغيّرش في القاعدة (مش بس الرد كان 403)',
    selfEsc.n === 0,
    `صلاحيات زيادة على دوره=${selfEsc.n}`,
  );

  // ============ هـ: التوكنات — التزوير وانتحال الدور ============
  //
  // التوكن هو الحد الوحيد بين مستخدم ومستخدم. لو التوقيع مش متحقّق منه، كل اللي فوق بلا قيمة.
  const jwt = require(path.join(ROOT, 'node_modules/jsonwebtoken'));
  const forged = jwt.sign({ sub: attacker.userId, userType: 'admin', amr: ['otp'] }, 'wrong-secret-entirely', {
    expiresIn: '60m',
  });
  const forgedRes = await h.api('/admin/orders', { token: forged });
  h.record(
    'هـ-١ توكن متوقّع بسر غلط بيترفض',
    forgedRes.status === 401,
    `HTTP=${forgedRes.status}`,
  );

  // `alg: none` — هجمة كلاسيكية على مكتبات JWT المتساهلة.
  const noneToken = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
    JSON.stringify({ sub: attacker.userId, userType: 'admin' }),
  ).toString('base64url')}.`;
  const noneRes = await h.api('/admin/orders', { token: noneToken });
  h.record('هـ-٢ توكن بـalg=none بيترفض', noneRes.status === 401, `HTTP=${noneRes.status}`);

  // **الأخطر في القايمة**: توكن **صحيح التوقيع** بس بادّعاء دور أعلى. لو الباك-إند بيثق في
  // `userType` جوّه التوكن من غير ما يراجع نوع المستخدم الحقيقي في القاعدة، أي عميل بيبقى أدمن.
  const selfClaimedAdmin = h.token(attacker.userId, 'admin');
  const claimRes = await h.api('/admin/orders', { token: selfClaimedAdmin });
  h.record(
    'هـ-٣ عميل بتوكن صحيح بس مدّعي userType=admin بيترفض (الدور من القاعدة مش من التوكن)',
    DENIED.includes(claimRes.status),
    `HTTP=${claimRes.status}`,
  );

  const expired = jwt.sign(
    { sub: attacker.userId, userType: 'customer', amr: ['otp'] },
    require(path.join(ROOT, 'scripts/lib/live-harness')).JWT_SECRET,
    { expiresIn: '-1m' },
  );
  const expRes = await h.api('/orders?page=1&limit=1', { token: expired });
  h.record('هـ-٤ توكن منتهي بيترفض', expRes.status === 401, `HTTP=${expRes.status}`);

  // ============ و: المسارات العامة — مقصودة ومحدودة ============
  //
  // `@Public()` بيلغي `JwtAuthGuard`. القايمة دي **حصر كامل** من الكود؛ الفحص إن كل واحد فيها
  // مقصود (كتالوج/براندنج/دخول/webhook)، ومفيش أي مسار بيقرا أو يغيّر بيانات مستخدم.
  const publicList = execFileSync(
    'grep',
    ['-rn', '@Public()', path.join(ROOT, 'apps/api/src'), '--include=*.ts', '-l'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .map((f) => path.relative(path.join(ROOT, 'apps/api/src'), f));

  // كل ملف مسموح له يكون فيه `@Public()` مع السبب. أي ملف جديد خارج القايمة = الفحص بيسقط،
  // فإضافة `@Public()` على مسار جديد **لازم** تعدّي على مراجعة بشرية هنا.
  const EXPECTED_PUBLIC = new Set([
    'modules/auth/auth.controller.ts', // الدخول نفسه — قبل ما يبقى فيه توكن أصلاً
    'modules/auth/webauthn.controller.ts', // نفس السبب (مفاتيح المرور)
    'modules/catalog/catalog.controller.ts', // كتالوج عام بلا بيانات شخصية
    'modules/pricing/pricing.controller.ts', // تسعير تقديري قبل الدخول
    'modules/geo/geo.controller.ts', // مدن ومناطق
    'modules/branding/branding.controller.ts', // شعار وألوان
    'modules/settings/booking-policy.controller.ts',
    'modules/settings/homepage-content.controller.ts',
    'modules/settings/legal-entity.controller.ts',
    'modules/settings/support-contact.controller.ts',
    'modules/settings/trust-info.controller.ts',
    'modules/orders/cancellation-reasons.controller.ts', // قايمة أسباب ثابتة
    'modules/payment-policies/payment-policies.controller.ts',
    'modules/payments/webhooks.controller.ts', // البوابة الخارجية مالهاش JWT — الأمان بالتوقيع
    'modules/common/health/health.controller.ts', // liveness
    'modules/analytics/funnel-tracking.controller.ts', // حدث قبل الدخول — throttle مش مصادقة
    'modules/feature-flags/feature-flags.controller.ts', // تعليق «مفيش @Public هنا عمداً»
    // ── مراجعة 2026-09-11 ────────────────────────────────────────────────────────────────
    // التلاتة دول اتراجعوا سطر-بسطر: صفر بيانات شخصية في الرد، وصفر كتابة على أي كيان حقيقي.
    'modules/settings/social-links.controller.ts', // روابط سوشيال معلنة للفوتر — نفس فلسفة legal-entity
    'modules/promotions/promo-code-link.controller.ts', // /p/:code — تحويل QR، بيسجّل زيارة مجهولة وبيـ302، throttle 120/د
    'modules/marketing/marketing-link.controller.ts', // /r/:code — نفس الشيء لمصادر الحملات، throttle 120/د
  ]);
  const unexpected = publicList.filter((f) => !EXPECTED_PUBLIC.has(f));
  h.record(
    'و-١ مفيش ملف جديد فيه @Public() خارج القايمة المراجَعة',
    unexpected.length === 0,
    unexpected.length ? `مراجعة مطلوبة: ${unexpected.join('، ')} ❗` : `${publicList.length} ملف، كلهم مراجَعين`,
  );

  // webhook الدفع عام عمدًا — الأمان فيه **التوقيع** مش المصادقة. لو حمولة مزوّرة عدّت، ده أخطر
  // ثغرة مالية ممكنة: أي حد يقدر يعلن إن طلب اتدفع.
  //
  // **الفحص بيقيس الأثر المالي مش كود HTTP**: `200` هنا مقصود ومكتوب في `webhooks.controller.ts`
  // — حمولة بتوقيع غلط مش هتبقى صح لو البوابة أعادت إرسالها، فإرجاع خطأ كان هيخلّيها تعيد
  // المحاولة للأبد على حاجة ميّتة. التوقيع الغلط بيترفض جوّه `finalizeGatewayWebhook` **قبل**
  // أي أثر، والصح إننا نتأكد من ده في القاعدة. (أول نسخة من الفحص كانت بتقيس الكود وبس فطلّعت
  // بلاغ كاذب.)
  const forgedEventId = `sec-forged-${h.nextTag()}`;
  const beforePayments = (
    await h.q(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [vOrder.id])
  )[0].n;
  const fakeHook = await h.api('/webhooks/paymob?hmac=deadbeef', {
    method: 'POST',
    body: {
      obj: {
        id: forgedEventId,
        success: true,
        pending: false,
        amount_cents: 100_000,
        order: { id: forgedEventId, merchant_order_id: vOrder.id },
      },
    },
  });
  await sleep(1000);
  const afterPayments = (
    await h.q(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [vOrder.id])
  )[0].n;
  const [orderAfter] = await h.q(`SELECT payment_status, order_status FROM orders WHERE id = $1`, [vOrder.id]);
  const [hookRow] = await h.q(
    `SELECT count(*)::int AS n FROM webhook_events WHERE external_event_id = $1`,
    [forgedEventId],
  );
  h.record(
    'و-٢ webhook مزوّر (توقيع غلط) مالوش أي أثر مالي — مفيش دفعة ولا صف حدث',
    afterPayments === beforePayments && hookRow.n === 0 && orderAfter.payment_status !== 'succeeded',
    `HTTP=${fakeHook.status}، دفعات ${beforePayments}→${afterPayments}، صفوف حدث=${hookRow.n}، حالة الدفع=${orderAfter.payment_status}`,
  );

  // ============ ز: الأسرار — في الريبو وفي الباندل ============
  //
  // الفرق المهم: سر في `.env` (مستبعد من Git) طبيعي؛ سر **متتبّع في Git** أو مخبوز في باندل
  // Flutter اللي بيتوزّع على تليفونات الناس = مكشوف للأبد.
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  const envTracked = tracked.filter((f) => /(^|\/)\.env$|\.env\.(local|production|prod)$/.test(f));
  h.record(
    'ز-١ مفيش ملف .env حقيقي متتبّع في Git',
    envTracked.length === 0,
    envTracked.length ? `متتبّع: ${envTracked.join('، ')} ❗` : 'نظيف (.env.example بس)',
  );

  // بحث عن قيم أسرار حقيقية في الملفات المتتبّعة. الأنماط دي بتدوّر على **شكل السر نفسه**
  // (مفاتيح بوابات دفع/AWS/Firebase) مش على كلمة "secret" — عشان مانغرقش في نتايج كاذبة.
  const SECRET_PATTERNS = [
    ['مفتاح AWS', /AKIA[0-9A-Z]{16}/],
    ['مفتاح Paymob حي', /\bsk_live_[A-Za-z0-9]{20,}/],
    ['مفتاح Stripe حي', /\bsk_live_[A-Za-z0-9]{24,}/],
    ['توكن Twilio', /\bSK[0-9a-f]{32}\b/],
    ['مفتاح Google API', /\bAIza[0-9A-Za-z_\-]{35}\b/],
    ['RSA private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ];
  const SKIP = /(^|\/)(node_modules|dist|build|\.git)\//;
  const secretHits = [];
  for (const file of tracked) {
    if (SKIP.test(file)) continue;
    const abs = path.join(ROOT, file);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const [label, re] of SECRET_PATTERNS) {
      if (re.test(content)) secretHits.push(`${file} (${label})`);
    }
  }
  h.record(
    'ز-٢ مفيش سر حقيقي (AWS/بوابة دفع/Google/مفتاح خاص) في أي ملف متتبّع',
    secretHits.length === 0,
    secretHits.length ? `${secretHits.slice(0, 5).join('، ')} ❗` : `${tracked.length} ملف اتفحصوا`,
  );

  // **باندل Flutter**: أي `--dart-define` أو ثابت في كود Dart بيتشحن جوّه الـAPK. الفحص بيدوّر
  // على أسرار سيرفر (JWT secret، DB URL، مفاتيح خاصة) في كود التطبيقين — دي حاجات ماينفعش
  // أبدًا تكون على تليفون العميل، عكس مفتاح Maps العام اللي مقصود يكون هناك.
  const dartFiles = execFileSync('git', ['ls-files', 'apps/customer-app', 'apps/technician-app'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.dart'));
  const SERVER_SECRET_IN_CLIENT = [
    ['سر JWT', /JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|jwtSecret/i],
    ['رابط قاعدة بيانات', /postgres(ql)?:\/\/[^\s'"]+/],
    ['مفتاح Paymob سيري', /PAYMOB_(SECRET|HMAC)/],
    ['مفتاح AWS سيري', /AWS_SECRET_ACCESS_KEY/],
  ];
  const bundleHits = [];
  for (const file of dartFiles) {
    const content = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const [label, re] of SERVER_SECRET_IN_CLIENT) {
      if (re.test(content)) bundleHits.push(`${file} (${label})`);
    }
  }
  h.record(
    'ز-٣ مفيش سر سيرفر مخبوز في كود تطبيقات Flutter',
    bundleHits.length === 0,
    bundleHits.length ? `${bundleHits.join('، ')} ❗` : `${dartFiles.length} ملف Dart اتفحصوا`,
  );

  // ============ ح: تسريب المعلومات في الأخطاء ============
  //
  // رسالة خطأ بتطبع stack trace أو استعلام SQL بتدّي المهاجم خريطة الداخل مجانًا.
  const errRes = await h.api(`/orders/not-a-uuid`, { token: attacker.token });
  const errRaw = JSON.stringify(errRes.body ?? {});
  const leakyMarkers = ['at Object.', '/apps/api/src/', 'QueryFailedError', 'select ', 'node_modules'];
  const found = leakyMarkers.filter((m) => errRaw.includes(m));
  h.record(
    'ح-١ رسالة الخطأ مافيهاش stack ولا SQL ولا مسارات ملفات',
    found.length === 0,
    found.length ? `سرّب: ${found.join('، ')} ❗` : `HTTP=${errRes.status}، الرد نظيف`,
  );

  // ============ ط: حظر المستخدم بيسري فورًا ============
  //
  // توكن صالح لساعة + حساب متحظر = المستخدم يفضل شغّال لحد ما التوكن ينتهي، إلا لو الحارس
  // بيراجع الحالة كل نداء. ده الفرق بين «حظرته» و«حظرته بعد ساعة».
  await h.q(`UPDATE users SET is_active = false WHERE id = $1`, [attacker.userId]);
  await sleep(300);
  const bannedRes = await h.api('/orders?page=1&limit=1', { token: attacker.token });
  h.record(
    'ط-١ حظر المستخدم بيبطّل توكنه الصالح فورًا',
    DENIED.includes(bannedRes.status),
    `HTTP=${bannedRes.status}`,
  );
  await h.q(`UPDATE users SET is_active = true WHERE id = $1`, [attacker.userId]);

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
  await h.close();
  process.exit(2);
});
