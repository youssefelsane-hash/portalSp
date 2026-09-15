#!/usr/bin/env node
/**
 * **تدقيق حي لاسترداد الطلب متعدد الدفعات** (بلاغ مالك 2026-09-13، docs/08 §147).
 *
 * البلاغ حرفيًا: الأدمن بيدوس «تأكيد الاسترجاع» على طلب حقيقي فيرجع له
 * «الطلب فيه أكثر من دفعة قابلة للاسترداد — ابعت payment_id لتحديد الدفعة المقصودة»،
 * **وفورم الاسترجاع نفسه مافيهوش أي مكان يختار منه الدفعة** — طريق مسدود.
 *
 * الشكل ده بقى هو الشكل الشائع بعد ADR-0091 (الدفع أونلاين في أي وقت): الطلب بيبقى فيه
 * دفعة أساسية + دفعة (أو أكتر) لكل زيادة شغل معتمدة، كل واحدة دفعة مستقلة بالكامل.
 *
 * التدقيق ده بيبني نفس الطلب بالظبط من الـAPI الحقيقي (InstaPay أساسية + زيادتين معتمدتين
 * مدفوعتين كل واحدة لوحدها) وبيعدّي عليه **نفس المسار اللي الواجهة بتمشي فيه**:
 *   ١. الاسترداد بلا تحديد دفعة → مرفوض برسالة مفهومة (ده السلوك الصح، مش بَقّة).
 *   ٢. الملخص المالي بيدي الأدمن كل اللي يحتاجه عشان **يختار**: كل دفعة، والمتبقي منها،
 *      وكل استرداد مربوط بدفعته (`refunds[].payment_id` — الحقل ده كان ناقص أصلاً).
 *   ٣. الاسترداد بدفعة محددة بيعدّي.
 *   ٤. **الأهم**: بعد أول استرداد الطلب بيبقى `partially_refunded`، ولازم باقي الدفعات
 *      تفضل قابلة للاسترداد (الواجهة كانت بتخفي الزرار عند الحالة دي وتقفل الباقي).
 *
 * التشغيل: `node scripts/multi-payment-refund-audit.js [--verbose]`
 * محتاج API شغّال. لو الـthrottle وقفه: THROTTLE_LIMIT=100000 npm run start:dev
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const h = new LiveHarness('mprf');
const VERBOSE = process.argv.includes('--verbose');
const failures = [];
let pass = 0;

const PRICE = 50_000; // ٥٠٠ ج.م.
const EXTRA_A = 20_000; // ٢٠٠ ج.م. — نفس أرقام طلب المالك
const EXTRA_B = 30_000; // ٣٠٠ ج.م.

const egp = (c) => `${(Number(c) / 100).toFixed(2)} ج.م`;

function assert(group, name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`[${group}] ${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function check(group, name, actual, expected) {
  assert(group, name, actual === expected, `طلع ${JSON.stringify(actual)} المفروض ${JSON.stringify(expected)}`);
}

/**
 * نسخة حرفية من منطق صفحة الأدمن (`refundablePaymentsOf`) — الغرض إن التدقيق يقيس اللي
 * الأدمن هيشوفه فعلاً في القايمة، مش اللي القاعدة فيها.
 */
function refundablePaymentsOf(summary) {
  const reserved = new Map();
  for (const refund of summary.refunds) {
    if (refund.refund_status !== 'completed' && refund.refund_status !== 'processing') continue;
    reserved.set(refund.payment_id, (reserved.get(refund.payment_id) ?? 0) + refund.amount_cents);
  }
  return summary.payments
    .filter((p) => p.payment_status === 'succeeded' || p.payment_status === 'partially_refunded')
    .map((payment) => {
      const refundedCents = reserved.get(payment.id) ?? 0;
      return { payment, refundedCents, remainingCents: payment.amount_cents - refundedCents };
    })
    .filter((row) => row.remainingCents > 0);
}

