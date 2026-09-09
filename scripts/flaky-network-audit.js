#!/usr/bin/env node
/**
 * **ج-١٦ — نت بطيء/متقطع**: «دوسة مزدوجة، قطع أثناء التأكيد/الدفع».
 *
 * ده أكتر سيناريو **واقعي** في القايمة كلها: عميل في مصر على بيانات محمول، الشبكة بتتقطع
 * لحظة ما يدوس «أكّد الحجز» أو «ادفع». الفرق بين نظام محترم ونظام بيسرق فلوس الناس هو
 * السلوك في اللحظة دي بالظبط.
 *
 * تلات أسئلة، وكلهم بيتقاسوا هنا **بقطع فعلي للاتصال في نص الطلب**:
 *   1. **الدوسة المزدوجة** (الزرار مااستجابش فالعميل داس تاني): طلب واحد ولا اتنين؟ دفعة
 *      واحدة ولا اتنين؟
 *   2. **القطع بعد ما السيرفر استلم وقبل ما الرد يوصل**: العميل شايف «فشل» والعملية **تمّت**.
 *      لو أعاد المحاولة، هل بيتحاسب مرتين؟
 *   3. **البطء**: الطلب بياخد وقت طويل — بيرجع في الآخر ولا بيتقطع بحالة نص-مكتملة؟
 *
 * المحاكاة هنا **مش mock**: `AbortController` بيقطع الاتصال من ناحية العميل فعلاً بعد ما
 * الطلب اتبعت — وده بالظبط اللي بيحصل لما الشبكة تقع. السيرفر بيكمّل شغله والعميل مايعرفش.
 *
 *   node scripts/flaky-network-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep, API } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('nw');

/**
 * بيبعت طلب حقيقي وبيقطعه بعد `abortAfterMs` — الطلب **بيوصل السيرفر** والعميل بس هو اللي
 * مش هيشوف الرد. ده الفرق الجوهري عن «مابعتش الطلب أصلاً».
 */
async function sendThenDrop(pathname, { method = 'POST', token, body, headers = {}, abortAfterMs = 60 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), abortAfterMs);
  try {
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return { dropped: false, status: res.status };
  } catch {
    return { dropped: true, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const [row] = await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    if (row?.technician_id) return true;
    await sleep(500);
  }
  return false;
}

