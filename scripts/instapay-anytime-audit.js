#!/usr/bin/env node
/**
 * تدقيق حي للدفع أونلاين في أي وقت + حافز InstaPay (ADR-0091، docs/08 §143).
 *
 * الأسئلة اللي بيجاوبها، وكلها بلاغات مالك حرفية:
 *   ١. «مش شايف خصم» — الحافز بيبان بالرقم في معاينة الطلب؟
 *   ٢. «مش عايز أستنى لحد ما الفني يخلّص» — الطلب الشغّال قابل للدفع فعلاً؟
 *   ٣. **الأخطر**: الدفع المبكر **مايقفلش** الطلب ومايوزّعش أرباح والفني لسه شغّال.
 *   ٤. «يـreflect على طول عند الصنايعي» — الفني بيشوف مدفوع أونلاين ومفيش كاش؟
 *   ٥. الزيادة بعد الموافقة بتتدفع لوحدها **وبلا حافز** (الخصم مرة واحدة لكل طلب).
 *
 * محتاج API شغّال. لو الـthrottle وقفه: THROTTLE_LIMIT=100000 npm run start:dev
 */
const { LiveHarness } = require('./lib/live-harness');

const h = new LiveHarness('ipany');
let pass = 0;
const failures = [];
const verbose = process.argv.includes('--verbose');

