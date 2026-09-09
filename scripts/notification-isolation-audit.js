#!/usr/bin/env node
/**
 * **ج-١٢ — الإشعارات ما توقّعش الـcore flow**.
 *
 * الإشعار **مساعد**، مش جزء من الصفقة. العميل اللي حجز وطلبه اتسجّل واتوزّع على فني لازم
 * ياخد `201` حتى لو FCM واقع وSMTP مرفوض وجدول الإشعارات نفسه بيرفض الكتابة. عكس ده — إن
 * فشل الإشعار يرجّع خطأ للعميل — بيحوّل عطل تجميلي لانقطاع خدمة، وده بالظبط عكس قاعدة المالك:
 * «ضعيف بطيء ماشي، بس ما يقعش».
 *
 * **الخطر البنيوي هنا مش نظري**: `OrdersService` بينادي `emitAsync(ORDER_CREATED_EVENT)`
 * و**بيستنى** كل المستمعين (مقصود — التوزيع لازم يخلص قبل الرد، راجع التعليق في
 * `order-creation.service.ts`). `emitAsync` بترمي لو **أي** مستمع رمى. يعني مستمع إشعارات
 * واحد بلا حماية = العميل بياخد `500` على طلب **اتسجّل واتوزّع بالفعل**. أسوأ نتيجة ممكنة:
 * الطلب موجود، والعميل فاكر إنه فشل، فبيعيد.
 *
 * التدقيق ده بيعطّل مسار الإشعارات **بالكامل على مستوى القاعدة** (trigger بيرفض أي INSERT في
 * `notifications`) وبعدين بيمشّي رحلة العميل الكاملة. الحقن ده أقسى من انقطاع FCM: حتى تسجيل
 * الإشعار محليًا بيفشل.
 *
 * الحقن **قابل للعكس بالكامل** — الـtrigger بيتشال في الآخر مهما حصل.
 *
 *   node scripts/notification-isolation-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('nt');
let injected = false;

/** trigger بيرفض أي كتابة في `notifications` — بيحاكي «مسار الإشعارات ميت تمامًا». */
async function breakNotifications() {
  await h.q(`
    CREATE OR REPLACE FUNCTION baytak_audit_break_notifications() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'تدقيق ج-١٢: مسار الإشعارات معطّل عمدًا';
    END;
    $$ LANGUAGE plpgsql;
  `);
  await h.q(`DROP TRIGGER IF EXISTS baytak_audit_break_notifications ON notifications`);
  await h.q(`
    CREATE TRIGGER baytak_audit_break_notifications
      BEFORE INSERT ON notifications
      FOR EACH ROW EXECUTE FUNCTION baytak_audit_break_notifications();
  `);
  injected = true;
}

async function healNotifications() {
  if (!injected) return;
  await h.q(`DROP TRIGGER IF EXISTS baytak_audit_break_notifications ON notifications`).catch(() => {});
  await h.q(`DROP FUNCTION IF EXISTS baytak_audit_break_notifications()`).catch(() => {});
  injected = false;
}

async function statusOf(orderId) {
  const [row] = await h.q(`SELECT order_status, payment_status, technician_id FROM orders WHERE id = $1`, [orderId]);
  return row;
}

