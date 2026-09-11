#!/usr/bin/env node
/**
 * **تدقيق مسارات الفلوس كلها — مصدر حقيقة واحد** (طلب المالك 2026-09-11).
 *
 * > «عايزك تمشّي كل مسارات الفلوس: الفلوس الداخلة والخارجة، العمولة، التوزيع على الفنيين
 * > والمساعدين والفرق، والمساعد اللي قائد فريق لازم يتعامل بالظبط زي الفني. وتتأكد إن أرقام
 * > الـKPI متطابقة مع اللوحة المالية والتقارير ولوحة الأدمن، وإن أي تغيير بيتعكس في كل حتة.»
 *
 * المنهج: كل سيناريو بيتبني فعليًا (طلب + طاقم)، بيتسوّى عبر **الـAPI الحقيقي**
 * (`collect-cash` ← `settleAndComplete`)، وبعدين كل سطح قراءة بيتقري من مكانه الحقيقي وبيتقارن
 * بالقاعدة. مش بنعيد حساب أي رقم هنا بمعادلة موازية — الفكرة بالظبط إننا نمسك سطح بيحسب لوحده.
 *
 * السيناريوهات:
 *   أ — فني لوحده
 *   ب — فني قائد + مساعد
 *   ج — فني قائد + فني عضو + مساعد
 *   د — **مساعد لوحده (قائد)** ← ADR-0055، وده اللي كان مكسور
 *   هـ — مساعد قائد + مساعد عضو
 *
 * الثوابت اللي بتتفحص على كل سيناريو مذكورة بالاسم في الإخراج.
 *
 * التشغيل: `node scripts/money-paths-audit.js [--verbose]`
 * محتاج API شغّال. بينضّف وراه بالكامل.
 */
'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');
const { LiveHarness } = require('./lib/live-harness');

const VERBOSE = process.argv.includes('--verbose');
const egp = (c) => `${(Number(c) / 100).toFixed(2)}`;
const PRICE_CENTS = 100_000;
const COMMISSION_PCT = 25;

const failures = [];
const checks = [];
let moneyBefore = null;

/** نطاق اللوحة المالية — اليوم كله بتوقيت UTC، بيغطي كل اللي التدقيق بيعمله. */
const RANGE = (() => {
  const today = new Date();
  const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const next = new Date(day.getTime() + 86_400_000);
  return { from: day.toISOString().slice(0, 10), to: next.toISOString().slice(0, 10) };
})();

function check(scenario, name, actual, expected, note) {
  const ok = actual === expected;
  checks.push({ scenario, name, ok });
  if (!ok) failures.push({ scenario, name, actual, expected, note });
  if (VERBOSE || !ok) {
    const mark = ok ? '  ✓' : '  ✗';
    console.log(`${mark} ${name}${ok ? '' : `  — طلع ${actual}، المفروض ${expected}${note ? ` (${note})` : ''}`}`);
  }
}

/** مجموع أرقام — بيرجع Number دايمًا عشان أعمدة bigint بترجع نصوص من pg. */
const sum = (rows, field) => rows.reduce((acc, row) => acc + Number(row[field] ?? 0), 0);

