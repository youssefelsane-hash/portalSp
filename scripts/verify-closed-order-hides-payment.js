/**
 * تحقق حي من §150 بند ٤ — «طالما الطلب اتقفل ما يظهروش أصلاً الجزء بتاعه لسه خالص».
 *
 * بيقيس `is_closed` من `GET /orders/:id/instapay-preview` على نفس الطلب قبل القفل وبعده —
 * **الضابط جزء أصيل**: من غير القراءة الأولى، `is_closed = true` ممكن تبقى صح لأي سبب تاني.
 *
 *   node scripts/verify-closed-order-hides-payment.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('clp');
  await h.connect();
  let orderId;
  try {
    await h.seedCatalog({ priceCents: 20_000, durationMinutes: 60 });
    await h.q(`UPDATE services SET allows_emergency=false WHERE id=$1`, [h.catalog.service.id]);
    await h.makeTechnician('t');
    const customer = await h.makeCustomer('c');

    const scheduledAt = new Date(Date.now() + 5 * 86_400_000);
    scheduledAt.setUTCHours(9, 0, 0, 0);
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        booking_mode: 'individual',
        scheduled_at: scheduledAt.toISOString(),
        problem_description: 'تحقق §150 بند ٤',
      },
    });
    if (created.status >= 400) {
      console.log('❌ إنشاء الطلب فشل:', JSON.stringify(created.body?.error ?? created.body));
      return;
    }
    orderId = created.body?.id ?? created.body?.data?.id;

    const read = async () => {
      const res = await h.api(`/orders/${orderId}/instapay-preview`, { token: customer.token });
      const body = res.body?.data ?? res.body;
      return { status: res.status, isClosed: body?.is_closed, isPayable: body?.is_payable };
    };

    const before = await read();
    console.log('قبل القفل :', JSON.stringify(before));

    await h.q(`UPDATE orders SET order_status='completed' WHERE id=$1`, [orderId]);
    const after = await read();
    console.log('بعد القفل :', JSON.stringify(after));

    if (before.isClosed === false && after.isClosed === true) {
      console.log('\n✅ الخانة بتختفي بعد القفل بس — والضابط بيثبت إنها كانت ظاهرة قبله.');
    } else {
      console.log('\n❌ النتيجة مش زي المتوقع — شوف القراءتين فوق.');
    }
  } finally {
    if (orderId) await h.deleteOrders(`id = $1`, [orderId]);
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
