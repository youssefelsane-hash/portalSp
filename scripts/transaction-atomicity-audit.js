#!/usr/bin/env node
/**
 * **ج-٥ — Transactions & Race Conditions**: «الحجز والجدولة والدفع والمحفظة والصرف والتعيين
 * ينجحوا مع بعض أو يفشلوا مع بعض».
 *
 * الفرق عن ج-١ وج-٢: هناك السؤال كان «هل التزامن بيكسر عملية واحدة؟». هنا السؤال أوسع وأصعب:
 * **هل ممكن نص عملية تعيش؟** — طلب بلا سجل حالة، تسوية بلا أنصبة، سلوت جدول متحجز لطلب ملغي،
 * صرف اتحجز بلا رصيد، تعيين اتسجّل مرتين. النوع ده من الفساد **مابيرميش خطأ لحظتها** — بيظهر
 * بعد أسابيع كأرقام مالية غلط أو فني محجوز في يوم فاضي.
 *
 * المنهج: كل سيناريو بيعمل عملية حقيقية عبر HTTP (نجاح أو فشل مقصود)، وبعدين بيسأل القاعدة
 * سؤال **بنيوي** مش سؤال عن الـHTTP response: «هل الأثر كامل ولا نصّه؟».
 *
 *   node scripts/transaction-atomicity-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('tx');
let admin;

async function orderRow(orderId) {
  const [row] = await h.q(
    `SELECT order_status, technician_id, total_amount_cents, cancelled_at, scheduled_at
       FROM orders WHERE id = $1`,
    [orderId],
  );
  return row ?? null;
}

async function createOrder(customer, extra = {}) {
  return h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق ذرّية المعاملات',
      ...extra,
    },
  });
}

async function waitAssigned(orderId, maxSeconds = 30) {
  for (let i = 0; i < maxSeconds * 2; i++) {
    const row = await orderRow(orderId);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return orderRow(orderId);
}

/**
 * **ت-١ — إنشاء طلب متزامن بنفس مفتاح الـidempotency.**
 *
 * النجاح مش «رد واحد 201». النجاح إن **الأثر الجانبي** كمان واحد: صف طلب واحد، وسجل حالة واحد،
 * وسلوت جدول واحد. لو الترانزاكشن مش لافّة كل ده، ممكن نلاقي ردّين ناجحين بطلب واحد وسجلّين.
 */
async function idempotentCreateSideEffects() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('idm');
  const customer = await h.makeCustomer('idm');
  const key = `tx-create-${h.nextTag()}`;
  const day = h.nextDay();

  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      h.api('/orders', {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': key },
        body: {
          service_id: h.catalog.service.id,
          address_id: customer.addressId,
          scheduled_at: day,
          problem_description: 'تدقيق ذرّية المعاملات',
        },
      }),
    ),
  );
  const created = results.filter((r) => r.status === 201);
  const ids = new Set(created.map((r) => r.body?.data?.id).filter(Boolean));

  h.record(
    'ت-١/أ ٦ نداءات متزامنة بنفس المفتاح → معرّف طلب واحد',
    ids.size === 1,
    `أكواد=${JSON.stringify(results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}))} معرّفات=${ids.size}`,
  );
  if (ids.size !== 1) return;

  const orderId = [...ids][0];
  await waitAssigned(orderId);
  const [{ orders_count }] = await h.q(
    `SELECT count(*)::int AS orders_count FROM orders WHERE customer_id = $1 AND deleted_at IS NULL`,
    [customer.profileId],
  );
  h.record('ت-١/ب صف طلب واحد في القاعدة (مفيش طلب يتيم اتخلق ورا)', orders_count === 1, `صفوف=${orders_count}`);

  // نفس الطلب مايتسجّلش مرتين في تاريخ الحالة لنفس الانتقال.
  const dupHistory = await h.q(
    `SELECT previous_status, new_status, count(*)::int AS n
       FROM order_status_history WHERE order_id = $1
      GROUP BY 1,2 HAVING count(*) > 1`,
    [orderId],
  );
  h.record(
    'ت-١/ج مفيش انتقال حالة متسجّل مرتين لنفس الطلب',
    dupHistory.length === 0,
    dupHistory.length ? JSON.stringify(dupHistory) : 'نضيف',
  );

  const slots = await h.q(
    `SELECT count(*)::int AS n FROM technician_schedule_slots WHERE order_id = $1 AND status = 'booked'`,
    [orderId],
  );
  h.record('ت-١/د سلوت جدول واحد كحد أقصى للطلب', slots[0].n <= 1, `سلوتس محجوزة=${slots[0].n}`);
  return { tech, customer, orderId };
}