async function buildAndSettle(h, catalog, customer, { leader, members = [], label }) {
  const [order] = await h.q(
    `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
       service_zone_id, technician_id, order_status, payment_status, total_amount_cents,
       commissionable_base_cents, technician_earning_cents, booking_mode, settlement_policy_version,
       payment_method)
     VALUES ($7,$1,$2,$3,$4,$5,$6,'work_completed','unpaid',$8,$8,0,'individual',2,'cash')
     RETURNING id, order_number`,
    [`MPA-${label}-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
     catalog.zone.id, leader.id, COMMISSION_PCT, PRICE_CENTS],
  );

  for (const member of members) {
    await h.q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [order.id, member.tech.id, member.memberType === 'assistant' ? 'مساعد' : 'فني', member.memberType, leader.id],
    );
  }

  const res = await h.api(`/technician/orders/${order.id}/collect-cash`, { method: 'POST', token: leader.token });
  return { order, settleStatus: res.status, settleBody: res.body };
}

async function auditScenario(h, ctx, spec) {
  const { catalog, customer, admin } = ctx;
  console.log(`\n═══ ${spec.title} ═══`);

  const { order, settleStatus, settleBody } = await buildAndSettle(h, catalog, customer, spec);

  // ① التسوية نفسها نجحت — لو فشلت، الطلب بيتعلّق والفلوس ما بتوصلش لحد.
  check(spec.title, 'التسوية عدّت (collect-cash)', settleStatus, 201,
    settleStatus !== 201 ? JSON.stringify(settleBody?.error ?? settleBody).slice(0, 160) : undefined);
  if (settleStatus !== 201) return order.id;

  const [row] = await h.q(
    `SELECT total_amount_cents, platform_commission_cents, technician_earning_cents,
            order_status, payment_status
       FROM orders WHERE id = $1`,
    [order.id],
  );
  const total = Number(row.total_amount_cents);
  const platform = Number(row.platform_commission_cents);
  const shares = await h.q(
    `SELECT technician_id, earning_role, participant_role, share_cents, technician_kind_snapshot,
            (participant_role = 'leader') AS is_leader
       FROM order_earning_shares WHERE order_id = $1 AND deleted_at IS NULL
      ORDER BY (participant_role = 'leader') DESC`,
    [order.id],
  );
  const sharesTotal = sum(shares, 'share_cents');

  check(spec.title, 'الطلب اتقفل', row.order_status, 'completed');
  check(spec.title, 'الدفع اتسجّل', row.payment_status, 'paid');

  // ② الثابت الجوهري: مجموع الحصص + عمولة المنصة = إجمالي الطلب. مفيش قرش بيضيع ولا بيتخلق.
  check(spec.title, 'مجموع الحصص + العمولة = إجمالي الطلب', sharesTotal + platform, total,
    `الحصص ${egp(sharesTotal)} + العمولة ${egp(platform)} ≠ ${egp(total)}`);
  check(spec.title, 'عمود technician_earning_cents = مجموع الحصص',
    Number(row.technician_earning_cents), sharesTotal);
  check(spec.title, 'عدد المشاركين', shares.length, spec.expectedParticipants);
  check(spec.title, 'قائد واحد بالظبط', shares.filter((s) => s.is_leader).length, 1);
  check(spec.title, 'دور القائد في القسمة',
    shares.find((s) => s.is_leader)?.earning_role, 'technician',
    'ADR-0055: القائد بياخد تسعيرة قائد أيًا كان نوع حسابه');

  // ③ الفلوس وصلت المنفّذين فعلاً — مش بس اتحسبت في جدول.
  //
  // **الطلب كاش، والقائد هو اللي استلم من العميل**، فحركة محفظته = حصته ناقص اللي ماسكه.
  // بتطلع **سالبة** لما الكاش أكبر من حصته (خصم عمولة = دَين مشروع عليه يتسوّى في الصرف
  // الجاي) — وده صح محاسبيًا مش خلل. الأعضاء مبيمسكوش كاش فبياخدوا حصتهم تحويل مباشر.
  const [cashRow] = await h.q(
    `SELECT COALESCE(SUM(amount_cents),0) AS cash
       FROM payments WHERE order_id = $1 AND payment_method = 'cash' AND payment_status = 'succeeded'`,
    [order.id],
  );
  const cashHeld = Number(cashRow.cash);
  const walletNet = await h.q(
    `SELECT tp.id AS technician_id,
            COALESCE(SUM(CASE WHEN t.direction = 'credit' THEN t.amount_cents ELSE -t.amount_cents END),0) AS net
       FROM wallet_transactions t
       JOIN wallets w ON w.id = t.wallet_id
       JOIN technician_profiles tp ON tp.user_id = w.owner_user_id
      WHERE t.reference_type = 'order' AND t.reference_id = $1
      GROUP BY tp.id`,
    [order.id],
  );
  for (const share of shares) {
    const net = Number(walletNet.find((c) => c.technician_id === share.technician_id)?.net ?? 0);
    const expected = share.is_leader ? Number(share.share_cents) - cashHeld : Number(share.share_cents);
    check(spec.title, `حركة محفظة ${share.is_leader ? 'القائد' : String(share.technician_id).slice(0, 8)}`,
      net, expected, share.is_leader ? `حصته ${egp(share.share_cents)} − كاش ماسكه ${egp(cashHeld)}` : undefined);
  }
  // الثابت المجمّع: اللي الطاقم خرج بيه (محافظ + كاش في إيد القائد) = وعاء المنفّذين بالظبط.
  check(spec.title, 'محافظ الطاقم + الكاش اللي في إيد القائد = وعاء المنفّذين',
    sum(walletNet, 'net') + cashHeld, sharesTotal);

  // ④ لوحة الأدمن: حصص الطلب + الملخص المالي — لازم يطابقوا القاعدة بالقرش.
  const adminShares = await h.api(`/admin/orders/${order.id}/earning-shares`, { token: admin.token });
  check(spec.title, 'شاشة حصص الطلب في الأدمن ردّت', adminShares.status, 200);
  if (adminShares.status === 200) {
    const list = adminShares.body?.data?.shares ?? adminShares.body?.data ?? [];
    check(spec.title, 'عدد الحصص في الأدمن = القاعدة', Array.isArray(list) ? list.length : -1, shares.length);
    if (Array.isArray(list)) {
      check(spec.title, 'مجموع الحصص في الأدمن = القاعدة', sum(list, 'share_cents'), sharesTotal);
    }
  }

  const summary = await h.api(`/admin/orders/${order.id}/financial-summary`, { token: admin.token });
  check(spec.title, 'الملخص المالي في الأدمن ردّ', summary.status, 200);
  if (summary.status === 200) {
    const d = summary.body?.data ?? {};
    if (d.platform_commission_cents !== undefined) {
      check(spec.title, 'عمولة المنصة في الملخص = القاعدة', Number(d.platform_commission_cents), platform);
    }
    if (d.technician_earning_cents !== undefined) {
      check(spec.title, 'مستحق المنفّذين في الملخص = مجموع الحصص',
        Number(d.technician_earning_cents), sharesTotal);
    }
  }

  // ⑤ «مستحقاتي» عند كل مشارك — نفس الرقم اللي في حصته، من سطح مختلف تمامًا.
  for (const participant of [spec.leader, ...spec.members.map((m) => m.tech)]) {
    const share = shares.find((s) => s.technician_id === participant.id);
    const statement = await h.api(`/admin/technicians/${participant.id}/earnings/statement`, { token: admin.token });
    if (statement.status !== 200) {
      check(spec.title, `كشف حساب ${participant.id.slice(0, 8)} ردّ`, statement.status, 200);
      continue;
    }
    const jobs = statement.body?.data?.jobs ?? [];
    const mine = Array.isArray(jobs) ? jobs.filter((job) => job.orderId === order.id) : [];
    check(spec.title, `كشف حساب ${participant.id.slice(0, 8)} فيه الطلب`, mine.length, 1);
    if (mine.length === 1) {
      check(spec.title, `كشف حساب ${participant.id.slice(0, 8)} = حصته`,
        Number(mine[0].grossTechnicianEarningCents), Number(share?.share_cents));
      // «مستحقاتي» لازم تساوي أثر الطلب على المحفظة بالظبط (§90.1) — القائد الماسك كاش
      // بيطلع رقمه سالب، وده صح: عليه دَين للمنصة يتسوّى في الصرف الجاي.
      const expectedNet = Number(share?.share_cents) - (share?.is_leader ? cashHeld : 0);
      check(spec.title, `صافي مستحق ${participant.id.slice(0, 8)} = حركة محفظته`,
        Number(mine[0].netTechnicianDueCents), expectedNet);
    }
  }

  console.log(
    `   إجمالي ${egp(total)} | المنصة ${egp(platform)} | المنفّذين ${egp(sharesTotal)}` +
    `  →  ${shares.map((s) => `${s.technician_kind_snapshot}/${s.earning_role}${s.is_leader ? '(قائد)' : ''}=${egp(s.share_cents)}`).join(' + ')}`,
  );

  return order.id;
}

async function main() {
  const h = new LiveHarness('mpa');
  await h.connect();
  const orderIds = [];

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: PRICE_CENTS });
    await h.q(`UPDATE services SET commission_percentage = $2 WHERE id = $1`, [catalog.service.id, COMMISSION_PCT]);
    const customer = await h.makeCustomer('c');
    const admin = await h.makeAdmin();

    const techA = await h.makeTechnician('ta');
    const techB = await h.makeTechnician('tb');
    const asstA = await h.makeTechnician('aa');
    const asstB = await h.makeTechnician('ab');
    const asstC = await h.makeTechnician('ac');
    for (const assistant of [asstA, asstB, asstC]) {
      await h.q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [assistant.id]);
    }

    // لقطة «قبل» — الأساس اللي هنقيس عليه أثر الطلبات على اللوحة المالية.
    const beforeRes = await h.api(`/admin/analytics/money?from=${RANGE.from}&to=${RANGE.to}`, { token: admin.token });
    moneyBefore = beforeRes.status === 200 ? beforeRes.body?.data : null;

    const ctx = { catalog, customer, admin };
    const scenarios = [
      { title: 'أ — فني لوحده', label: 'A', leader: techA, members: [], expectedParticipants: 1 },
      { title: 'ب — فني قائد + مساعد', label: 'B', leader: techA,
        members: [{ tech: asstA, memberType: 'assistant' }], expectedParticipants: 2 },
      { title: 'ج — فني قائد + فني عضو + مساعد', label: 'C', leader: techA,
        members: [{ tech: techB, memberType: 'team_member' }, { tech: asstA, memberType: 'assistant' }],
        expectedParticipants: 3 },
      { title: 'د — مساعد لوحده (قائد)', label: 'D', leader: asstB, members: [], expectedParticipants: 1 },
      { title: 'هـ — مساعد قائد + مساعد عضو', label: 'E', leader: asstB,
        members: [{ tech: asstC, memberType: 'assistant' }], expectedParticipants: 2 },
    ];

    for (const spec of scenarios) {
      orderIds.push(await auditScenario(h, ctx, spec));
    }

    // ⑥ اللوحة المالية والتقارير — مجاميع كل الطلبات اللي اتعملت هنا لازم تطابق القاعدة.
    console.log('\n═══ اللوحة المالية والتقارير ═══');
    const settled = orderIds.filter(Boolean);
    const [dbTotals] = await h.q(
      `SELECT COALESCE(SUM(o.platform_commission_cents),0) AS platform,
              COALESCE((SELECT SUM(s.share_cents) FROM order_earning_shares s
                         WHERE s.order_id = ANY($1::uuid[]) AND s.deleted_at IS NULL
                           AND COALESCE(s.earning_role,'technician') <> 'assistant'),0) AS technician_earnings,
              COALESCE((SELECT SUM(s.share_cents) FROM order_earning_shares s
                         WHERE s.order_id = ANY($1::uuid[]) AND s.deleted_at IS NULL
                           AND s.earning_role = 'assistant'),0) AS assistant_earnings
         FROM orders o WHERE o.id = ANY($1::uuid[]) AND o.order_status = 'completed'`,
      [settled],
    );
    console.log(
      `   من القاعدة: المنصة ${egp(dbTotals.platform)} | فنيين ${egp(dbTotals.technician_earnings)}` +
      ` | مساعدين ${egp(dbTotals.assistant_earnings)}`,
    );

    const money = await h.api(`/admin/analytics/money?from=${RANGE.from}&to=${RANGE.to}`, { token: admin.token });
    check('اللوحة المالية', 'اللوحة المالية ردّت', money.status, 200);
    if (money.status === 200 && moneyBefore) {
      // **«أي تغيير بيتعكس في كل حتة»**: الفرق بين لقطة قبل وبعد لازم يساوي بالظبط اللي
      // الطلبات دي ضافته. المقارنة دي مش دائرية — اللوحة بتحسب بـSQL بتاعها، والمتوقع جاي
      // من صفوف التسوية نفسها.
      const line = (snapshot, key) =>
        Number((snapshot.lines ?? []).find((l) => l.key === key)?.amount_cents ?? 0);
      const after = money.body?.data ?? {};
      check('اللوحة المالية', 'فرق «إجمالي المبيعات» = مجموع الطلبات',
        line(after, 'gross_sales') - line(moneyBefore, 'gross_sales'), settled.length * PRICE_CENTS);
      check('اللوحة المالية', 'فرق «إيراد المنصة» = مجموع العمولة',
        line(after, 'platform_revenue') - line(moneyBefore, 'platform_revenue'), Number(dbTotals.platform));
      check('اللوحة المالية', 'فرق «أرباح الفنيين» = حصص دور الفني',
        Number(after.technician_earnings_cents ?? 0) - Number(moneyBefore.technician_earnings_cents ?? 0),
        Number(dbTotals.technician_earnings));
      check('اللوحة المالية', 'فرق «أرباح المساعدين» = حصص دور المساعد',
        Number(after.assistant_earnings_cents ?? 0) - Number(moneyBefore.assistant_earnings_cents ?? 0),
        Number(dbTotals.assistant_earnings));
      check('اللوحة المالية', 'مفيش طلب اتدفع مرتين', Number(after.double_payments_count ?? 0), 0);
      // **دلتا مش رقم مطلق، وده مقصود.** الرقم المطلق على قاعدة التطوير بيفضل موجب بسبب
      // تراكم بيانات اختبار: عشرات السبيكات بتمسح `wallet_transactions` بتاعتها في التنظيف
      // من غير ما ترجّع رصيد **محفظة المنصة المشتركة** (اللي مش بتتمسح أبدًا). النتيجة انحراف
      // تاريخي متقاس: الرصيد −1,490,054.06 ج.م مقابل مجموع حركات −639,192.00 ج.م.
      //
      // إن ده تنظيف اختبارات مش عطل إنتاج **اتقاس مباشرةً، مش افتُرض**: تسوية واحدة عبر الـAPI
      // حرّكت الرصيد +250.00 ومجموع الحركات +250.00 وصف واحد — متطابقين بالظبط. والتنظيف
      // (`clean-test-data.js` + حذف مستخدمي الهارنس) مالمسش أي رقم فيهم.
      //
      // فالفحص اللي له معنى إنتاجي هو: **مسارات الفلوس دي ما ضافتش ولا مخالفة جديدة**.
      check('اللوحة المالية', 'مسارات الفلوس دي ما ضافتش أي مخالفة تسوية جديدة',
        Number(after.unreconciled_count ?? 0) - Number(moneyBefore.unreconciled_count ?? 0), 0);
      if (Number(after.unreconciled_count ?? 0) > 0) {
        console.log(
          `   ℹ️  ${after.unreconciled_count} مخالفة تاريخية على القاعدة دي (انحراف محفظة المنصة من تنظيف السبيكات) —` +
          ' مش من مسارات التدقيق ده، شوف التعليق في السكربت.',
        );
      }
    }

    const recon = await h.api('/admin/analytics/money/reconciliation', { token: admin.token });
    check('اللوحة المالية', 'تقرير المطابقة ردّ', recon.status, 200);
    if (recon.status === 200) {
      const d = recon.body?.data ?? {};
      const wallet = d.wallet_integrity ?? d.wallet ?? {};
      // الرقم ده بيقيس محافظ رصيدها مش مطابق لمجموع حركاتها — أي واحدة معناها قرش ضايع فعلاً.
      const issues = Number(wallet.balance_issues ?? 0);
      check('اللوحة المالية', 'مفيش محفظة رصيدها مخالف لمجموع حركاتها', issues, 0,
        'balance_issues في /admin/analytics/money/reconciliation');
      const chain = Number(wallet.chain_issues ?? 0);
      check('اللوحة المالية', 'مفيش انقطاع في سلسلة حركات المحافظ', chain, 0, 'chain_issues');
    }

    // ⑦ **الفلوس الخارجة للمنفّذ (الصرف)** — آخر حلقة في المسار: من المحفظة لبره المنصة.
    //    بنستخدم مساعد أخد حصته تحويل مباشر (مش القائد اللي ماسك كاش ورصيده سالب).
    console.log('\n═══ الصرف (فلوس خارجة للمنفّذ) ═══');
    const payoutTech = asstA;
    const [walletBefore] = await h.q(
      `SELECT w.id, w.balance_cents, w.reserved_balance_cents
         FROM wallets w JOIN technician_profiles tp ON tp.user_id = w.owner_user_id
        WHERE tp.id = $1`,
      [payoutTech.id],
    );
    if (!walletBefore || Number(walletBefore.balance_cents) <= 0) {
      check('الصرف', 'المساعد عنده رصيد قابل للصرف', Number(walletBefore?.balance_cents ?? 0) > 0, true);
    } else {
      const payoutCents = Number(walletBefore.balance_cents);
      const requested = await h.api('/technician/payouts', {
        method: 'POST', token: payoutTech.token,
        body: { amount_cents: payoutCents, payout_method: 'instapay', destination_masked: '****1234' },
      });
      check('الصرف', 'طلب الصرف اتقبل', requested.status, 201,
        requested.status !== 201 ? JSON.stringify(requested.body?.error ?? requested.body).slice(0, 200) : undefined);

      if (requested.status === 201) {
        const payoutId = requested.body?.data?.id;
        // الحجز بيخصم من الرصيد المتاح ويحطه في reserved — الفلوس لسه جوّه المنصة بس مقفولة.
        const [afterReserve] = await h.q(
          `SELECT balance_cents, reserved_balance_cents FROM wallets WHERE id = $1`, [walletBefore.id]);
        check('الصرف', 'الحجز نقل المبلغ من المتاح للمحجوز',
          Number(afterReserve.balance_cents) + Number(afterReserve.reserved_balance_cents),
          Number(walletBefore.balance_cents) + Number(walletBefore.reserved_balance_cents));
        check('الصرف', 'المبلغ المحجوز = المطلوب صرفه',
          Number(afterReserve.reserved_balance_cents) - Number(walletBefore.reserved_balance_cents), payoutCents);

        const [payoutRow] = await h.q(`SELECT payout_status AS status, amount_cents FROM payouts WHERE id = $1`, [payoutId]);
        check('الصرف', 'قيمة الصرف المسجّلة = المطلوب', Number(payoutRow.amount_cents), payoutCents);

        if (payoutRow.status === 'requested' || payoutRow.status === 'under_review') {
          const approve = await h.api(`/admin/payouts/${payoutId}/approve`, {
            method: 'POST', token: admin.token,
            headers: { 'x-step-up-token': await h.stepUpToken(admin.userId) },
          });
          check('الصرف', 'الأدمن وافق على الصرف', approve.status, 201,
            approve.status !== 201 ? JSON.stringify(approve.body?.error ?? '').slice(0, 200) : undefined);
        }

        const [preComplete] = await h.q(
          `SELECT payout_status, net_amount_cents FROM payouts WHERE id = $1`, [payoutId]);
        if (VERBOSE) console.log('   حالة الصرف قبل التنفيذ:', preComplete, 'id:', payoutId);
        // الخصم من المحفظة بيتم بـ**الصافي** (بعد أي رسوم صرف) مش بالإجمالي — `finalizePayout`.
        const netCents = Number(preComplete.net_amount_cents);
        const complete = await h.api(`/admin/payouts/${payoutId}/complete`, {
          method: 'POST', token: admin.token,
          headers: { 'x-step-up-token': await h.stepUpToken(admin.userId) },
        });
        check('الصرف', 'الصرف اتنفّذ', complete.status, 201,
          complete.status !== 201 ? JSON.stringify(complete.body?.error ?? '').slice(0, 200) : undefined);

        if (complete.status === 201) {
          const [afterPayout] = await h.q(
            `SELECT balance_cents, reserved_balance_cents, total_withdrawn_cents FROM wallets WHERE id = $1`,
            [walletBefore.id]);
          check('الصرف', 'المحجوز اترجّع صفر بعد التنفيذ',
            Number(afterPayout.reserved_balance_cents) - Number(walletBefore.reserved_balance_cents), 0);
          check('الصرف', 'الرصيد نزل بقيمة الصرف الصافية',
            Number(walletBefore.balance_cents) - Number(afterPayout.balance_cents), netCents);
          check('الصرف', 'إجمالي المسحوب زاد بنفس القيمة',
            Number(afterPayout.total_withdrawn_cents), netCents);
          const [payoutTx] = await h.q(
            `SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0) AS net
               FROM wallet_transactions WHERE wallet_id = $1 AND reference_type = 'payout' AND reference_id = $2`,
            [walletBefore.id, payoutId]);
          check('الصرف', 'حركة المحفظة للصرف = −قيمة الصرف الصافية', Number(payoutTx.net), -netCents);
        }
      }
    }

    // ⑧ الفلوس الداخلة = الفلوس الخارجة: المدفوع من العميل = المنصة + المنفّذين، على كل الطلبات.
    const [flow] = await h.q(
      `SELECT COALESCE(SUM(p.amount_cents),0) AS paid_in
         FROM payments p
        WHERE p.order_id = ANY($1::uuid[]) AND p.payment_status = 'succeeded'`,
      [settled],
    );
    const [outRow] = await h.q(
      `SELECT COALESCE(SUM(o.platform_commission_cents),0)
              + COALESCE((SELECT SUM(s.share_cents) FROM order_earning_shares s
                           WHERE s.order_id = ANY($1::uuid[]) AND s.deleted_at IS NULL),0) AS paid_out
         FROM orders o WHERE o.id = ANY($1::uuid[]) AND o.order_status = 'completed'`,
      [settled],
    );
    check('الداخل مقابل الخارج', 'الفلوس الداخلة = العمولة + حصص المنفّذين',
      Number(flow.paid_in), Number(outRow.paid_out));
  } finally {
    for (const orderId of orderIds.filter(Boolean)) {
      try {
        execFileSync(process.execPath, [join(__dirname, 'clean-test-data.js'), '--order', orderId], { stdio: 'ignore' });
      } catch {
        console.warn(`⚠️  فشل تنظيف الطلب ${orderId}`);
      }
    }
    await h.cleanup();
    await h.close();
  }

  console.log(`\n═══ النتيجة ═══`);
  console.log(`${checks.filter((c) => c.ok).length}/${checks.length} فحص نضيف`);
  if (failures.length) {
    console.log(`\n🔴 ${failures.length} فحص وقع:`);
    for (const f of failures) {
      console.log(`   [${f.scenario}] ${f.name}: طلع ${f.actual}، المفروض ${f.expected}${f.note ? `\n      ${f.note}` : ''}`);
    }
    process.exit(1);
  }
  console.log('🟢 كل مسارات الفلوس متطابقة من مصدر واحد.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