async function main() {
  await h.connect();
  if (!(await h.isApiUp())) {
    console.error('الـAPI مش شغّال — cd apps/api && THROTTLE_LIMIT=100000 npm run start:dev');
    process.exit(2);
  }

  let restoreSettings = [];
  let admin = null;
  try {
    const catalog = await h.seedCatalog({ priceCents: PRICE });
    const tech = await h.makeTechnician('t1');
    const customer = await h.makeCustomer('c1');
    admin = await h.makeAdmin();

    const stepUp = async () => ({ 'X-Step-Up-Token': await h.stepUpToken(admin.userId) });

    // بيانات حساب InstaPay لازم تكون مضبوطة وإلا المزوّد بيرجّع ٥٠٣. بترجع زي ما كانت في
    // النهاية — التدقيق مايسيبش أثر على إعدادات البيئة.
    restoreSettings = await h.q(
      `SELECT key, value FROM settings WHERE key IN ('payments.instapay.ipa_address','payments.instapay.recipient_name')`,
    );
    for (const [key, value] of [
      ['payments.instapay.ipa_address', 'osta-refund-audit@instapay'],
      ['payments.instapay.recipient_name', 'Osta Refund Audit'],
    ]) {
      const res = await h.api(`/admin/settings/${key}`, {
        method: 'PATCH', token: admin.token, headers: await stepUp(), body: { value },
      });
      if (res.status !== 200) throw new Error(`تعذّر ضبط ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    }

    // ═══ ١ — بناء طلب مركّب حقيقي: دفعة أساسية + زيادتين معتمدتين ═══
    console.log('\n═══ ١ — بناء طلب مركّب (أساسي + زيادتين) ═══');
    const [order] = await h.q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
          technician_id, order_status, booking_mode, duration_minutes,
          subtotal_cents, total_amount_cents, payment_method, payment_status, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','individual',60,$7,$7,'cash','unpaid',20) RETURNING id, order_number`,
      [
        `MPR-${Date.now().toString().slice(-8)}-1`, customer.profileId, catalog.service.id,
        customer.addressId, catalog.zone.id, tech.id, PRICE,
      ],
    );
    console.log(`   الطلب: ${order.order_number}`);

    /** بيدفع المبلغ المستحق دلوقتي بـInstaPay ويأكّده من الأدمن، وبيرجّع صف الدفعة. */
    async function payAndConfirmInstaPay(tag) {
      const payRes = await h.api(`/orders/${order.id}/pay-with-instapay`, {
        method: 'POST', token: customer.token, headers: { 'Idempotency-Key': `mprf-${tag}-${Date.now()}` },
      });
      if (payRes.status !== 201) throw new Error(`فتح التحويل (${tag}) فشل: ${payRes.status} ${JSON.stringify(payRes.body)}`);
      const [row] = await h.q(
        `SELECT id, amount_cents FROM payments WHERE order_id=$1 AND payment_status='pending' ORDER BY initiated_at DESC LIMIT 1`,
        [order.id],
      );
      const confirm = await h.api(`/admin/payments/${row.id}/confirm-instapay`, {
        method: 'POST', token: admin.token, headers: await stepUp(),
      });
      if (confirm.status !== 201) throw new Error(`تأكيد التحويل (${tag}) فشل: ${confirm.status} ${JSON.stringify(confirm.body)}`);
      return row;
    }

    const basePayment = await payAndConfirmInstaPay('base');
    console.log(`   الدفعة الأساسية: ${egp(basePayment.amount_cents)}`);

    /** زيادة شغل يقترحها الفني ويوافق عليها العميل، وبتتدفع لوحدها. */
    async function addApprovedExtra(name, amountCents, tag) {
      const propose = await h.api(`/technician/orders/${order.id}/quote-items`, {
        method: 'POST', token: tech.token,
        body: {
          items: [{
            item_type: 'spare_part', name_ar: name,
            description: 'بند تدقيق حي لمسار استرداد الطلب متعدد الدفعات',
            quantity: 1, unit_price_cents: amountCents,
          }],
        },
      });
      if (propose.status !== 201) throw new Error(`اقتراح الزيادة (${tag}) فشل: ${propose.status} ${JSON.stringify(propose.body)}`);
      const approve = await h.api(`/orders/${order.id}/quote-items/approve`, {
        method: 'POST', token: customer.token, body: { payment_choice: 'electronic' },
      });
      if (approve.status !== 201) throw new Error(`موافقة العميل (${tag}) فشلت: ${approve.status} ${JSON.stringify(approve.body)}`);
      return payAndConfirmInstaPay(tag);
    }

    const extraAPayment = await addApprovedExtra('قطعة غيار تدقيق أ', EXTRA_A, 'exa');
    const extraBPayment = await addApprovedExtra('قطعة غيار تدقيق ب', EXTRA_B, 'exb');
    console.log(`   دفعات الزيادة: ${egp(extraAPayment.amount_cents)} + ${egp(extraBPayment.amount_cents)}`);

    // صورة "بعد الشغل" شرط حقيقي لقفل الطلب (order-technician-ops.service.ts) — بتتزرع مباشرة
    // عشان التدقيق ده عن الاسترداد مش عن رفع الملفات.
    await h.q(
      `INSERT INTO order_media (order_id, uploaded_by_user_id, media_type, file_url)
       VALUES ($1,$2,'after_photo','https://example.invalid/audit-after.jpg')`,
      [order.id, tech.userId],
    );
    const completeRes = await h.api(`/technician/orders/${order.id}/complete`, { method: 'POST', token: tech.token });
    assert('١', 'الفني قفل الشغل', completeRes.status === 201,
      `HTTP ${completeRes.status} ${JSON.stringify(completeRes.body?.error?.message ?? completeRes.body?.message)}`);
    // تسوية الطلب المدفوع مقدّمًا بتحصل **بعد** رد الـendpoint (حدث/طابور)، فالقراءة الفورية
    // بتلاقيه لسه `work_completed`. الانتظار هنا على الحالة الفعلية مش على وقت ثابت.
    let afterComplete = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      [afterComplete] = await h.q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [order.id]);
      if (afterComplete.order_status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (VERBOSE) console.log('   ', JSON.stringify(afterComplete));
    check('١', 'الطلب بقى مكتمل بعد التسوية', afterComplete.order_status, 'completed');
    check('١', 'والطلب مدفوع بالكامل', afterComplete.payment_status, 'paid');

    // ═══ ٢ — الاسترداد بلا تحديد دفعة: مرفوض برسالة مفهومة ═══
    console.log('\n═══ ٢ — استرداد بلا تحديد دفعة (اللي المالك وقع فيه) ═══');
    const blind = await h.api(`/admin/orders/${order.id}/refund`, {
      method: 'POST', token: admin.token, headers: await stepUp(),
      body: { reason_notes: 'تدقيق: استرداد بلا تحديد دفعة' },
    });
    const blindMessage = String(blind.body?.error?.message ?? blind.body?.message ?? '');
    check('٢', 'مرفوض بـ409 (مش تخمين أي دفعة)', blind.status, 409);
    assert('٢', 'الرسالة بتوجّه لاختيار الدفعة مش لحقل API', blindMessage.includes('اختار الدفعة'), blindMessage);

    // ═══ ٣ — الملخص المالي فيه كل اللي الواجهة محتاجاه للاختيار ═══
    console.log('\n═══ ٣ — الملخص المالي: الأدمن يقدر يختار من غير ما يفتح القاعدة ═══');
    let summaryRes = await h.api(`/admin/orders/${order.id}/financial-summary`, { token: admin.token });
    check('٣', 'الملخص رجع ٢٠٠', summaryRes.status, 200);
    let summary = summaryRes.body.data ?? summaryRes.body;
    let options = refundablePaymentsOf(summary);
    check('٣', 'الواجهة هتعرض ٣ دفعات قابلة للاسترداد', options.length, 3);
    assert('٣', 'كل دفعة معروض معاها المتبقي منها',
      options.every((row) => row.remainingCents === row.payment.amount_cents),
      JSON.stringify(options.map((r) => [r.payment.amount_cents, r.remainingCents])));
    assert('٣', 'كل دفعة ليها رقم معروض يميّزها (التمييز الوحيد المضمون في القايمة)',
      options.every((row) => typeof row.payment.payment_number === 'string' && row.payment.payment_number.length > 0)
        && new Set(options.map((row) => row.payment.payment_number)).size === options.length,
      JSON.stringify(options.map((r) => r.payment.payment_number)));

    // ═══ ٤ — استرداد دفعة محددة ═══
    console.log('\n═══ ٤ — استرداد دفعة الزيادة الأولى بتحديدها ═══');
    const targeted = await h.api(`/admin/orders/${order.id}/refund`, {
      method: 'POST', token: admin.token, headers: await stepUp(),
      body: { reason_notes: 'تدقيق: استرداد دفعة الزيادة أ', payment_id: extraAPayment.id },
    });
    check('٤', 'الاسترداد اتقبل', targeted.status, 201);
    const [afterFirstRefund] = await h.q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [order.id]);
    check('٤', 'الطلب بقى مسترجَع جزئيًا', afterFirstRefund.payment_status, 'partially_refunded');
    check('٤', 'وحالة الطلب لسه مكتمل (مش REFUNDED)', afterFirstRefund.order_status, 'completed');

    summaryRes = await h.api(`/admin/orders/${order.id}/financial-summary`, { token: admin.token });
    summary = summaryRes.body.data ?? summaryRes.body;
    assert('٤', 'الاسترداد مربوط بدفعته في الملخص (payment_id)',
      summary.refunds.length === 1 && summary.refunds[0].payment_id === extraAPayment.id,
      JSON.stringify(summary.refunds));
    options = refundablePaymentsOf(summary);
    check('٤', 'الدفعة اللي اترّدت اختفت من قايمة الاختيار', options.length, 2);
    assert('٤', 'والباقي لسه معروض بالكامل',
      options.every((row) => row.payment.id !== extraAPayment.id && row.remainingCents === row.payment.amount_cents),
      JSON.stringify(options.map((r) => [r.payment.id, r.remainingCents])));

    // ═══ ٥ — الطلب الجزئي لسه قابل للاسترداد (الشرط اللي الواجهة كانت بتقفله) ═══
    console.log('\n═══ ٥ — باقي الدفعات بعد ما الطلب بقى partially_refunded ═══');
    const partialOnExtraB = await h.api(`/admin/orders/${order.id}/refund`, {
      method: 'POST', token: admin.token, headers: await stepUp(),
      body: { reason_notes: 'تدقيق: استرداد جزئي من الزيادة ب', amount_cents: 10_000, payment_id: extraBPayment.id },
    });
    check('٥', 'استرداد جزئي من دفعة تانية اتقبل', partialOnExtraB.status, 201);

    const overshoot = await h.api(`/admin/orders/${order.id}/refund`, {
      method: 'POST', token: admin.token, headers: await stepUp(),
      body: { reason_notes: 'تدقيق: تجاوز المتبقي', amount_cents: EXTRA_B, payment_id: extraBPayment.id },
    });
    assert('٥', 'ومحاولة تجاوز المتبقي في نفس الدفعة مرفوضة', overshoot.status === 400 || overshoot.status === 409,
      `HTTP ${overshoot.status} ${JSON.stringify(overshoot.body?.error?.message)}`);

    summaryRes = await h.api(`/admin/orders/${order.id}/financial-summary`, { token: admin.token });
    summary = summaryRes.body.data ?? summaryRes.body;
    options = refundablePaymentsOf(summary);
    const extraBOption = options.find((row) => row.payment.id === extraBPayment.id);
    assert('٥', 'المتبقي في الدفعة الجزئية بيتحسب صح في القايمة',
      !!extraBOption && extraBOption.remainingCents === EXTRA_B - 10_000,
      JSON.stringify(extraBOption ?? null));

    // ═══ ٦ — استرداد باقي المكوّنات بيقفل الطلب REFUNDED ═══
    console.log('\n═══ ٦ — إقفال كل المكوّنات ═══');
    for (const [label, paymentId] of [['باقي الزيادة ب', extraBPayment.id], ['الدفعة الأساسية', basePayment.id]]) {
      const res = await h.api(`/admin/orders/${order.id}/refund`, {
        method: 'POST', token: admin.token, headers: await stepUp(),
        body: { reason_notes: `تدقيق: استرداد ${label}`, payment_id: paymentId },
      });
      assert('٦', `استرداد ${label} عدّى`, res.status === 201,
        `HTTP ${res.status} ${JSON.stringify(res.body?.error?.message)}`);
    }
    const [finalRow] = await h.q(`SELECT order_status, payment_status FROM orders WHERE id=$1`, [order.id]);
    check('٦', 'الطلب بقى مسترجَع بالكامل', finalRow.payment_status, 'refunded');
    check('٦', 'وحالته REFUNDED', finalRow.order_status, 'refunded');

    summaryRes = await h.api(`/admin/orders/${order.id}/financial-summary`, { token: admin.token });
    summary = summaryRes.body.data ?? summaryRes.body;
    check('٦', 'مفيش أي دفعة فاضلة للاختيار', refundablePaymentsOf(summary).length, 0);
    const refundedTotal = summary.refunds
      .filter((r) => r.refund_status === 'completed')
      .reduce((sum, r) => sum + r.amount_cents, 0);
    const paidTotal = summary.payments
      .filter((p) => p.payment_status === 'refunded' || p.payment_status === 'partially_refunded' || p.payment_status === 'succeeded')
      .reduce((sum, p) => sum + p.amount_cents, 0);
    check('٦', 'إجمالي المسترد = إجمالي المدفوع', refundedTotal, paidTotal);

    // ═══ ثوابت عامة ═══
    console.log('\n═══ ٧ — ثوابت الدفتر ═══');
    const imbalance = await h.ledgerImbalance();
    assert('٧', 'الدفتر متوازن', imbalance.net === 0, `صافي ${imbalance.net} على ${imbalance.rows} حركة`);
    const errors = await h.serverErrorsSince();
    assert('٧', 'مفيش أي خطأ ٥xx في اللوج', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally {
    for (const row of restoreSettings ?? []) {
      if (!admin) break;
      await h.api(`/admin/settings/${row.key}`, {
        method: 'PATCH', token: admin.token,
        headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
        body: { value: row.value },
      });
    }
    await h.cleanup();
    await h.close();
  }

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`نجح: ${pass} — فشل: ${failures.length}`);
  if (failures.length) {
    console.log('\nالفشل:');
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log('كل بنود استرداد الطلب متعدد الدفعات عدّت ✅');
}

main().catch((err) => { console.error(err); process.exit(1); });