/**
 * **ت-٢ — إنشاء فشل: صفر أثر جزئي.**
 *
 * الفشل هنا مقصود وبيحصل **جوّه** الخدمة مش عند حارس الـDTO: عنوان بتاع عميل تاني. الشكل ده
 * أخطر من مدخل غلط شكلًا، لأنه بيعدّي كل التحقق السطحي ويوصل لقلب `create()`.
 */
async function failedCreateLeavesNothing() {
  await h.seedCatalog();
  await h.makeTechnician('fai');
  const victim = await h.makeCustomer('vic');
  const attacker = await h.makeCustomer('atk');

  const res = await h.api('/orders', {
    method: 'POST',
    token: attacker.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: victim.addressId, // عنوان مش بتاعه
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق ذرّية المعاملات',
    },
  });
  h.record(
    'ت-٢/أ إنشاء بعنوان مش بتاع العميل → رفض واضح (مش 5xx)',
    res.status >= 400 && res.status < 500,
    `HTTP=${res.status} «${String(res.body?.error?.message ?? '').slice(0, 90)}»`,
  );

  await sleep(1500);
  const [{ n }] = await h.q(
    `SELECT count(*)::int AS n FROM orders WHERE customer_id = $1`,
    [attacker.profileId],
  );
  h.record('ت-٢/ب صفر صفوف طلبات اتخلقت من المحاولة الفاشلة', n === 0, `صفوف=${n}`);
}

/**
 * **ت-٣ — صرف متزامن: الرصيد مايتصرفش مرتين.**
 *
 * الفني رصيده يكفي طلب صرف واحد بس، وبيبعت خمسة بالتوازي. المطلوب: واحد بس ينجح، والرصيد
 * المتاح مايبقاش سالب، والمحجوز يساوي المبلغ اللي نجح — لا أكتر ولا أقل.
 */
async function concurrentPayoutRequests() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('pay');
  // الحد الأدنى الحقيقي للصرف من الإعدادات (`payouts.min_amount_cents` = 20000)، فالمبالغ
  // هنا لازم تكون فوقه وإلا الرفض بيبقى تحقق مدخلات مش سباق تزامن.
  const BALANCE = 300_000;
  const AMOUNT = 250_000;
  await h.q(
    `INSERT INTO wallets (owner_user_id, owner_type, balance_cents) VALUES ($1,'technician',$2)
     ON CONFLICT (owner_user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents, reserved_balance_cents = 0`,
    [tech.userId, BALANCE],
  );

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      h.api('/technician/payouts', {
        method: 'POST',
        token: tech.token,
        body: { amount_cents: AMOUNT, payout_method: 'bank_transfer', destination_masked: '****1234' },
      }),
    ),
  );
  const ok = results.filter((r) => r.status === 201 || r.status === 200).length;
  h.record(
    'ت-٣/أ خمس طلبات صرف متزامنة برصيد يكفي واحد → واحد بس ينجح',
    ok === 1,
    `أكواد=${JSON.stringify(results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}))}`,
  );

  const [w] = await h.q(
    `SELECT balance_cents, reserved_balance_cents FROM wallets WHERE owner_user_id = $1`,
    [tech.userId],
  );
  h.record(
    'ت-٣/ب الرصيد المتاح مابقاش سالب والمحجوز يطابق اللي نجح',
    Number(w.balance_cents) >= 0 && Number(w.reserved_balance_cents) === ok * AMOUNT,
    `الرصيد=${w.balance_cents} المحجوز=${w.reserved_balance_cents} (المتوقع ${ok * AMOUNT})`,
  );

  const [p] = await h.q(
    `SELECT count(*)::int AS n, COALESCE(SUM(amount_cents),0)::int AS total
       FROM payouts WHERE wallet_id = (SELECT id FROM wallets WHERE owner_user_id = $1)`,
    [tech.userId],
  );
  h.record(
    'ت-٣/ج عدد صفوف الصرف يطابق عدد الردود الناجحة (مفيش صف يتيم بلا حجز)',
    p.n === ok && p.total === ok * AMOUNT,
    `صفوف=${p.n} مجموع=${p.total}`,
  );
}

