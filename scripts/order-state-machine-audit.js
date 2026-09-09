#!/usr/bin/env node
/**
 * **ج-٣ — آلة حالة الطلب كاملة، مش الـhappy path**، مقاسة حيًا على المكدس الكامل.
 *
 * سؤال المالك: «كل المسارات: إنشاء→قبول→وصول→بدء→إنهاء، إلغاء قبل الفني، إلغاء بعد الفني،
 * العميل مش موجود (no-show)، الفني رفض، العميل رفض، إعادة تعيين، فشل في نص الخطوات».
 *
 * السكريبت ده بيمشي كل مسار **بالـAPI الحقيقي** (مش بكتابة SQL)، وبيتحقق بعد كل خطوة من:
 *   ١. حالة الطلب الفعلية في القاعدة = المتوقعة.
 *   ٢. الانتقال اللي حصل **مسموح** في `ORDER_TRANSITIONS` (مصدر الحقيقة الوحيد).
 *   ٣. `order_status_history` سجّل الانتقال (مفيش تغيير حالة صامت).
 *
 * وبعدين بيجرّب **أفعال خارج الترتيب** (فني يقول «وصلت» لطلب لسه بيدور، عميل يلغي طلب مكتمل،
 * فني يقفل طلب مش بتاعه…) والمطلوب منها: رفض واضح بالعربي — **أي `5xx` = فشل**.
 *
 * في الآخر بيطبع **تغطية**: كل حافة في `ORDER_TRANSITIONS` اتمشيت ولا لأ. الحواف اللي مالهاش
 * سائق مكتوب هنا بتتسجّل باسمها عشان السيشن اللي بعدها تكمّلها بدل ما تعيد اكتشافها.
 *
 *   node scripts/order-state-machine-audit.js [--keep]
 */
'use strict';

const path = require('node:path');
const { LiveHarness, sleep, ROOT } = require('./lib/live-harness');

// مصدر الحقيقة نفسه اللي الباك-إند بيستخدمه — مش نسخة مكتوبة بالإيد هنا تقدم مع الوقت.
const { ORDER_TRANSITIONS, canTransition } = require(path.join(ROOT, 'apps/api/dist/modules/orders/order-state-machine'));

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('sm');

/** الحواف اللي اتمشيت فعليًا — مفتاح `from>to`. */
const covered = new Set();

async function statusOf(orderId) {
  const [row] = await h.q(`SELECT order_status, technician_id, payment_status FROM orders WHERE id = $1`, [orderId]);
  return row ?? null;
}

async function historyCount(orderId, from, to) {
  const [row] = await h.q(
    `SELECT count(*)::int AS n FROM order_status_history
      WHERE order_id = $1 AND previous_status = $2 AND new_status = $3`,
    [orderId, from, to],
  );
  return row.n;
}

/**
 * خطوة واحدة: نفّذ النداء، وتأكد إن الحالة بقت `expected`، وإن الانتقال مسموح ومتسجّل.
 * بيرجع `true` لو كل ده تمام.
 */
async function step(label, orderId, expected, call, { allowHttp = [200, 201] } = {}) {
  const before = (await statusOf(orderId))?.order_status;
  const res = await call();
  const okHttp = allowHttp.includes(res.status);

  // التوزيع/التسوية أحيانًا بتخلص بعد رد الـHTTP بلحظات (طابور) — بنستنى الحالة تستقر.
  let after = before;
  for (let i = 0; i < 40; i++) {
    after = (await statusOf(orderId))?.order_status;
    if (after === expected) break;
    await sleep(250);
  }

  const legal = before === after ? true : canTransition(before, after);
  const logged = before === after ? true : (await historyCount(orderId, before, after)) > 0;
  if (before !== after) covered.add(`${before}>${after}`);

  const ok = okHttp && after === expected && legal && logged;
  h.record(
    `${label}`,
    ok,
    `HTTP=${res.status} ${before} → ${after} (المتوقع ${expected})` +
      `${legal ? '' : ' ❗انتقال مش في الجدول'}${logged ? '' : ' ❗مش متسجّل في السجل'}` +
      `${okHttp ? '' : ` ردّ=${JSON.stringify(res.body?.error ?? res.body).slice(0, 200)}`}`,
  );
  return ok;
}