function assert(group, name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`[${group}] ${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}
function check(group, name, actual, expected) {
  assert(group, name, actual === expected, `طلع ${JSON.stringify(actual)} المفروض ${JSON.stringify(expected)}`);
}

const PRICE = 40_000; // ٤٠٠ ج.م.
const DISCOUNT = 3_000; // ٣٠ ج.م. — قيمة الإعداد بعد migration 0325

async function seedOrder(customer, tech, catalog, { status, totalCents = PRICE, suffix }) {
  const [order] = await h.q(
    `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
        technician_id, order_status, booking_mode, duration_minutes,
        subtotal_cents, total_amount_cents, payment_method, payment_status, commission_rate_applied)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'individual',60,$8,$8,'cash','unpaid',20) RETURNING id, order_number`,
    [
      `IPA-${Date.now().toString().slice(-8)}-${suffix}`,
      customer.profileId, catalog.service.id, customer.addressId, catalog.zone.id, tech.id, status, totalCents,
    ],
  );
  return order;
}

async function main() {
  await h.connect();
  if (!(await h.isApiUp())) {
    console.error('الـAPI مش شغّال — شغّله الأول: cd apps/api && THROTTLE_LIMIT=100000 npm run start:dev');
    process.exit(2);
  }

  let restoreSettings = [];
  let adminStepUpToken = null;
  let adminUserId = null;
  try {
    const catalog = await h.seedCatalog({ priceCents: PRICE });
    const tech = await h.makeTechnician('t1');
    const customer = await h.makeCustomer('c1');
    const admin = await h.makeAdmin();
    adminUserId = admin.userId;
    adminStepUpToken = admin.token;

    // بيانات حساب InstaPay لازم تكون مضبوطة وإلا المزوّد بيرجّع ٥٠٣ ومفيش مسار دفع يتدقّق
    // أصلاً. بنرجّعها زي ما كانت في النهاية — التدقيق مايسيبش أثر على إعدادات البيئة.
    restoreSettings = await h.q(
      `SELECT key, value FROM settings WHERE key IN ('payments.instapay.ipa_address','payments.instapay.recipient_name')`,
    );
    // **عبر مسار الأدمن الحقيقي عمدًا** مش كتابة مباشرة في القاعدة: المزوّد بيعيد تحميل
    // إعداداته من `SETTING_UPDATED_EVENT`، فالكتابة المباشرة كانت هتسيبه شغّال بقيمة قديمة
    // ويرجّع ٥٠٣ (وده اللي حصل فعلاً في أول تشغيلة للتدقيق ده).
    for (const [key, value] of [
      ['payments.instapay.ipa_address', 'osta-audit@instapay'],
      ['payments.instapay.recipient_name', 'Osta Audit'],
    ]) {
      const res = await h.api(`/admin/settings/${key}`, {
        method: 'PATCH',
        token: admin.token,
        headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
        body: { value },
      });
      if (res.status !== 200) throw new Error(`تعذّر ضبط ${key}: ${res.status} ${JSON.stringify(res.body)}`);
    }

    const [{ value: configured }] = await h.q(
      `SELECT value FROM settings WHERE key = 'payments.instapay_discount_egp'`,
    );
    console.log(`\nقيمة الحافز المضبوطة: ${JSON.stringify(configured)} ج.م.`);
    check('٠', 'الحافز مفعّل بقيمة ٣٠ ج.م.', Number(configured), 30);

    // ═══ ١ — طلب شغّال: الخصم ظاهر والدفع متاح ═══
    console.log('\n═══ ١ — طلب لسه بيتنفّذ: الخصم ظاهر والدفع متاح ═══');
    const live = await seedOrder(customer, tech, catalog, { status: 'in_progress', suffix: 'live' });
    const preview = await h.api(`/orders/${live.id}/instapay-preview`, { token: customer.token });
    check('١', 'المعاينة رجعت ٢٠٠', preview.status, 200);
    const p = preview.body.data ?? preview.body;
    if (verbose) console.log('   ', JSON.stringify(p));
    check('١', 'الطلب قابل للدفع وهو شغّال', p.is_payable, true);
    check('١', 'متعلّم إنه دفع مسبق', p.is_prepayment, true);
    check('١', 'مش زيادة على طلب مدفوع', p.is_additional_charge, false);
    check('١', 'الخصم بيبان بالرقم', p.instapay_discount_cents, DISCOUNT);
    check('١', 'السعر بعد الخصم', p.amount_cents, PRICE - DISCOUNT);
    check('١', 'سعر الكاش من غير خصم', p.cash_amount_cents, PRICE);

    // المعاينة قراءة بحتة — ماتفتحش أي دفعة (ADR-0089).
    const afterPreview = await h.q(`SELECT count(*)::int AS n FROM payments WHERE order_id = $1`, [live.id]);
    check('١', 'المعاينة مافتحتش أي دفعة', afterPreview[0].n, 0);

    // ═══ ٢ — التحويل بيتفتح فعلاً بالمبلغ المخصوم ═══
    console.log('\n═══ ٢ — بدء التحويل على طلب شغّال ═══');
    const payRes = await h.api(`/orders/${live.id}/pay-with-instapay`, {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `ipany-live-${Date.now()}` },
    });
    check('٢', 'الدفع اتقبل وهو in_progress', payRes.status, 201);
    const [paymentRow] = await h.q(
      `SELECT id, amount_cents, payment_status FROM payments WHERE order_id = $1`, [live.id],
    );
    check('٢', 'صف الدفعة بالمبلغ بعد الخصم', paymentRow.amount_cents, PRICE - DISCOUNT);
    const [afterDiscount] = await h.q(
      `SELECT total_amount_cents, discount_amount_cents, instapay_discount_cents, order_status
         FROM orders WHERE id = $1`, [live.id],
    );
    check('٢', 'إجمالي الطلب اتخصم منه الحافز', afterDiscount.total_amount_cents, PRICE - DISCOUNT);
    check('٢', 'الحافز اتسجّل في عموده المستقل', afterDiscount.instapay_discount_cents, DISCOUNT);
    check('٢', 'والحافز داخل خصم الطلب الكلي', afterDiscount.discount_amount_cents, DISCOUNT);
    check('٢', 'حالة الطلب ما اتغيّرتش بمجرد فتح التحويل', afterDiscount.order_status, 'in_progress');

    // ═══ ٣ — تأكيد التحويل: فلوس اتسجّلت، الطلب **ما اتقفلش** ═══
    console.log('\n═══ ٣ — تأكيد التحويل والطلب لسه شغّال (أخطر بند) ═══');
    const confirmRes = await h.api(`/admin/payments/${paymentRow.id}/confirm-instapay`, {
      method: 'POST',
      token: admin.token,
      headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
    });
    check('٣', 'الأدمن أكّد التحويل', confirmRes.status, 201);
    const [settled] = await h.q(
      `SELECT order_status, payment_status, payment_method FROM orders WHERE id = $1`, [live.id],
    );
    check('٣', 'الطلب اتسجّل مدفوع', settled.payment_status, 'paid');
    check('٣', 'وسيلة الدفع بقت instapay', settled.payment_method, 'instapay');
    check('٣', '⚠️ الطلب **لسه شغّال** ما اتقفلش', settled.order_status, 'in_progress');
    const earnings = await h.q(
      `SELECT count(*)::int AS n FROM wallet_transactions
        WHERE reference_type = 'order' AND reference_id = $1`, [live.id],
    );
    check('٣', '⚠️ مفيش أي أرباح اتوزّعت للفني', earnings[0].n, 0);
    const history = await h.q(
      `SELECT previous_status, new_status FROM order_status_history
        WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [live.id],
    );
    assert('٣', 'الواقعة المالية اتسجّلت في السجل بلا انتقال حالة',
      history.length === 1 && history[0].previous_status === history[0].new_status,
      JSON.stringify(history[0] ?? null));

    // ═══ ٤ — الفني بيشوف "مدفوع أونلاين ومفيش كاش" ═══
    console.log('\n═══ ٤ — انعكاس الدفع عند الفني ═══');
    const techView = await h.api(`/technician/orders/${live.id}`, { token: tech.token });
    check('٤', 'الفني بيشوف الطلب', techView.status, 200);
    const t = techView.body.data ?? techView.body;
    check('٤', 'متعلّم مدفوع أونلاين بالكامل', t.fully_paid_online, true);
    check('٤', 'مفيش كاش مطلوب تحصيله', t.cash_to_collect_cents, 0);
    assert('٤', 'أرقام فلوس العميل مخفية عن الفني (docs/08 §60.2)',
      t.instapay_discount_cents === undefined && t.discount_amount_cents === undefined,
      JSON.stringify({ d: t.discount_amount_cents, i: t.instapay_discount_cents }));

    // ═══ ٥ — الزيادة: بتتدفع لوحدها وبلا حافز ═══
    console.log('\n═══ ٥ — زيادة بعد الدفع: الخصم مرة واحدة لكل طلب ═══');
    const EXTRA = 8_000; // ٨٠ ج.م. قطعة غيار
    const proposeRes = await h.api(`/technician/orders/${live.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: {
        items: [{
          item_type: 'spare_part',
          name_ar: 'قطعة غيار تدقيق',
          description: 'قطعة لازمة لإكمال الشغل — تدقيق حي لمسار الزيادة',
          quantity: 1,
          unit_price_cents: EXTRA,
        }],
      },
    });
    check('٥', 'الفني اقترح الزيادة', proposeRes.status, 201);
    const approveRes = await h.api(`/orders/${live.id}/quote-items/approve`, {
      method: 'POST',
      token: customer.token,
      body: { payment_choice: 'electronic' },
    });
    check('٥', 'العميل وافق على الزيادة', approveRes.status, 201);

    const deltaPreview = await h.api(`/orders/${live.id}/instapay-preview`, { token: customer.token });
    const d = deltaPreview.body.data ?? deltaPreview.body;
    if (verbose) console.log('   ', JSON.stringify(d));
    check('٥', 'الزيادة قابلة للدفع فورًا', d.is_payable, true);
    check('٥', 'متعلّمة كزيادة على طلب مدفوع', d.is_additional_charge, true);
    check('٥', '⚠️ مفيش حافز على الزيادة', d.instapay_discount_cents, 0);
    check('٥', 'المبلغ = الزيادة بس مش الإجمالي', d.amount_cents, EXTRA);

    // ═══ ٦ — طلب لسه مالوش سعر: مرفوض برسالة صحيحة ═══
    console.log('\n═══ ٦ — طلب لسه مالوش سعر ═══');
    const priceless = await seedOrder(customer, tech, catalog, {
      status: 'in_progress', totalCents: 0, suffix: 'nprc',
    });
    const pricelessPreview = await h.api(`/orders/${priceless.id}/instapay-preview`, { token: customer.token });
    check('٦', 'المعاينة بترد بهدوء مش بخطأ', pricelessPreview.status, 200);
    check('٦', 'مش قابل للدفع', (pricelessPreview.body.data ?? pricelessPreview.body).is_payable, false);
    const pricelessPay = await h.api(`/orders/${priceless.id}/pay-with-instapay`, {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `ipany-nprc-${Date.now()}` },
    });
    check('٦', 'محاولة الدفع اترفضت', pricelessPay.status, 409);
    assert('٦', 'الرسالة بتقول السبب الحقيقي (السعر) مش «مدفوع بالفعل»',
      String(pricelessPay.body?.error?.message ?? pricelessPay.body?.message ?? '').includes('سعر'),
      JSON.stringify(pricelessPay.body?.error?.message ?? pricelessPay.body?.message));

    // ═══ ٧ — الكاش والمحفظة فضلوا على البوابة القديمة ═══
    console.log('\n═══ ٧ — الكاش والمحفظة ما اتفتحوش للدفع المبكر (حد ADR-0091 §1) ═══');
    const walletOrder = await seedOrder(customer, tech, catalog, { status: 'in_progress', suffix: 'wlt' });
    const walletPay = await h.api(`/orders/${walletOrder.id}/pay-with-wallet`, {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `ipany-wlt-${Date.now()}` },
    });
    check('٧', 'المحفظة لسه بترفض الطلب الشغّال', walletPay.status, 409);
    const cashCollect = await h.api(`/technician/orders/${walletOrder.id}/collect-cash`, {
      method: 'POST',
      token: tech.token,
    });
    assert('٧', 'تحصيل الكاش لسه مرفوض قبل ما الشغل يخلص',
      cashCollect.status === 409 || cashCollect.status === 404,
      `status ${cashCollect.status}`);

    const errors = await h.serverErrorsSince();
    assert('*', 'مفيش أي خطأ ٥xx في اللوج خلال التدقيق', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally {
    for (const row of restoreSettings ?? []) {
      await h.api(`/admin/settings/${row.key}`, {
        method: 'PATCH',
        token: adminStepUpToken,
        headers: { 'X-Step-Up-Token': await h.stepUpToken(adminUserId) },
        body: { value: row.value },
      });
    }
    await h.cleanup();
    await h.close();
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`نجح: ${pass} — فشل: ${failures.length}`);
  if (failures.length) {
    console.log('\nالفشل:');
    for (const f of failures) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log('كل البنود عدّت ✅');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
