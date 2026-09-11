#!/usr/bin/env node
/**
 * **تدقيق دورة الاسترداد كاملة** (طلب المالك 2026-09-11).
 *
 * > «شوف فلو الاسترداد… كل الحالات الممكنة، فيه حاجة مش منطقية؟ الدورة مقفولة؟ فيه فلوس
 * > بتضيع في النص أو بتتحسب غلط؟ ولما النظام يقبل الاسترداد تلقائيًا لازم يبان للأدمن.»
 *
 * بيمشي على كل حالة استرداد حقيقية عبر الـAPI وبيقيس الثابت الحاكم:
 *
 *   **اللي العميل دفعه − اللي رجعله = عمولة المنصة + صافي حصص المنفّذين**
 *
 * يعني مفيش قرش بيضيع ولا بيتخلق في أي نقطة من الدورة. وكمان بيتأكد إن الحالات النهائية
 * منطقية (الطلب والدفع بيوصلوا لحالة بتحكي القصة الصح)، وإن الدورة **مقفولة** (مفيش صف
 * عالق في PROCESSING بلا طريق يخرج بيه).
 *
 * التشغيل: `node scripts/refund-flow-audit.js [--verbose]`
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

function check(scenario, name, actual, expected, note) {
  const ok = actual === expected;
  checks.push({ scenario, name, ok });
  if (!ok) failures.push({ scenario, name, actual, expected, note });
  if (VERBOSE || !ok) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `  — طلع ${actual}، المفروض ${expected}${note ? ` (${note})` : ''}`}`);
  }
}

const sum = (rows, field) => rows.reduce((acc, row) => acc + Number(row[field] ?? 0), 0);

/** الثابت الحاكم للدورة كلها، بيتقاس من الدفاتر نفسها مش من معادلة موازية. */
async function assertMoneyCloses(h, scenario, orderId) {
  const [row] = await h.q(
    `SELECT total_amount_cents, platform_commission_cents, order_status, payment_status
       FROM orders WHERE id = $1`,
    [orderId],
  );
  const [paid] = await h.q(
    `SELECT COALESCE(SUM(amount_cents),0) AS c FROM payments
      WHERE order_id = $1 AND payment_status IN ('succeeded','partially_refunded','refunded')`,
    [orderId],
  );
  const [refunded] = await h.q(
    `SELECT COALESCE(SUM(amount_cents),0) AS c FROM refunds
      WHERE order_id = $1 AND refund_status = 'completed'`,
    [orderId],
  );
  const shares = await h.q(
    `SELECT technician_id, share_cents FROM order_earning_shares
      WHERE order_id = $1 AND deleted_at IS NULL`,
    [orderId],
  );
  const reversals = await h.q(
    `SELECT bucket_type, technician_id, reversal_cents FROM refund_settlement_reversals
      WHERE order_id = $1`,
    [orderId],
  );

  const paidIn = Number(paid.c);
  const refundedOut = Number(refunded.c);
  const grossShares = sum(shares, 'share_cents');
  const participantReversed = sum(reversals.filter((r) => r.bucket_type === 'participant'), 'reversal_cents');
  const platformReversed = sum(reversals.filter((r) => r.bucket_type === 'platform'), 'reversal_cents');
  const netShares = grossShares - participantReversed;
  const netPlatform = Number(row.platform_commission_cents) - platformReversed;

  check(scenario, 'الدورة مقفولة: المدفوع − المسترد = العمولة الصافية + الحصص الصافية',
    paidIn - refundedOut, netPlatform + netShares,
    `مدفوع ${egp(paidIn)} − مسترد ${egp(refundedOut)} ≠ منصة ${egp(netPlatform)} + منفّذين ${egp(netShares)}`);
  check(scenario, 'مجموع عكس التسوية = المبلغ المسترد', participantReversed + platformReversed, refundedOut);

  // مفيش صف استرداد عالق بلا طريق خروج — الدورة لازم توصل لحالة نهائية.
  const [stuck] = await h.q(
    `SELECT COUNT(*)::int AS n FROM refunds WHERE order_id = $1 AND refund_status IN ('pending','approved','processing')`,
    [orderId],
  );
  check(scenario, 'مفيش استرداد عالق في حالة وسيطة', stuck.n, 0,
    'صف processing من غير مراجعة يدوية معناه فلوس معلّقة');

  if (VERBOSE) {
    console.log(`   مدفوع ${egp(paidIn)} | مسترد ${egp(refundedOut)} | منصة ${egp(netPlatform)} | منفّذين ${egp(netShares)}` +
      ` | ${row.order_status}/${row.payment_status}`);
  }
  return { paidIn, refundedOut, netPlatform, netShares, row, shares, reversals };
}