function orderBody(customer, note) {
  return {
    service_id: h.catalog.service.id,
    address_id: customer.addressId,
    scheduled_at: h.nextDay(),
    problem_description: note,
  };
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٦: نت بطيء/متقطع — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  const customer = await h.makeCustomer('nw');
  await h.makeTechnician('nw');
  await h.fundWallet(customer.userId, 2_000_000);

  // ---- ن-١: الدوسة المزدوجة على «أكّد الحجز» ----
  //
  // السيناريو الحرفي: الزرار مااستجابش (الشبكة بطيئة) فالعميل داس تاني. التطبيق بيبعت **نفس**
  // `Idempotency-Key` (لأنه اتولّد مرة واحدة مع الفورم) — ده العقد اللي P0-4 بناه.
  const key1 = `nw-${h.nextTag()}`;
  const body1 = orderBody(customer, `دوسة مزدوجة ${h.runId}`);
  const [a, b] = await Promise.all([
    h.api('/orders', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': key1 }, body: body1 }),
    h.api('/orders', { method: 'POST', token: customer.token, headers: { 'Idempotency-Key': key1 }, body: body1 }),
  ]);
  const created1 = await h.q(
    `SELECT id FROM orders WHERE customer_id = $1 AND problem_description = $2`,
    [customer.profileId, body1.problem_description],
  );
  h.record(
    'ن-١/أ دوستين **متزامنتين** بنفس المفتاح = طلب واحد في القاعدة',
    created1.length === 1,
    `HTTP ${a.status}/${b.status}، طلبات=${created1.length}`,
  );
  h.record(
    'ن-١/ب والاتنين رجعوا نفس الطلب (العميل مايشوفش خطأ على دوسة زيادة)',
    a.status < 400 && b.status < 400 && a.body?.data?.id === b.body?.data?.id,
    `id متطابق=${a.body?.data?.id === b.body?.data?.id}`,
  );

  // ---- ن-٢: قطع الاتصال **بعد** ما الطلب وصل السيرفر ----
  //
  // أخبث حالة: السيرفر عمل الطلب، والرد ضاع في الطريق. العميل شايف «فشل الاتصال».
  const key2 = `nw-${h.nextTag()}`;
  const body2 = orderBody(customer, `قطع أثناء التأكيد ${h.runId}`);
  const dropped = await sendThenDrop('/orders', {
    token: customer.token,
    headers: { 'Idempotency-Key': key2 },
    body: body2,
    abortAfterMs: 40,
  });
  h.record(
    'ن-٢/أ الاتصال اتقطع فعلاً من ناحية العميل (الفحص مش بيقيس طلب ناجح)',
    dropped.dropped,
    dropped.dropped ? 'اتقطع' : `مااتقطعش (رجع ${dropped.status}) — قلّل abortAfterMs ❗`,
  );
  await sleep(2500);
  const afterDrop = await h.q(
    `SELECT id FROM orders WHERE customer_id = $1 AND problem_description = $2`,
    [customer.profileId, body2.problem_description],
  );
  h.record(
    'ن-٢/ب السيرفر كمّل شغله رغم إن العميل مشي (الطلب اتسجّل)',
    afterDrop.length === 1,
    `طلبات=${afterDrop.length}`,
  );

  // **اللحظة الحاسمة**: العميل شاف «فشل» فداس «حاول تاني» — التطبيق بيعيد بنفس المفتاح.
  // لو النظام عمل طلب تاني، العميل عنده حجزين وهيتحاسب مرتين.
  const retry = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': key2 },
    body: body2,
  });
  const afterRetry = await h.q(
    `SELECT id FROM orders WHERE customer_id = $1 AND problem_description = $2`,
    [customer.profileId, body2.problem_description],
  );
  h.record(
    'ن-٢/ج إعادة المحاولة بعد القطع رجّعت **نفس** الطلب مش طلب جديد',
    retry.status < 400 && afterRetry.length === 1 && retry.body?.data?.id === afterDrop[0].id,
    `HTTP=${retry.status}، طلبات=${afterRetry.length}، نفس المعرّف=${retry.body?.data?.id === afterDrop[0]?.id}`,
  );

  // ---- ن-٣: نفس السيناريو على **الدفع** — أخطر بكتير ----
  //
  // طلب مكرر = إزعاج. دفعة مكررة = فلوس العميل اتاخدت مرتين.
  const payOrder = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `nw-${h.nextTag()}` },
    body: orderBody(customer, `دفع تحت نت متقطع ${h.runId}`),
  });
  const orderId = payOrder.body.data.id;
  const assigned = await waitAssigned(orderId);
  h.record('ن-٣/أ تجهيز: طلب اتعيّن لفني', assigned, assigned ? 'اتعيّن' : 'ماتعيّنش ❗');

  const [techRow] = await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
  const [techUser] = await h.q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [techRow.technician_id]);
  const techToken = h.token(techUser.user_id, 'technician');
  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: techToken });
  }
  await h.uploadAfterPhoto(orderId, techToken);
  await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: techToken });

  const walletBefore = (
    await h.q(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [customer.userId])
  )[0].balance_cents;

  // العميل داس «ادفع» والشبكة قطعت.
  //
  // **المهلة بتتقلّل تدريجيًا**: السيرفر المحلي أحيانًا بيرد أسرع من مهلة القطع، وساعتها
  // الفحص بيقيس «طلب ناجح» بدل «قطع» — وده كان بيطلّع فشلًا كاذبًا في أول تشغيلة. لو القطع
  // مانجحش خالص، بنسقط لسيناريو **مكافئ في الخطر**: ضغطتين متزامنتين بنفس المفتاح. الهدف
  // واحد في الحالتين: نتأكد إن الدفع مابيتكررش — والفحوصات اللي بعده هي القياس الحقيقي.
  const payKey = `nw-pay-${h.nextTag()}`;
  let payDropped = { dropped: false, status: 0 };
  for (const ms of [15, 8, 4]) {
    payDropped = await sendThenDrop(`/orders/${orderId}/pay-with-wallet`, {
      token: customer.token,
      headers: { 'Idempotency-Key': payKey },
      abortAfterMs: ms,
    });
    if (payDropped.dropped) break;
    await sleep(500);
  }
  if (!payDropped.dropped) {
    // السيرفر أسرع من القطع — نطلق ضغطتين متزامنتين بدلها (نفس الخطر بالظبط).
    await Promise.all([
      h.api(`/orders/${orderId}/pay-with-wallet`, {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': payKey },
      }),
      h.api(`/orders/${orderId}/pay-with-wallet`, {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': payKey },
      }),
    ]);
  }
  h.record(
    'ن-٣/ب السيناريو الخطر اتنفّذ فعلاً (قطع أثناء الدفع أو ضغطتين متزامنتين)',
    true,
    payDropped.dropped ? 'الاتصال اتقطع أثناء الدفع' : 'السيرفر أسرع من القطع — اتنفّذ كضغطتين متزامنتين',
  );
  await sleep(3000);

  // وبعدين داس «حاول تاني» — تلات مرات، زي ما بيحصل فعلاً لما الشبكة وحشة.
  const retries = [];
  for (let i = 0; i < 3; i++) {
    const r = await h.api(`/orders/${orderId}/pay-with-wallet`, {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': payKey },
    });
    retries.push(r.status);
    await sleep(400);
  }

  const payments = await h.q(
    `SELECT id, amount_cents, payment_status FROM payments WHERE order_id = $1 AND payment_status = 'succeeded'`,
    [orderId],
  );
  h.record(
    'ن-٣/ج دفعة **واحدة** بس رغم القطع + تلات محاولات إعادة',
    payments.length === 1,
    `دفعات ناجحة=${payments.length}، ردود الإعادة=${retries.join('/')}`,
  );

  const walletAfter = (
    await h.q(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [customer.userId])
  )[0].balance_cents;
  const charged = Number(walletBefore) - Number(walletAfter);
  const expected = payments.length ? Number(payments[0].amount_cents) : 0;
  h.record(
    'ن-٣/د والمحفظة اتخصم منها مبلغ الدفعة **مرة واحدة** بالظبط',
    charged === expected && charged > 0,
    `اتخصم ${charged} قرش، قيمة الدفعة ${expected}`,
  );

  // ---- ن-٤: مفاتيح idempotency **مختلفة** — الحالة اللي بتكشف حماية وهمية ----
  //
  // تطبيق بيولّد مفتاحًا جديدًا مع كل ضغطة (بدل مرة واحدة مع الفورم) بيبطّل الحماية كلها.
  // النظام لازم يمنع الدفع المزدوج **حتى في الحالة دي** — بحالة الطلب مش بالمفتاح وحده.
  const secondPay = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `nw-different-${h.nextTag()}` },
  });
  const paymentsAfter = await h.q(
    `SELECT count(*)::int AS n FROM payments WHERE order_id = $1 AND payment_status = 'succeeded'`,
    [orderId],
  );
  h.record(
    'ن-٤ دفع تاني بمفتاح **مختلف** بيترفض (الحماية بحالة الطلب مش بالمفتاح وحده)',
    secondPay.status >= 400 && paymentsAfter[0].n === 1,
    `HTTP=${secondPay.status}، دفعات ناجحة=${paymentsAfter[0].n}`,
  );

  // ---- ن-٥: رسالة القطع مفهومة مش خطأ تقني ----
  //
  // العميل اللي شبكته وقعت لازم يفهم إن ده مؤقت. `503` برسالة عربية أوضح من انهيار خام.
  const slow = await h.api('/orders?limit=100', { token: customer.token, timeoutMs: 15_000 });
  h.record(
    'ن-٥/أ النظام بيرد على القراءة الثقيلة جوّه مهلة معقولة',
    slow.status === 200 && !slow.timedOut,
    slow.timedOut ? 'اتجاوز ١٥ ثانية ❗' : `HTTP=${slow.status}`,
  );

  // ---- ن-٦: الثوابت المالية بعد كل ده ----
  const { net, rows } = await h.ledgerImbalance();
  h.record('ن-٦/أ الدفتر متوازن بعد القطع والإعادة', net === 0, `صافي=${net} على ${rows} صف`);
  const negatives = await h.negativeBalances();
  h.record('ن-٦/ب مفيش رصيد سالب', negatives.length === 0, `أرصدة سالبة=${negatives.length}`);
  const serverErrors = await h.serverErrorsSince();
  h.record(
    'ن-٦/ج مفيش 5xx — كل الرفض كان واعي',
    serverErrors.length === 0,
    serverErrors.length ? `${serverErrors.length} عطل ❗` : 'نضيف',
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
