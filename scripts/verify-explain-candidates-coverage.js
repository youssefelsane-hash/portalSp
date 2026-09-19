/**
 * **تحقق حي: قايمة «ليه/ليه لأ» بتشمل اللي على الطلب دايمًا** (docs/08 §167، بلاغ مالك 2026-09-19).
 *
 * > «لما الطلب بيروح لصنايعي معين أو مساعد معين بلاقي إن بتاعه مش شغال. لما بدوس على ليه ولأ
 * >  ما بيظهرليش أحد، على الرغم إن هي مع ناس تانية ممكن تظهرلي.»
 *
 * ## ليه ده كان بيحصل
 *
 * القايمة كانت بتتبني على سؤال «مين **معتمد ومغطّي مدينة** الطلب دلوقتي؟». وده سؤال تاني خالص
 * عن «مين له علاقة بالطلب ده؟» — فالشخص اللي شايل الطلب كان بيقع بره القايمة في تلات حالات
 * حقيقية: غطّيته للمدينة اتغيّرت بعد التعيين · اتعيّن من مدينة تانية · اعتماده اتسحب. وفوقهم
 * حالة رابعة: الطلب بلا نطاق خدمة كان بيرمي **400** والواجهة بتبلع الخطأ فالقايمة تبان فاضية.
 *
 * اتقاس على قاعدة التطوير قبل الإصلاح: **١٣ من ٣٧ طلب (٣٥٪)** مالهمش إجابة على السؤال ده.
 *
 * ## اللي بيتقاس هنا
 *
 * لكل حالة: الـendpoint بيرجّع **200**، و**الفني اللي على الطلب موجود في القايمة**، وعلاقته
 * بالطلب مترجعة صح (`relation_to_order`) عشان الواجهة ترتّبه فوق.
 *
 *   node scripts/verify-explain-candidates-coverage.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('ecc');
  await h.connect();
  const results = [];

  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeAdmin();

    const makeOrder = async ({ zone = true, technician = null, status = 'searching_technician' }) => {
      const [o] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,$6,'individual', now() + interval '7 days', 120, $7, 30000,'cash',20.00)
         RETURNING id`,
        [
          customer.profileId, h.catalog.service.id, customer.addressId,
          zone ? h.catalog.zone.id : null,
          `ECC-${h.nextTag()}`, status, technician,
        ],
      );
      return o.id;
    };

    const read = async (orderId) => {
      const res = await h.api(`/admin/orders/${orderId}/explain-candidates`, { token: admin.token });
      return { status: res.status, body: res.body?.data ?? res.body };
    };

    /** القاعدة: الشخص اللي على الطلب لازم يكون في القايمة، مهما كانت حالته دلوقتي. */
    const check = async (label, orderId, expectTechnicianId, expectRelation) => {
      const { status, body } = await read(orderId);
      const problems = [];
      if (status !== 200) {
        problems.push(`رجّع ${status} بدل 200 — الواجهة بتبلع الخطأ فالقايمة تبان فاضية`);
      } else {
        const items = body.items ?? [];
        const found = items.find((i) => i.technician_id === expectTechnicianId);
        if (!found) problems.push('الفني اللي على الطلب **مش** في القايمة');
        else if (found.relation_to_order !== expectRelation) {
          problems.push(`علاقته رجعت «${found.relation_to_order}» والمتوقع «${expectRelation}»`);
        }
        if (!body.scope_note_ar) problems.push('مفيش سطر بيشرح نطاق القايمة');
        results.push({ label, status, problems, count: items.length, note: body.scope_note_ar });
        return;
      }
      results.push({ label, status, problems, count: 0, note: null });
    };

    // ١) الحالة العادية — الضابط.
    const normal = await makeOrder({ technician: tech.id, status: 'accepted' });
    await check('طلب عادي، الفني مغطّي مدينة الطلب', normal, tech.id, 'assigned');

    // ٢) **الحالة اللي المالك بيبلّغ عنها**: الفني على الطلب بس مش مغطّي مدينته دلوقتي.
    const offCity = await makeOrder({ technician: tech.id, status: 'accepted' });
    await h.q(`UPDATE technician_zones SET is_active = false WHERE technician_id = $1`, [tech.id]);
    await check('الفني على الطلب بس غطّيته للمدينة اتلغت (كان بيختفي)', offCity, tech.id, 'assigned');
    await h.q(`UPDATE technician_zones SET is_active = true WHERE technician_id = $1`, [tech.id]);

    // ٣) اعتماده اتسحب بعد الشغل — لسه لازم يتفسّر.
    const unapproved = await makeOrder({ technician: tech.id, status: 'completed' });
    await h.q(`UPDATE technician_profiles SET verification_status = 'suspended' WHERE id = $1`, [tech.id]);
    await check('اعتماد الفني اتسحب بعد الطلب (كان بيختفي)', unapproved, tech.id, 'assigned');
    await h.q(`UPDATE technician_profiles SET verification_status = 'approved' WHERE id = $1`, [tech.id]);

    // ٤) طلب بلا نطاق خدمة — كان **400** فالقايمة فاضية بلا سبب.
    const noZone = await makeOrder({ zone: false, technician: tech.id, status: 'accepted' });
    await check('طلب بلا نطاق خدمة (كان بيرجّع 400)', noZone, tech.id, 'assigned');

    // ٥) اتعرض عليه ورفض — «مين رفضه» سؤال أساسي والشخص ده مش متعيّن على الطلب.
    const rejected = await makeOrder({});
    await h.q(
      `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status,
         sent_at, expires_at, responded_at)
       VALUES ($1,$2,1,'rejected', now() - interval '2 hours', now() - interval '1 hour', now() - interval '90 minutes')`,
      [rejected, tech.id],
    );
    await h.q(`UPDATE technician_zones SET is_active = false WHERE technician_id = $1`, [tech.id]);
    await check('اتعرض عليه ورفض، ومش مغطّي المدينة دلوقتي', rejected, tech.id, 'offered');
    await h.q(`UPDATE technician_zones SET is_active = true WHERE technician_id = $1`, [tech.id]);

    await h.deleteOrders(`order_number LIKE $1`, ['ECC-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— قايمة «ليه/ليه لأ» على كل حالة —\n');
  let allOk = true;
  for (const { label, status, problems, count, note } of results) {
    const ok = problems.length === 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}  (HTTP ${status}، ${count} مرشّح)`);
    if (note) console.log(`     ${note}`);
    for (const p of problems) console.log(`     ⚠️  ${p}`);
    console.log('');
  }
  console.log(allOk ? '✅ اللي على الطلب موجود في القايمة في كل الحالات.' : '❌ فيه حالة الشخص اللي على الطلب مش ظاهر فيها.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