async function makeSettledOrder(h, ctx, label, members = []) {
  const { catalog, customer, leader } = ctx;
  const [order] = await h.q(
    `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
       service_zone_id, technician_id, order_status, payment_status, total_amount_cents,
       commissionable_base_cents, technician_earning_cents, booking_mode, settlement_policy_version,
       payment_method)
     VALUES ($7,$1,$2,$3,$4,$5,$6,'work_completed','unpaid',$8,$8,0,'individual',2,'cash')
     RETURNING id`,
    [`RFA-${label}-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
     catalog.zone.id, leader.id, COMMISSION_PCT, PRICE_CENTS],
  );
  for (const member of members) {
    await h.q(
      `INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [order.id, member.tech.id, member.memberType === 'assistant' ? 'مساعد' : 'فني', member.memberType, leader.id],
    );
  }
  const settled = await h.api(`/technician/orders/${order.id}/collect-cash`, { method: 'POST', token: leader.token });
  if (settled.status !== 201) {
    throw new Error(`تسوية ${label} فشلت (${settled.status}): ${JSON.stringify(settled.body)}`);
  }
  return order.id;
}

async function refundAs(h, admin, orderId, amountCents, reason) {
  return h.api(`/admin/orders/${orderId}/refund`, {
    method: 'POST', token: admin.token,
    headers: { 'x-step-up-token': await h.stepUpToken(admin.userId) },
    body: { reason_notes: reason, ...(amountCents === undefined ? {} : { amount_cents: amountCents }) },
  });
}

