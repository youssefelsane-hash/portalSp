'use strict';
/**
 * **بلاغ المالك ٦ (§141)**: «شاشة InstaPay بتاعت التحويل اللي جوّه الطلب — حتى لو الطلب اتقفل،
 * بتفضل ظاهرة ببيانات التحويل بكل حاجة. ده مش منطقي.»
 *
 * الضرر مش تجميلي: العميل بيبص على شاشة فيها رقم حساب ومبلغ، ويحوّل **فلوس حقيقية** لطلب خلص.
 *
 * السبب: `getInstaPayTransfer()` كانت بتفحص الملكية بس ومابتفحصش إن الطلب لسه قابل للدفع —
 * عكس `payWithInstaPay()` اللي بيفحص. الزرار اللي بيوصّل للشاشة متقفل صح في الويب والتطبيق،
 * فالقراءة كانت آخر باب مفتوح.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('instagate');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');

    const [order] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at, payment_method)
       VALUES (20,$1,$2,$3,$4,$5,$6,'work_completed','unpaid',50000,0, now(), 'instapay')
       RETURNING id, order_number`,
      [`IGT-${h.runNum}`, customer.profileId, tech.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );

    // دفعة InstaPay معلّقة قايمة — زي ما بتتعمل لما العميل يدوس «ادفع عبر InstaPay»
    await h.q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method,
                             payment_status, gateway_reference, idempotency_key, initiated_at)
       VALUES (next_human_readable_number('PAY'),$1,$2,50000,'instapay','pending',$3,$3, now())`,
      [order.id, customer.profileId, `ref-${h.runId}`],
    );

    // ── ١) الطلب لسه قابل للدفع ⇒ الشاشة بتفتح عادي ──────────────────────────
    const open = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
    check(
      'الطلب المستحق: شاشة التحويل بتفتح ببياناتها',
      open.status === 200,
      `رجع ${open.status} — ${JSON.stringify(open.body?.error?.message)}`,
    );

    // ── ٢) الطلب اتقفل ⇒ **الشاشة تتقفل** ───────────────────────────────────
    await h.q(`UPDATE orders SET order_status = 'completed', payment_status = 'paid' WHERE id = $1`, [order.id]);
    const closed = await h.api(`/orders/${order.id}/instapay-transfer`, { token: customer.token });
    check(
      'الطلب المقفول: بيانات التحويل مابقتش بتترجع (ده بلاغ المالك بالحرف)',
      closed.status >= 400,
      `رجع ${closed.status} — لسه بيرجّع ${JSON.stringify(closed.body?.data?.recipient_address ?? closed.body?.data)}`,
    );
    check(
      'والرسالة بتقول السبب مش مجرد «مش موجود»',
      typeof closed.body?.error?.message === 'string' && closed.body.error.message.length > 10,
      JSON.stringify(closed.body?.error),
    );

    // ── ٣) الطلب الملغي كمان ────────────────────────────────────────────────
    const [cancelled] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at, payment_method)
       VALUES (20,$1,$2,$3,$4,$5,$6,'cancelled_by_customer','unpaid',50000,0, now(), 'instapay')
       RETURNING id`,
      [`IGC-${h.runNum}`, customer.profileId, tech.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );
    await h.q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method,
                             payment_status, gateway_reference, idempotency_key, initiated_at)
       VALUES (next_human_readable_number('PAY'),$1,$2,50000,'instapay','pending',$3,$3, now())`,
      [cancelled.id, customer.profileId, `refc-${h.runId}`],
    );
    const cancelledRes = await h.api(`/orders/${cancelled.id}/instapay-transfer`, { token: customer.token });
    check('الطلب الملغي كمان مابيعرضش بيانات تحويل', cancelledRes.status >= 400, `رجع ${cancelledRes.status}`);

    // ── ٤) الفرق المستحق بعد دفع كامل لسه شغّال (مايتكسرش) ──────────────────
    const [delta] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at, payment_method)
       VALUES (20,$1,$2,$3,$4,$5,$6,'awaiting_payment','paid',60000,0, now(), 'instapay')
       RETURNING id`,
      [`IGD-${h.runNum}`, customer.profileId, tech.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );
    await h.q(
      `INSERT INTO payments (payment_number, order_id, customer_id, amount_cents, payment_method,
                             payment_status, gateway_reference, idempotency_key, initiated_at)
       VALUES (next_human_readable_number('PAY'),$1,$2,10000,'instapay','pending',$3,$3, now())`,
      [delta.id, customer.profileId, `refd-${h.runId}`],
    );
    const deltaRes = await h.api(`/orders/${delta.id}/instapay-transfer`, { token: customer.token });
    check(
      'وفرق مستحق بعد دفع كامل لسه بيفتح عادي — الإصلاح ما كسرش المسار ده',
      deltaRes.status === 200,
      `رجع ${deltaRes.status} — ${JSON.stringify(deltaRes.body?.error?.message)}`,
    );

    console.log('');
    console.log(failures === 0 ? '✅ كل الفحوص عدّت' : `❌ ${failures} فحص فشل`);
  } finally {
    await h.cleanup();
    await h.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
