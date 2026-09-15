'use strict';
/**
 * إعادة إنتاج بلاغ المالك (2026-09-13) والتحقق من الإصلاح — على الـAPI الحقيقي.
 *
 * البلاغ: «الصنايعي بييجي يدوس إضافة شغل إضافي أو قطعة غيار، يكتب اسم البند ويحط السعر،
 *  بيقوله البيانات المرسلة غير صحيحة».
 *
 * السبب: ADR-0084 §2 خلّى `description` إجباري في العقد، وتطبيق الفني مكانش بيبعته أصلاً.
 * السكربت ده بيبعت **الحمولتين** — القديمة (زي ما التطبيق كان بيبعت) والجديدة (بعد الإصلاح) —
 * ويتأكد إن القديمة بترفض برسالة **بتسمّي الحقل**، والجديدة بتعدّي وبتغيّر حالة الطلب فعلاً.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('techmoney');
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
       VALUES (20,$1,$2,$3,$4,$5,$6,'in_progress','pending',50000,0, now(), 'cash')
       RETURNING id, order_number`,
      [`TMA-${h.runNum}`, customer.profileId, tech.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );

    // ── ١) الحمولة القديمة بالحرف (اللي التطبيق كان بيبعتها) ──────────────────
    const oldPayload = await h.api(`/technician/orders/${order.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: { items: [{ item_type: 'spare_part', name_ar: 'مواسير نحاس', quantity: 2, unit_price_cents: 15000 }] },
    });
    check('الحمولة القديمة (بلا سبب) بترفض — ده البلاغ نفسه', oldPayload.status === 400, `رجع ${oldPayload.status}`);
    const oldMessage = oldPayload.body?.error?.message ?? '';
    check(
      'الرسالة بقت بتسمّي الحقل بدل «البيانات المرسلة غير صحيحة» المسدودة',
      oldMessage.includes('سبب البند'),
      JSON.stringify(oldMessage),
    );

    // ── ٢) سبب قصير: نفس الحد بالظبط بين التطبيق والسيرفر ────────────────────
    const shortReason = await h.api(`/technician/orders/${order.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: {
        items: [
          { item_type: 'spare_part', name_ar: 'مواسير نحاس', description: 'قصير', quantity: 2, unit_price_cents: 15000 },
        ],
      },
    });
    check('سبب أقصر من ١٠ حروف بيترفض برسالة واضحة', shortReason.status === 400, `رجع ${shortReason.status}`);
    check(
      'ورسالته بتسمّي الحقل كمان',
      (shortReason.body?.error?.message ?? '').includes('سبب البند'),
      JSON.stringify(shortReason.body?.error?.message),
    );

    // ── ٣) الحمولة الجديدة (اللي التطبيق بقى بيبعتها بعد الإصلاح) ────────────
    const newPayload = await h.api(`/technician/orders/${order.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: {
        items: [
          {
            item_type: 'spare_part',
            name_ar: 'مواسير نحاس',
            description: 'المواسير القديمة متآكلة والتسريب طالع من عندها — لازم تتغيّر بالكامل',
            quantity: 2,
            unit_price_cents: 15000,
          },
        ],
      },
    });
    check('الحمولة الجديدة بتعدّي فعلاً', newPayload.status === 200 || newPayload.status === 201, `رجع ${newPayload.status} — ${JSON.stringify(newPayload.body?.error)}`);

    // ── ٤) والأثر الحقيقي حصل: البند اتسجّل والطلب اتحوّل لانتظار موافقة العميل ─
    const [row] = await h.q(
      `SELECT item_type, name_ar, description, total_price_cents, proposal_status
         FROM order_items WHERE order_id = $1`,
      [order.id],
    );
    check('البند اتسجّل في القاعدة', Boolean(row), 'مفيش صف');
    check(
      'ونص الفني اتخزّن بالحرف (ده اللي الأدمن بيراجعه)',
      row?.description === 'المواسير القديمة متآكلة والتسريب طالع من عندها — لازم تتغيّر بالكامل',
      JSON.stringify(row?.description),
    );
    const [after] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [order.id]);
    check(
      'والطلب اتحوّل لانتظار موافقة العميل',
      after?.order_status === 'awaiting_quote_approval',
      `الحالة ${after?.order_status}`,
    );

    // ── ٥) البند بيظهر فورًا في مركز المراجعة عند الأدمن ─────────────────────
    const admin = await h.makeAdmin();
    const review = await h.api('/admin/operations/review-center?since_days=1', { token: admin.token });
    const item = (review.body?.data?.technician_money_actions?.items ?? []).find((i) => i.order_id === order.id);
    check('والبند ظهر في مركز المراجعة بنصه', Boolean(item?.justification), JSON.stringify(item ?? null));

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