async function main() {
  const h = new LiveHarness('rfa');
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
    const leader = await h.makeTechnician('t');
    const helper = await h.makeTechnician('a');
    await h.q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [helper.id]);
    const ctx = { catalog, customer, leader };

    // ① استرداد كامل بعد التسوية
    console.log('\n═══ ١ — استرداد كامل بعد ما الطلب اتقفل واتسوّى ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'F');
      orderIds.push(orderId);
      const res = await refundAs(h, admin, orderId, undefined, 'تدقيق: استرداد كامل');
      check('١ كامل', 'الاسترداد عدّى', res.status, 201,
        res.status !== 201 ? JSON.stringify(res.body?.error ?? res.body).slice(0, 200) : undefined);
      const st = await assertMoneyCloses(h, '١ كامل', orderId);
      check('١ كامل', 'المسترد = كل اللي العميل دفعه', st.refundedOut, st.paidIn);
      check('١ كامل', 'المنصة ما بقالهاش عمولة', st.netPlatform, 0);
      check('١ كامل', 'المنفّذين ما بقالهمش حصص', st.netShares, 0);
      check('١ كامل', 'حالة الطلب بقت refunded', st.row.order_status, 'refunded');
      check('١ كامل', 'حالة الدفع بقت refunded', st.row.payment_status, 'refunded');
    }

    // ② استرداد جزئي — النسبة لازم تتوزّع على المنصة والمنفّذ بنفس نسبة الطلب
    console.log('\n═══ ٢ — استرداد جزئي (٤٠٪) ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'P');
      orderIds.push(orderId);
      const partial = Math.round(PRICE_CENTS * 0.4);
      const res = await refundAs(h, admin, orderId, partial, 'تدقيق: استرداد جزئي');
      check('٢ جزئي', 'الاسترداد عدّى', res.status, 201,
        res.status !== 201 ? JSON.stringify(res.body?.error ?? res.body).slice(0, 200) : undefined);
      const st = await assertMoneyCloses(h, '٢ جزئي', orderId);
      check('٢ جزئي', 'المسترد = المطلوب بالظبط', st.refundedOut, partial);
      // ٤٠٪ من كل وعاء — نفس نسبة الطلب، مش كلها من جيب طرف واحد.
      check('٢ جزئي', 'المنصة اتخصم منها ٤٠٪ من عمولتها',
        Number(st.row.platform_commission_cents) - st.netPlatform,
        Math.round(Number(st.row.platform_commission_cents) * 0.4));
      check('٢ جزئي', 'الطلب ما بقاش refunded (لسه جزئي)', st.row.order_status === 'refunded', false);
    }

    // ③ استردادين جزئيين متتابعين لازم يوصلوا للكامل بالظبط بلا انحراف تقريب
    console.log('\n═══ ٣ — استردادين جزئيين بيكملوا الطلب ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'T');
      orderIds.push(orderId);
      const first = 33_333;
      const r1 = await refundAs(h, admin, orderId, first, 'تدقيق: جزئي ١');
      check('٣ متتابع', 'الاسترداد الأول عدّى', r1.status, 201,
        r1.status !== 201 ? JSON.stringify(r1.body?.error ?? r1.body).slice(0, 200) : undefined);
      const r2 = await refundAs(h, admin, orderId, PRICE_CENTS - first, 'تدقيق: جزئي ٢');
      check('٣ متتابع', 'الاسترداد التاني عدّى', r2.status, 201,
        r2.status !== 201 ? JSON.stringify(r2.body?.error ?? r2.body).slice(0, 200) : undefined);
      const st = await assertMoneyCloses(h, '٣ متتابع', orderId);
      check('٣ متتابع', 'المجموع = الطلب كامل بلا قرش زيادة أو نقصان', st.refundedOut, PRICE_CENTS);
      check('٣ متتابع', 'المنصة صفر بعد الاكتمال', st.netPlatform, 0);
      check('٣ متتابع', 'المنفّذين صفر بعد الاكتمال', st.netShares, 0);
    }

    // ④ استرداد فوق المدفوع لازم يترفض — مش ينجح وياخد فلوس من العدم
    console.log('\n═══ ٤ — استرداد فوق المدفوع ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'O');
      orderIds.push(orderId);
      const res = await refundAs(h, admin, orderId, PRICE_CENTS + 1, 'تدقيق: فوق المدفوع');
      check('٤ فوق المدفوع', 'اترفض', res.status >= 400 && res.status < 500, true,
        `رد بـ${res.status}`);
      const st = await assertMoneyCloses(h, '٤ فوق المدفوع', orderId);
      check('٤ فوق المدفوع', 'مفيش أي مبلغ اترد', st.refundedOut, 0);
    }

    // ⑤ استرداد كامل مرتين — التاني لازم يترفض بدل ما يرد الفلوس مرتين
    console.log('\n═══ ٥ — استرداد كامل مرتين ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'D');
      orderIds.push(orderId);
      const r1 = await refundAs(h, admin, orderId, undefined, 'تدقيق: كامل ١');
      check('٥ مزدوج', 'الأول عدّى', r1.status, 201);
      const r2 = await refundAs(h, admin, orderId, undefined, 'تدقيق: كامل ٢');
      check('٥ مزدوج', 'التاني اترفض', r2.status >= 400 && r2.status < 500, true, `رد بـ${r2.status}`);
      const st = await assertMoneyCloses(h, '٥ مزدوج', orderId);
      check('٥ مزدوج', 'المسترد مرة واحدة بس', st.refundedOut, PRICE_CENTS);
    }

    // ⑥-ب تلميح الفني **جوّه** الطلب — طلب مالك: يشوفه لما يفتح الطلب، مش إشعار بره،
    //     وبلا أي رقم (docs/08 §60.2 بيمنع أرقام فلوس العميل عن الفني).
    console.log('\n═══ ٦-ب — تلميح الاسترداد جوّه طلب الفني ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'H');
      orderIds.push(orderId);

      const before = await h.api(`/technician/orders/${orderId}`, { token: ctx.leader.token });
      check('٦-ب تلميح الفني', 'الطلب بيرجع للفني', before.status, 200);
      if (before.status === 200) {
        check('٦-ب تلميح الفني', 'قبل أي استرداد التلميح مطفي', before.body?.data?.has_customer_refund, false);
      }

      const res = await refundAs(h, admin, orderId, PRICE_CENTS / 2, 'تدقيق: تلميح الفني');
      check('٦-ب تلميح الفني', 'الاسترداد عدّى', res.status, 201,
        res.status !== 201 ? JSON.stringify(res.body?.error ?? res.body).slice(0, 200) : undefined);

      const after = await h.api(`/technician/orders/${orderId}`, { token: ctx.leader.token });
      check('٦-ب تلميح الفني', 'الطلب لسه بيرجع للفني بعد الاسترداد', after.status, 200);
      if (after.status === 200) {
        const dto = after.body?.data ?? {};
        check('٦-ب تلميح الفني', 'التلميح اتفعّل جوّه الطلب', dto.has_customer_refund, true);
        // القاعدة اللي مايصحش تتكسر عشان التلميح: صفر أرقام فلوس عميل في عقد الفني.
        check('٦-ب تلميح الفني', 'مفيش رقم مبلغ مسترد في عقد الفني',
          dto.refunded_amount_cents === undefined, true, 'docs/08 §60.2');
        check('٦-ب تلميح الفني', 'مفيش إجمالي الطلب في عقد الفني',
          dto.total_amount_cents === undefined, true, 'docs/08 §60.2');
      }
    }

    // ⑥ استرداد على طلب طاقم — كل مشارك بيتعكس بنسبة حصته، مش القائد لوحده
    console.log('\n═══ ٦ — استرداد على طلب طاقم (قائد + مساعد) ═══');
    {
      const orderId = await makeSettledOrder(h, ctx, 'C', [{ tech: helper, memberType: 'assistant' }]);
      orderIds.push(orderId);
      const partial = PRICE_CENTS / 2;
      const res = await refundAs(h, admin, orderId, partial, 'تدقيق: طاقم');
      check('٦ طاقم', 'الاسترداد عدّى', res.status, 201,
        res.status !== 201 ? JSON.stringify(res.body?.error ?? res.body).slice(0, 200) : undefined);
      const st = await assertMoneyCloses(h, '٦ طاقم', orderId);
      const reversedByTech = st.reversals.filter((r) => r.bucket_type === 'participant');
      check('٦ طاقم', 'كل مشارك اتعكس عليه صف', reversedByTech.length, st.shares.length);
      for (const share of st.shares) {
        const reversed = Number(reversedByTech.find((r) => r.technician_id === share.technician_id)?.reversal_cents ?? -1);
        check('٦ طاقم', `عكس حصة ${String(share.technician_id).slice(0, 8)} = نص حصته`,
          reversed, Math.round(Number(share.share_cents) / 2));
      }
    }

    // ⑦ **الاسترداد التلقائي** — طلب مدفوع مقدّمًا اتلغى قبل أي شغل. ده المسار اللي المالك
    //    بيقول إنه صح، وبيسأل: بيبان للأدمن ولا لأ؟
    console.log('\n═══ ٧ — الاسترداد التلقائي (إلغاء طلب مدفوع مقدّمًا) ═══');
    {
      const [order] = await h.q(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
           service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
           technician_earning_cents, booking_mode, settlement_policy_version, payment_method)
         VALUES ($6,$1,$2,$3,$4,$5,'searching_technician','paid',$7,$7,0,'individual',2,'card')
         RETURNING id`,
        [`RFA-A-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
         catalog.zone.id, COMMISSION_PCT, PRICE_CENTS],
      );
      orderIds.push(order.id);
      await h.q(
        `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method,
           payment_status, completed_at, gateway_transaction_id
           , idempotency_key)
         VALUES (next_human_readable_number('PAY'),$1,$2,$3,'card','succeeded',now(),$4,$5)`,
        [order.id, customer.profileId, PRICE_CENTS, `AUDIT-${h.runId}`, `idem-${h.runId}`],
      );

      // سبب من القايمة إجباري، وبنختار واحد **بلا رسوم** عشان الاسترداد يطلع كامل وواضح.
      const [reason] = await h.q(
        `SELECT id FROM cancellation_reasons
          WHERE is_active = true AND charges_fee = false AND applies_to = 'customer'
          ORDER BY display_order LIMIT 1`,
      );
      const cancelled = await h.api(`/orders/${order.id}/cancel`, {
        method: 'POST', token: customer.token,
        body: { reason: 'تدقيق: إلغاء العميل', cancellation_reason_id: reason?.id },
      });
      check('٧ تلقائي', 'الإلغاء عدّى', cancelled.status === 200 || cancelled.status === 201, true,
        `رد بـ${cancelled.status}: ${JSON.stringify(cancelled.body?.error ?? '').slice(0, 160)}`);

      const autoRefunds = await h.q(
        `SELECT refund_status, requested_by_user_id, approved_by_user_id, amount_cents
           FROM refunds WHERE order_id = $1`, [order.id]);
      check('٧ تلقائي', 'النظام عمل صف استرداد لوحده', autoRefunds.length >= 1, true);
      if (autoRefunds.length) {
        // **`processing` هنا مش عطل**: الدفع كارت بمرجع بوابة، والبوابة الوهمية في بيئة
        // التدقيق مابتأكدش النتيجة — والنظام **عمدًا** مابيخمّنش (AUD-012). الحالتين
        // المشروعتين بس هما دول، وأي حالة تانية معناها فلوس في مكان مالهاش فيه.
        check('٧ تلقائي', 'الاسترداد التلقائي في حالة مشروعة',
          ['completed', 'processing'].includes(autoRefunds[0].refund_status), true,
          `طلع ${autoRefunds[0].refund_status}`);
        check('٧ تلقائي', 'مسجّل إن النظام هو اللي طلبه ووافق عليه',
          autoRefunds[0].requested_by_user_id === autoRefunds[0].approved_by_user_id, true);
      }

      // **السؤال اللي المالك سأله بالحرف**: «لازم يبان للأدمن عشان يتابع».
      const adminList = await h.api('/admin/refunds', { token: admin.token });
      check('٧ تلقائي', 'قايمة استردادات الأدمن ردّت', adminList.status, 200);
      let mine = [];
      if (adminList.status === 200) {
        const rows = adminList.body?.data ?? [];
        mine = Array.isArray(rows) ? rows.filter((r) => r.order_id === order.id) : [];
        check('٧ تلقائي', 'الاسترداد التلقائي ظاهر في قايمة الأدمن', mine.length, 1);
        if (mine.length === 1) {
          check('٧ تلقائي', 'الأدمن يقدر يفرّق إنه تلقائي', mine[0].is_automatic, true,
            'من غير العلم ده صف النظام وصف الأدمن بيبانوا نفس الحاجة');
          check('٧ تلقائي', 'الصف بيحمل رقم الطلب عشان الأدمن يتصرّف',
            mine[0].order_number !== null && mine[0].order_number !== undefined, true);
        }
      }

      // فلتر «التلقائي» — الأدمن يقدر يوصل لكل اللي النظام عمله من غير ما ينقّب في ٢٠٠ صف.
      const autoOnly = await h.api('/admin/refunds?automatic=true', { token: admin.token });
      check('٧ تلقائي', 'فلتر التلقائي ردّ', autoOnly.status, 200);
      if (autoOnly.status === 200) {
        const rows = autoOnly.body?.data ?? [];
        check('٧ تلقائي', 'الفلتر بيرجّع الاسترداد التلقائي بتاعنا',
          rows.some((r) => r.order_id === order.id), true);
        check('٧ تلقائي', 'الفلتر مابيرجّعش أي استرداد يدوي',
          rows.every((r) => r.is_automatic === true), true);
      }

      // فلتر «محتاج مراجعة» — الفلوس المعلّقة، وهي أخطر حالة في الدورة كلها.
      const pendingWork = await h.api('/admin/refunds?needs_reconciliation=true', { token: admin.token });
      check('٧ تلقائي', 'فلتر الفلوس المعلّقة ردّ', pendingWork.status, 200);
      if (pendingWork.status === 200) {
        const rows = pendingWork.body?.data ?? [];
        check('٧ تلقائي', 'كل صف فيه محتاج مراجعة فعلاً',
          rows.every((r) => r.needs_reconciliation === true && r.refund_status === 'processing'), true);
        if (mine.length === 1 && mine[0].refund_status === 'processing') {
          check('٧ تلقائي', 'الاسترداد المعلّق بتاعنا ظاهر في فلتر المتابعة',
            rows.some((r) => r.order_id === order.id), true);
        }
      }
    }
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
  console.log('🟢 دورة الاسترداد مقفولة ومتّسقة في كل الحالات.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