/**
 * **ت-٤ — تسوية الدفع: الأثر كامل أو مفيش.**
 *
 * الدفع الناجح لازم يخلّف **أربع حاجات مع بعض**: صف دفع مكتمل، قيود دفتر مجموعها صفر، أنصبة
 * أرباح للمنفّذين، وحالة الطلب `completed`. لو واحدة ناقصة، التسوية اتقطعت في النص.
 */
async function settlementIsAllOrNothing() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('stl');
  const customer = await h.makeCustomer('stl');
  await h.fundWallet(customer.userId, 500_000);

  const res = await createOrder(customer);
  if (res.status !== 201) {
    h.record('ت-٤ إنشاء الطلب', false, `HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  const assigned = await waitAssigned(orderId);
  if (!assigned?.technician_id) {
    h.record('ت-٤ التوزيع عيّن فني', false, `الحالة=${assigned?.order_status}`);
    return;
  }

  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
  }
  const media = await h.uploadAfterPhoto(orderId, tech.token);
  const done = await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });
  if (done.status !== 201 && done.status !== 200) {
    h.record('ت-٤ إقفال الشغل قبل الدفع', false, `HTTP=${done.status} «${String(done.body?.error?.message ?? '').slice(0, 90)}» صورة=${JSON.stringify(media.status)} ${String(media.body?.error?.message ?? '').slice(0,70)}`);
    return;
  }

  const pay = await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `tx-settle-${h.nextTag()}` },
  });
  h.record('ت-٤/أ الدفع من المحفظة نجح', pay.status === 201, `HTTP=${pay.status} «${String(pay.body?.error?.message ?? '').slice(0, 80)}»`);
  if (pay.status !== 201) return;

  await sleep(2500);
  const [row] = await h.q(
    `SELECT o.order_status,
            (SELECT count(*)::int FROM payments p WHERE p.order_id = o.id AND p.payment_status = 'succeeded') AS payments,
            (SELECT count(*)::int FROM order_earning_shares s WHERE s.order_id = o.id) AS shares,
            -- wallet_transactions مالهاش عمود order_id؛ الربط بالطلب عبر reference_id
            -- (النمط العام لكل قيود الدفتر في المشروع).
            (SELECT COALESCE(SUM(CASE WHEN wt.direction = 'debit' THEN wt.amount_cents ELSE -wt.amount_cents END),0)::int
               FROM wallet_transactions wt WHERE wt.reference_id = o.id) AS ledger_net,
            (SELECT count(*)::int FROM wallet_transactions wt WHERE wt.reference_id = o.id) AS ledger_rows
       FROM orders o WHERE o.id = $1`,
    [orderId],
  );
  const complete =
    row.order_status === 'completed' && row.payments === 1 && row.shares > 0 && row.ledger_rows > 0 && row.ledger_net === 0;
  h.record(
    'ت-٤/ب الأثر الأربعة موجودين مع بعض (حالة + دفع + أنصبة + دفتر متوازن)',
    complete,
    `الحالة=${row.order_status} دفعات=${row.payments} أنصبة=${row.shares} قيود=${row.ledger_rows} صافي=${row.ledger_net}`,
  );
  return { orderId, tech, customer };
}

/**
 * **ت-٥ — الإلغاء بيفك سلوت الجدول.**
 *
 * سلوت متحجز لطلب ملغي معناه فني محجوز في يوم فاضي — عطل مايرميش خطأ ومايبانش غير لما عميل
 * تاني يلاقي «مفيش فنيين متاحين» في يوم فيه فنيين فاضيين فعلاً.
 */
async function cancellationReleasesSlot() {
  await h.seedCatalog();
  const tech = await h.makeTechnician('cnl');
  const customer = await h.makeCustomer('cnl');
  const res = await createOrder(customer);
  if (res.status !== 201) {
    h.record('ت-٥ إنشاء الطلب', false, `HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  await waitAssigned(orderId);

  const [reason] = await h.q(
    `SELECT id FROM cancellation_reasons WHERE applies_to = 'customer' AND is_active = true
      ORDER BY display_order LIMIT 1`,
  );
  const cancel = await h.api(`/orders/${orderId}/cancel`, {
    method: 'POST',
    token: customer.token,
    body: { cancellation_reason_id: reason?.id, reason: 'تدقيق ذرّية' },
  });
  h.record('ت-٥/أ الإلغاء نجح', cancel.status === 201 || cancel.status === 200, `HTTP=${cancel.status}`);

  await sleep(2000);
  const [{ n }] = await h.q(
    `SELECT count(*)::int AS n FROM technician_schedule_slots WHERE order_id = $1 AND status = 'booked'`,
    [orderId],
  );
  h.record('ت-٥/ب مفيش سلوت جدول لسه محجوز للطلب الملغي', n === 0, `سلوتس محجوزة=${n}`);
  return { tech, customer, orderId };
}

/**
 * **ت-٦ — ثوابت بنيوية على كل بيانات التشغيلة.**
 *
 * الأسئلة دي مش عن سيناريو بعينه — دي «هل فيه نص عملية عايش في أي حتة؟». بتتسأل على بيانات
 * التشغيلة دي بس (`created_at >= startedAt`) لأن قاعدة التطوير فيها بقايا تشغيلات قديمة اتمسح
 * نصّها مع تنظيف المستخدمين.
 */
async function structuralInvariants() {
  const checks = [
    {
      name: 'ت-٦/أ مفيش قيد دفتر بلا محفظة موجودة',
      sql: `SELECT count(*)::int AS n FROM wallet_transactions wt
             LEFT JOIN wallets w ON w.id = wt.wallet_id
            WHERE wt.created_at >= $1 AND w.id IS NULL`,
    },
    {
      name: 'ت-٦/ب مفيش نصيب أرباح لطلب مش مدفوع',
      sql: `SELECT count(*)::int AS n FROM order_earning_shares s
             JOIN orders o ON o.id = s.order_id
            WHERE s.created_at >= $1
              AND o.order_status NOT IN ('completed','refunded','disputed','awaiting_payment','work_completed')`,
    },
    {
      name: 'ت-٦/ج مفيش سلوت جدول محجوز لطلب ملغي/مكتمل',
      sql: `SELECT count(*)::int AS n FROM technician_schedule_slots s
             JOIN orders o ON o.id = s.order_id
            WHERE s.created_at >= $1 AND s.status = 'booked'
              AND o.order_status IN ('cancelled_by_customer','cancelled_by_technician','cancelled_by_system','completed','refunded')`,
    },
    {
      name: 'ت-٦/د مفيش تعيين مقبول مكرّر لنفس الطلب',
      sql: `SELECT count(*)::int AS n FROM (
              SELECT order_id FROM order_assignments
               WHERE sent_at >= $1 AND assignment_status = 'accepted'
               GROUP BY order_id HAVING count(*) > 1
            ) dup`,
    },
    {
      name: 'ت-٦/هـ مفيش صرف مبلغه أكبر من المحجوز في محفظته',
      sql: `SELECT count(*)::int AS n FROM wallets w
            WHERE w.created_at >= $1
              AND w.reserved_balance_cents < (
                SELECT COALESCE(SUM(p.amount_cents),0) FROM payouts p
                 WHERE p.wallet_id = w.id AND p.payout_status IN ('under_review','approved')
              )`,
    },
    {
      name: 'ت-٦/و مفيش طلب معيَّن لفني متحذف',
      sql: `SELECT count(*)::int AS n FROM orders o
             JOIN technician_profiles tp ON tp.id = o.technician_id
            WHERE o.created_at >= $1 AND tp.deleted_at IS NOT NULL
              AND o.order_status NOT IN ('cancelled_by_customer','cancelled_by_technician','cancelled_by_system')`,
    },
  ];

  for (const check of checks) {
    const [{ n }] = await h.q(check.sql, [h.startedAt]);
    h.record(check.name, n === 0, n === 0 ? 'نضيف' : `مخالفات=${n} ❗`);
  }

  const imbalance = await h.ledgerImbalance();
  h.record('ت-٦/ز دفتر التشغيلة متوازن', imbalance.net === 0, `قيود=${imbalance.rows} صافي=${imbalance.net}`);
  const negatives = await h.negativeBalances();
  h.record('ت-٦/ح مفيش رصيد عميل/فني سالب', negatives.length === 0, negatives.length ? JSON.stringify(negatives) : 'نضيف');
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-٥: ذرّية المعاملات وسباقات التزامن — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  admin = await h.makeAdmin();
  void admin;

  await idempotentCreateSideEffects();
  await failedCreateLeavesNothing();
  await concurrentPayoutRequests();
  await settlementIsAllOrNothing();
  await cancellationReleasesSlot();
  await structuralInvariants();

  const errors = await h.serverErrorsSince();
  h.record(
    'صفر 5xx في كل التشغيلة',
    errors.length === 0,
    errors.length ? errors.map((e) => `${e.url} :: ${e.message}`).slice(0, 4).join(' | ') : 'مفيش',
  );

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