/** فعل خارج الترتيب: المطلوب رفض ‎4xx‎ برسالة عربية — أي ‎5xx‎ فشل صريح. */
async function rejectStep(label, orderId, call) {
  const before = (await statusOf(orderId))?.order_status;
  const res = await call();
  await sleep(300);
  const after = (await statusOf(orderId))?.order_status;

  const is4xx = res.status >= 400 && res.status < 500;
  const message = String(res.body?.error?.message ?? '');
  const arabic = /[؀-ۿ]/.test(message);
  const unchanged = before === after;

  const ok = is4xx && arabic && unchanged;
  h.record(
    label,
    ok,
    `HTTP=${res.status} الحالة ${before} → ${after}` +
      `${is4xx ? '' : ' ❗مش 4xx'}${arabic ? '' : ' ❗رسالة مش عربية'}${unchanged ? '' : ' ❗الحالة اتغيّرت رغم الرفض'}` +
      ` «${message.slice(0, 90)}»`,
  );
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
      problem_description: 'تدقيق آلة الحالة',
      ...extra,
    },
  });
  if (res.status !== 201) throw new Error(`فشل إنشاء الطلب: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  return res.body.data;
}

/** الانتظار لحد ما التوزيع يخلص ويتعيّن فني — بيرجع الحالة المستقرة. */
async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const row = await statusOf(orderId);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return statusOf(orderId);
}

/**
 * الانتظار لحد ما الحالة تثبت — التوزيع غير متزامن، فأي فحص «فعل خارج الترتيب» على طلب لسه
 * بيتوزّع بيقيس لحظة عابرة بدل ما بيقيسه. (اتلقط حيًا: فحص «الفني بيقول وصلت لطلب بيدور»
 * لقى الحالة اتغيّرت لـ`accepted` في نص الفحص.)
 */
async function waitStable(orderId) {
  let last = null;
  let stableFor = 0;
  for (let i = 0; i < 60; i++) {
    const row = await statusOf(orderId);
    if (row?.order_status === last) {
      if (++stableFor >= 3) return row;
    } else {
      stableFor = 0;
      last = row?.order_status;
    }
    await sleep(500);
  }
  return statusOf(orderId);
}

/**
 * **الشغل مايقفلش من غير صورة بعد** (`ORDR_005`) — قاعدة منتج مقصودة، فالسائق بتاعنا لازم
 * يرفعها زي أي فني حقيقي. PNG صالحة بالحد الأدنى: التوقيع بيتفحص بـ`assertFileSignatureMatches`
 * فبايت عشوائي مش هيعدّي.
 */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

async function uploadAfterPhoto(orderId, token) {
  const form = new FormData();
  form.append('file', new Blob([PNG_1x1], { type: 'image/png' }), 'after.png');
  form.append('media_type', 'after_photo');
  const res = await fetch(`${require('./lib/live-harness').API}/technician/orders/${orderId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
}

/** أسباب الإلغاء المعتمدة — الـDTO بيطلب `cancellation_reason_id` حقيقي مش نص حر. */
async function cancellationReason(appliesTo) {
  const res = await h.api(`/cancellation-reasons?applies_to=${appliesTo}`);
  const list = Array.isArray(res.body?.data) ? res.body.data : res.body;
  return Array.isArray(list) && list.length ? list[0].id : null;
}

// ===================== المسارات =====================

/** م-١: المسار السعيد كامل — إنشاء → قبول → في الطريق → وصل → بدأ → خلص → دفع → مكتمل. */
async function pathHappy(ctx) {
  const order = await createOrder(ctx.customer);
  const assigned = await waitAssigned(order.id);
  covered.add(`searching_technician>${assigned.order_status}`);
  h.record('م-١/١ التوزيع عيّن فني', !!assigned.technician_id, `الحالة=${assigned.order_status}`);

  const tech = ctx.techByProfile.get(assigned.technician_id) ?? ctx.tech;
  await step('م-١/٢ الفني في الطريق', order.id, 'technician_on_way', () =>
    h.api(`/technician/orders/${order.id}/depart`, { method: 'POST', token: tech.token }));
  await step('م-١/٣ الفني وصل', order.id, 'technician_arrived', () =>
    h.api(`/technician/orders/${order.id}/arrive`, { method: 'POST', token: tech.token }));
  await step('م-١/٤ بدء الشغل', order.id, 'in_progress', () =>
    h.api(`/technician/orders/${order.id}/start`, { method: 'POST', token: tech.token }));
  // قاعدة منتج مقصودة (`ORDR_005`): مفيش إقفال شغل من غير صورة «بعد». السائق بيرفعها زي الفني.
  const photoStatus = await uploadAfterPhoto(order.id, tech.token);
  h.record('م-١/٥أ رفع صورة «بعد» قبل الإقفال', photoStatus < 400, `HTTP=${photoStatus}`);
  await step('م-١/٥ب إنهاء الشغل', order.id, 'work_completed', () =>
    h.api(`/technician/orders/${order.id}/complete`, { method: 'POST', token: tech.token }));

  await h.fundWallet(ctx.customer.userId, h.catalog.priceCents * 3);
  await step('م-١/٦ دفع بالمحفظة → مكتمل', order.id, 'completed', () =>
    h.api(`/orders/${order.id}/pay-with-wallet`, {
      method: 'POST',
      token: ctx.customer.token,
      headers: { 'idempotency-key': `sm-happy-${h.runId}` },
    }));
  return order;
}

/** م-٢: إلغاء العميل **قبل** ما يوصل فني. */
async function pathCancelBeforeTechnician(ctx) {
  const order = await createOrder(ctx.customerB);
  await step('م-٢ إلغاء العميل والطلب لسه بيدور', order.id, 'cancelled_by_customer', () =>
    h.api(`/orders/${order.id}/cancel`, {
      method: 'POST',
      token: ctx.customerB.token,
      body: { reason: 'غيّرت رأيي قبل ما يتعيّن فني', ...(ctx.customerReasonId ? { cancellation_reason_id: ctx.customerReasonId } : {}) },
    }));
  const [fee] = await h.q(`SELECT cancellation_fee_cents FROM orders WHERE id = $1`, [order.id]);
  h.record('م-٢ مفيش رسم إلغاء قبل تعيين فني', (fee?.cancellation_fee_cents ?? 0) === 0,
    `الرسم=${fee?.cancellation_fee_cents ?? 0}`);
}

/** م-٣: إلغاء العميل **بعد** ما الفني اتعيّن/قبل. */
async function pathCancelAfterTechnician(ctx) {
  const order = await createOrder(ctx.customerB);
  const assigned = await waitAssigned(order.id);
  h.record('م-٣/١ الطلب وصل لفني قبل الإلغاء', !!assigned.technician_id, `الحالة=${assigned.order_status}`);
  await step('م-٣/٢ إلغاء العميل بعد تعيين الفني', order.id, 'cancelled_by_customer', () =>
    h.api(`/orders/${order.id}/cancel`, {
      method: 'POST',
      token: ctx.customerB.token,
      body: { reason: 'ظروف طارئة بعد ما الفني اتأكّد', ...(ctx.customerReasonId ? { cancellation_reason_id: ctx.customerReasonId } : {}) },
    }));
}

/** م-٤: الفني بيلغي بعد القبول — الطلب مايضيعش، بيرجع للتوزيع أو لاختيار العميل. */
async function pathTechnicianCancels(ctx) {
  const order = await createOrder(ctx.customerC);
  const assigned = await waitAssigned(order.id);
  const tech = ctx.techByProfile.get(assigned.technician_id) ?? ctx.tech;
  const before = assigned.order_status;

  const res = await h.api(`/technician/orders/${order.id}/cancel`, {
    method: 'POST',
    token: tech.token,
    body: { cancellation_reason_id: ctx.technicianReasonId, reason: 'ظرف طارئ عند الفني' },
  });
  await sleep(1500);
  const after = (await statusOf(order.id)).order_status;
  if (before !== after) covered.add(`${before}>${after}`);

  // **ADR-0018 §12 — سياسة مقصودة، مش عطل**: حجز مستقبلي اتأكّد تلقائيًا (بلا قبول فعلي من
  // الفني) ميقدرش يتلغى ذاتيًا — حجز عميل مؤكد ميختفيش لمجرد إن الفني ضغط زرار. المطلوب هنا
  // حاجتين مع بعض: (أ) الرفض واضح بالعربي وبيقول للفني يعمل إيه، (ب) **فيه مخرج فعلي** — الأدمن
  // يقدر يتصرف. رفض بلا مخرج = طلب معلّق على فني اختفى، وده اللي بنختبر إنه مش بيحصل.
  const message = String(res.body?.error?.message ?? '');
  const policyRejection = res.status === 403 && /[؀-ۿ]/.test(message) && before === after;
  const acceptable = ['searching_technician', 'awaiting_technician_reselection', 'cancelled_by_technician'];
  const selfCancelWorked = res.status < 400 && acceptable.includes(after);
  h.record(
    'م-٤/أ إلغاء الفني الذاتي: يا ينفّذ يا يترفض بسياسة واضحة',
    policyRejection || selfCancelWorked,
    `HTTP=${res.status} ${before} → ${after} «${message.slice(0, 110)}»`,
  );

  if (policyRejection) {
    // المخرج: الأدمن بيعيد التعيين لفني تاني — الطلب بيكمل بدل ما يفضل معلّق.
    const other = ctx.technicians.find((t) => t.id !== assigned.technician_id);
    const token = await h.stepUpToken(ctx.admin.userId);
    const admin = await h.api(`/admin/orders/${order.id}/reassign`, {
      method: 'POST',
      token: ctx.admin.token,
      headers: { 'x-step-up-token': token },
      body: { technician_id: other.id, reason: 'الفني الأصلي طلب الإلغاء — إعادة تعيين' },
    });
    await sleep(1500);
    const reassigned = await statusOf(order.id);
    h.record(
      'م-٤/ب المخرج موجود: الأدمن بيعيد التعيين لفني بديل',
      admin.status < 400 && reassigned.technician_id === other.id,
      `HTTP=${admin.status} الفني ${reassigned.technician_id === other.id ? 'اتغيّر للبديل' : 'زي ما هو'} الحالة=${reassigned.order_status}`,
    );
  }
}

/** م-٥: العميل مش موجود — الفني بيبلّغ زيارة فاشلة، الطلب بيروح لمراجعة أدمن مش لإلغاء صامت. */
async function pathFailedVisit(ctx) {
  const order = await createOrder(ctx.customerC);
  const assigned = await waitAssigned(order.id);
  const tech = ctx.techByProfile.get(assigned.technician_id) ?? ctx.tech;

  await step('م-٥/١ في الطريق', order.id, 'technician_on_way', () =>
    h.api(`/technician/orders/${order.id}/depart`, { method: 'POST', token: tech.token }));
  await step('م-٥/٢ وصل', order.id, 'technician_arrived', () =>
    h.api(`/technician/orders/${order.id}/arrive`, { method: 'POST', token: tech.token }));
  await step('م-٥/٣ بلاغ زيارة فاشلة → مراجعة أدمن', order.id, 'disputed', () =>
    h.api(`/technician/orders/${order.id}/report-failed-visit`, {
      method: 'POST',
      token: tech.token,
      body: { reason: 'customer_no_show', description: 'العميل مش موجود ومش بيرد على التليفون' },
    }));

  const token = await h.stepUpToken(ctx.admin.userId);
  // `FailedVisitOutcome` فيه قيمتين بس: `reschedule` (العميل عايز يكمل في موعد تاني) و
  // `cancel_with_fee` (إلغاء برسم زيارة). مفيش «retry» — الجدول بيسمح بـ`disputed → accepted`
  // وده اللي `reschedule` بيوصّل له.
  await step('م-٥/٤ الأدمن حلّ النزاع: إعادة جدولة → الطلب يرجع للفني', order.id, 'accepted', () =>
    h.api(`/admin/orders/${order.id}/resolve-failed-visit`, {
      method: 'POST',
      token: ctx.admin.token,
      headers: { 'x-step-up-token': token },
      body: {
        outcome: 'reschedule',
        admin_notes: 'العميل رجع واتفق على إعادة المحاولة في موعد جديد',
        new_scheduled_at: h.nextDay(),
      },
    }));
}

/** م-٦: فشل في نص الخطوات — الأدمن بيقفل طلب شغّال بقرار موثّق. */
async function pathAdminCancelsMidWork(ctx) {
  const order = await createOrder(ctx.customerD);
  const assigned = await waitAssigned(order.id);
  const tech = ctx.techByProfile.get(assigned.technician_id) ?? ctx.tech;
  await step('م-٦/١ في الطريق', order.id, 'technician_on_way', () =>
    h.api(`/technician/orders/${order.id}/depart`, { method: 'POST', token: tech.token }));
  await step('م-٦/٢ وصل', order.id, 'technician_arrived', () =>
    h.api(`/technician/orders/${order.id}/arrive`, { method: 'POST', token: tech.token }));
  await step('م-٦/٣ بدأ', order.id, 'in_progress', () =>
    h.api(`/technician/orders/${order.id}/start`, { method: 'POST', token: tech.token }));

  const token = await h.stepUpToken(ctx.admin.userId);
  await step('م-٦/٤ الأدمن بيقفل طلب شغّال بقرار موثّق', order.id, 'cancelled_by_system', () =>
    h.api(`/admin/orders/${order.id}/cancel`, {
      method: 'POST',
      token: ctx.admin.token,
      headers: { 'x-step-up-token': token },
      body: { reason: 'الشغل اتوقف والعميل قفل الموقع — إغلاق تشغيلي' },
    }));
  return order;
}

/** م-٧: إعادة تعيين الأدمن لفني تاني. */
async function pathAdminReassign(ctx) {
  const order = await createOrder(ctx.customerD);
  const assigned = await waitAssigned(order.id);
  const other = ctx.technicians.find((t) => t.id !== assigned.technician_id);
  if (!other) {
    h.record('م-٧ إعادة تعيين الأدمن', false, 'مفيش فني تاني متاح للتعيين');
    return;
  }
  const token = await h.stepUpToken(ctx.admin.userId);
  const res = await h.api(`/admin/orders/${order.id}/reassign`, {
    method: 'POST',
    token: ctx.admin.token,
    headers: { 'x-step-up-token': token },
    body: { technician_id: other.id, reason: 'إعادة تعيين تشغيلية' },
  });
  await sleep(1500);
  const after = await statusOf(order.id);
  h.record(
    'م-٧ إعادة تعيين الأدمن لفني تاني',
    res.status < 400 && after.technician_id === other.id,
    `HTTP=${res.status} الفني بقى ${after.technician_id === other.id ? 'الجديد' : after.technician_id} الحالة=${after.order_status}`,
  );
}

/** م-٨: أفعال خارج الترتيب — كلها لازم ترفض بوضوح بالعربي، صفر 5xx. */
async function pathOutOfOrder(ctx) {
  const fresh = await createOrder(ctx.customerE);
  const tech = ctx.tech;
  // بننتظر الحالة تثبت الأول: فحص فعل خارج الترتيب على طلب لسه بيتوزّع بيقيس لحظة عابرة.
  await waitStable(fresh.id);

  await rejectStep('م-٨/١ الفني بيقول «وصلت» لطلب لسه بيدور', fresh.id, () =>
    h.api(`/technician/orders/${fresh.id}/arrive`, { method: 'POST', token: tech.token }));
  await rejectStep('م-٨/٢ الفني بيقفل طلب لسه ما بدأش', fresh.id, () =>
    h.api(`/technician/orders/${fresh.id}/complete`, { method: 'POST', token: tech.token }));
  await rejectStep('م-٨/٣ العميل بيدفع لطلب الشغل فيه ماخلصش', fresh.id, () =>
    h.api(`/orders/${fresh.id}/pay-with-wallet`, {
      method: 'POST',
      token: ctx.customerE.token,
      headers: { 'idempotency-key': `sm-early-${h.runId}` },
    }));

  const assigned = await waitAssigned(fresh.id);
  const stranger = ctx.technicians.find((t) => t.id !== assigned.technician_id) ?? ctx.tech;
  await rejectStep('م-٨/٤ فني تاني (مش صاحب الطلب) بيحاول يبدأ', fresh.id, () =>
    h.api(`/technician/orders/${fresh.id}/depart`, { method: 'POST', token: stranger.token }));
  await rejectStep('م-٨/٥ عميل تاني بيحاول يلغي طلب مش بتاعه', fresh.id, () =>
    h.api(`/orders/${fresh.id}/cancel`, {
      method: 'POST',
      token: ctx.customerB.token,
      body: { reason: 'محاولة إلغاء من حساب تاني', ...(ctx.customerReasonId ? { cancellation_reason_id: ctx.customerReasonId } : {}) },
    }));

  return { completedOrder: ctx.completedOrder, cancelledOrder: ctx.cancelledOrder };
}

/** م-٩: أفعال على طلبات في حالة نهائية — مايتحركوش. */
async function pathTerminalStates(ctx) {
  if (ctx.completedOrder) {
    await rejectStep('م-٩/١ إلغاء العميل لطلب مكتمل', ctx.completedOrder.id, () =>
      h.api(`/orders/${ctx.completedOrder.id}/cancel`, {
        method: 'POST',
        token: ctx.customer.token,
        body: { reason: 'إلغاء متأخر', ...(ctx.customerReasonId ? { cancellation_reason_id: ctx.customerReasonId } : {}) },
      }));
    await rejectStep('م-٩/٢ الفني بيبدأ طلب مكتمل', ctx.completedOrder.id, () =>
      h.api(`/technician/orders/${ctx.completedOrder.id}/start`, { method: 'POST', token: ctx.tech.token }));
  }
  if (ctx.cancelledOrder) {
    await rejectStep('م-٩/٣ الفني بيتحرك على طلب ملغي', ctx.cancelledOrder.id, () =>
      h.api(`/technician/orders/${ctx.cancelledOrder.id}/depart`, { method: 'POST', token: ctx.tech.token }));
  }
}

// ===================== التغطية =====================

function reportCoverage() {
  const edges = [];
  for (const [from, tos] of Object.entries(ORDER_TRANSITIONS)) {
    for (const to of tos) edges.push(`${from}>${to}`);
  }
  const hit = edges.filter((e) => covered.has(e));
  console.log(`\n--- تغطية آلة الحالة ---`);
  console.log(`اتمشى ${hit.length} من ${edges.length} حافة معلنة (${Math.round((hit.length / edges.length) * 100)}%)`);
  console.log(`الحواف اللي اتمشيت: ${hit.sort().join('، ')}`);
  const missing = edges.filter((e) => !covered.has(e));
  console.log(`\nحواف لسه بلا سائق في التدقيق ده (${missing.length}):`);
  for (const e of missing) console.log(`   • ${e.replace('>', ' → ')}`);
  return { total: edges.length, hit: hit.length, missing };
}

// ===================== التشغيل =====================

async function run() {
  await h.connect();
  console.log(`\n=== ج-٣: آلة حالة الطلب — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();

  const ctx = { techByProfile: new Map(), technicians: [] };
  for (const label of ['a', 'b']) {
    const t = await h.makeTechnician(label);
    ctx.technicians.push(t);
    ctx.techByProfile.set(t.id, t);
  }
  ctx.tech = ctx.technicians[0];
  ctx.admin = await h.makeAdmin();
  ctx.customer = await h.makeCustomer('main');
  ctx.customerB = await h.makeCustomer('b');
  ctx.customerC = await h.makeCustomer('c');
  ctx.customerD = await h.makeCustomer('d');
  ctx.customerE = await h.makeCustomer('e');
  ctx.customerReasonId = await cancellationReason('customer');
  ctx.technicianReasonId = await cancellationReason('technician');
  h.record(
    'أسباب الإلغاء المعتمدة متاحة للعميل والفني',
    !!ctx.customerReasonId && !!ctx.technicianReasonId,
    `عميل=${ctx.customerReasonId ? 'موجود' : 'مفقود'} فني=${ctx.technicianReasonId ? 'موجود' : 'مفقود'}`,
  );

  try {
    ctx.completedOrder = await pathHappy(ctx);
    await pathCancelBeforeTechnician(ctx);
    await pathCancelAfterTechnician(ctx);
    await pathTechnicianCancels(ctx);
    await pathFailedVisit(ctx);
    ctx.cancelledOrder = await pathAdminCancelsMidWork(ctx);
    await pathAdminReassign(ctx);
    await pathOutOfOrder(ctx);
    await pathTerminalStates(ctx);
  } finally {
    const ledger = await h.ledgerImbalance();
    h.record('الدفتر متوازن', ledger.net === 0, `قيود=${ledger.rows} صافي=${ledger.net}`);
    const negatives = await h.negativeBalances();
    h.record('مفيش رصيد عميل/فني سالب', negatives.length === 0, negatives.length ? JSON.stringify(negatives) : 'نضيف');
    const errors = await h.serverErrorsSince();
    h.record(
      'صفر 5xx في كل التشغيلة',
      errors.length === 0,
      errors.length ? errors.map((e) => `${e.url} :: ${e.message}`).slice(0, 5).join(' | ') : 'مفيش',
    );
  }

  const coverage = reportCoverage();

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
  await h.close();
  process.exit(2);
});