async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const row = await statusOf(orderId);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return statusOf(orderId);
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٢: عزل الإشعارات عن المسار الأساسي — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  const customer = await h.makeCustomer('nt');
  const tech = await h.makeTechnician('nt');
  await h.fundWallet(customer.userId, 1_000_000);

  // ---- ش-٠: خط الأساس — الإشعارات شغّالة، فبنعرف إن الفلو نفسه سليم ----
  //
  // من غير الخط ده، «الفلو نجح والإشعارات مكسورة» ممكن يكون معناه إن الإشعارات مابتتكتبش أصلاً
  // في الحالتين — يعني الفحص مش بيقيس حاجة.
  const baselineOrder = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'خط أساس ج-١٢',
    },
  });
  h.record('ش-٠/أ الفلو شغّال والإشعارات سليمة (خط الأساس)', baselineOrder.status === 201, `HTTP=${baselineOrder.status}`);
  await waitAssigned(baselineOrder.body?.data?.id);
  await sleep(1500);
  const [baseNotif] = await h.q(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id IN ($1, $2)`,
    [customer.userId, tech.userId],
  );
  h.record(
    'ش-٠/ب وإشعارات فعلاً اتكتبت (فالفحص تحت له معنى)',
    baseNotif.n > 0,
    `إشعارات=${baseNotif.n}`,
  );

  // ---- ش-١: مسار الإشعارات ميت تمامًا ----
  await breakNotifications();
  const check = await h.q(`SELECT 1 FROM pg_trigger WHERE tgname = 'baytak_audit_break_notifications'`);
  h.record('ش-١/أ الحقن اتطبّق فعلاً (أي كتابة إشعار هتفشل دلوقتي)', check.length === 1, 'trigger موجود');

  // ---- ش-٢: رحلة العميل الكاملة والإشعارات ميتة ----
  const t0 = Date.now();
  const order = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق عزل الإشعارات',
    },
  });
  const createMs = Date.now() - t0;
  h.record(
    'ش-٢/أ إنشاء الطلب نجح والإشعارات ميتة (الأهم في البند كله)',
    order.status === 201,
    `HTTP=${order.status} في ${createMs}ms${order.status !== 201 ? ` — ${JSON.stringify(order.body).slice(0, 200)}` : ''}`,
  );
  if (order.status !== 201) return finish();
  const orderId = order.body.data.id;

  // **التوزيع مش إشعار** — هو جزء أساسي من دورة الطلب وبيتنفّذ في نفس `emitAsync`. لو فشل
  // الإشعار عطّل الحدث كله، الطلب هيفضل بلا فني: عميل مستني ومحدش رايح له.
  const assigned = await waitAssigned(orderId);
  h.record(
    'ش-٢/ب والتوزيع للفني اشتغل عادي (فشل الإشعار ماعطّلش الحدث كله)',
    !!assigned?.technician_id,
    assigned?.technician_id ? `اتعيّن (${assigned.order_status})` : `مااتعيّنش — ${assigned?.order_status} ❗`,
  );

  // باقي الرحلة: كل خطوة بتطلق إشعارات كمان.
  const steps = [
    ['ش-٢/ج الفني: في الطريق', `/technician/orders/${orderId}/depart`],
    ['ش-٢/د الفني: وصل', `/technician/orders/${orderId}/arrive`],
    ['ش-٢/هـ الفني: بدأ الشغل', `/technician/orders/${orderId}/start`],
  ];
  for (const [name, pathname] of steps) {
    const res = await h.api(pathname, { method: 'POST', token: tech.token });
    h.record(name, res.status === 200 || res.status === 201, `HTTP=${res.status}`);
  }

  const photo = await h.uploadAfterPhoto(orderId, tech.token);
  const complete = await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });
  h.record(
    'ش-٢/و الفني قفل الشغل (رفع الصورة + الإقفال)',
    complete.status === 200 || complete.status === 201,
    `رفع=${photo.status} إقفال=${complete.status}`,
  );

  // **الدفع** — أخطر خطوة على الإطلاق مع إشعارات مكسورة: لو فشل إشعار «تم الدفع» رجع خطأ
  // للعميل بعد ما الفلوس اتخصمت، العميل هيدفع تاني.
  const pay = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `nt-${h.nextTag()}` },
  });
  h.record(
    'ش-٢/ز الدفع من المحفظة نجح والإشعارات ميتة',
    pay.status === 200 || pay.status === 201,
    `HTTP=${pay.status}${pay.status >= 400 ? ` — ${JSON.stringify(pay.body).slice(0, 200)}` : ''}`,
  );

  const finalState = await statusOf(orderId);
  h.record(
    'ش-٢/ح الطلب وصل لحالته النهائية الصحيحة',
    finalState?.payment_status === 'succeeded' || finalState?.order_status === 'completed',
    `الحالة=${finalState?.order_status} الدفع=${finalState?.payment_status}`,
  );

  // ---- ش-٣: الدفتر سليم — الفلوس مش بتتأثر بعطل تجميلي ----
  const { net, rows } = await h.ledgerImbalance();
  h.record('ش-٣/أ الدفتر متوازن رغم عطل الإشعارات', net === 0, `صافي=${net} على ${rows} صف`);
  const negatives = await h.negativeBalances();
  h.record('ش-٣/ب مفيش رصيد سالب', negatives.length === 0, `أرصدة سالبة=${negatives.length}`);

  // ---- ش-٤: الإلغاء كمان (مسار تاني بيطلق إشعارات) ----
  const other = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'إلغاء والإشعارات ميتة',
    },
  });
  if (other.status === 201) {
    await sleep(2000);
    const reasons = await h.api('/cancellation-reasons?applies_to=customer');
    const list = Array.isArray(reasons.body?.data) ? reasons.body.data : reasons.body;
    const cancel = await h.api(`/orders/${other.body.data.id}/cancel`, {
      method: 'POST',
      token: customer.token,
      body: { cancellation_reason_id: Array.isArray(list) && list.length ? list[0].id : undefined },
    });
    h.record(
      'ش-٤/أ إلغاء العميل نجح والإشعارات ميتة',
      cancel.status === 200 || cancel.status === 201,
      `HTTP=${cancel.status}`,
    );
  } else {
    h.record('ش-٤/أ إلغاء العميل نجح والإشعارات ميتة', false, `فشل إنشاء الطلب التاني HTTP=${other.status}`);
  }

  // ---- ش-٥: مفيش 5xx وصل للعميل طول التشغيلة ----
  //
  // القاعدة اللي المالك قالها بالحرف: «ما يقعش». نجاح كل خطوة فوق ممكن يخفي `500` عابر في
  // نداء تاني — الفحص ده بيقرا سجل الأعطال الحقيقي بتاع الباك-إند.
  const serverErrors = await h.serverErrorsSince();
  h.record(
    'ش-٥/أ صفر رد 5xx من الباك-إند طول التشغيلة',
    serverErrors.length === 0,
    serverErrors.length ? `${serverErrors.length} عطل: ${serverErrors.slice(0, 3).map((e) => e.path ?? e).join('، ')} ❗` : 'نضيف',
  );

  // ---- ش-٦: الرجوع للطبيعي — الإشعارات بتشتغل تاني بلا إعادة تشغيل ----
  await healNotifications();
  const afterHeal = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'بعد رجوع الإشعارات',
    },
  });
  await sleep(2500);
  const [healed] = await h.q(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND created_at > now() - interval '1 minute'`,
    [customer.userId],
  );
  h.record(
    'ش-٦/أ الإشعارات رجعت لوحدها بعد ما العطل اتصلح (بلا إعادة تشغيل)',
    afterHeal.status === 201 && healed.n > 0,
    `HTTP=${afterHeal.status}، إشعارات جديدة=${healed.n}`,
  );

  await finish();
}

async function finish() {
  await healNotifications();
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
  // **الأهم**: الحقن لازم يتشال حتى لو التدقيق نفسه انهار — وإلا القاعدة بتفضل مكسورة.
  await healNotifications().catch(() => {});
  await h.close();
  process.exit(2);
});
