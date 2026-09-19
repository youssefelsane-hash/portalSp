/**
 * **تحقق حي: «مفتّش المطابقة» بيتعرض كامل على كل شكل طلب** (بلاغ مالك 2026-09-19، docs/08 §166).
 *
 * > «التوزيع ده دخلت دلوقتي مش شايفه، مش ظاهر لحد الآن ليه. أنا عايز حتى لو الطلب راح للشخص
 * >  على طول exception يلاقيه أو شايف — عايز أبقى فاهم السيستم بيتصرف إزاي من كل طلب.»
 *
 * ## ليه السكريبت ده موجود
 *
 * القسم ده كان بيختفي **كله** لأسباب مالهاش علاقة بيه:
 *
 * | السبب | الأثر قبل الإصلاح |
 * |---|---|
 * | الطلب بلا `service_zone_id` | الـendpoint بيرجّع **400**، فكل القسم يختفي من الصفحة |
 * | الطلب مش `TEAM` | قسمي «فرص تجنيد الفريق» و«حالة الطاقم» يختفوا بلا أي سطر يقول ليه |
 * | مفيش جولات توزيع | جدول الجولات يرجّع `null` — نفس شكل «النداء فشل» بالظبط |
 *
 * التلات حالات دي كانت بتدّي نفس النتيجة على الشاشة (**مفيش حاجة**)، فالأدمن اللي شاف القسم
 * على طلب وما شافهوش على التاني يستنتج إن الميزة اتشالت. دلوقتي كل حالة بتقول نفسها.
 *
 * ## اللي بيتقاس هنا
 *
 * لكل شكل طلب: الـendpoint بيرجّع **200**، ومسار التوزيع والعدّادات موجودين **دايمًا**، وكل
 * قسم غايب معاه **سبب غيابه بالنص** — مش `null` صامت.
 *
 *   node scripts/verify-matching-inspector-completeness.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('mic');
  await h.connect();
  const results = [];

  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeAdmin();

    /**
     * بينشئ طلب بالـSQL مباشرةً عن قصد: الهدف هنا هو **أشكال الطلبات اللي الـAPI مابيسمحش
     * بإنشائها من الواجهة** (طلب بلا نطاق خدمة مثلاً) — وهي بالظبط اللي كانت بتكسر القسم.
     */
    const makeOrder = async ({ zone = true, bookingMode = 'individual', technician = null, status = 'searching_technician' }) => {
      const [order] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied,
           required_technicians, required_assistants)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '7 days', 120, $8, 30000,'cash',20.00,
                 $9, $10)
         RETURNING id`,
        [
          customer.profileId,
          h.catalog.service.id,
          customer.addressId,
          zone ? h.catalog.zone.id : null,
          `MIC-${h.nextTag()}`,
          status,
          bookingMode,
          technician,
          bookingMode === 'team' ? 2 : 1,
          bookingMode === 'team' ? 1 : 0,
        ],
      );
      return order.id;
    };

    /** نفس اللي الواجهة بتقراه بالحرف. */
    const readFunnel = async (orderId) => {
      const res = await h.api(`/admin/orders/${orderId}/matching-funnel`, { token: admin.token });
      return { status: res.status, body: res.body?.data ?? res.body };
    };

    /**
     * القاعدة الواحدة اللي كل الحالات بتتقاس بيها: **مفيش قسم بيختفي بلا سبب مكتوب**.
     * القسم يا إما فيه أرقامه، يا إما فيه جملة عربية بتقول ليه مفيهوش.
     */
    const check = async (label, orderId) => {
      const { status, body } = await readFunnel(orderId);
      const problems = [];
      if (status !== 200) {
        problems.push(`الـendpoint رجّع ${status} بدل 200 — القسم كله بيختفي من الصفحة`);
      } else {
        if (!body.dispatch_route?.explanation_ar) problems.push('مسار التوزيع بلا شرح');
        if (!body.dispatch_assignments) problems.push('عدّادات العروض مش موجودة');
        if (!body.pool && !body.pool_unavailable_reason_ar) problems.push('المجمّع غايب بلا سبب مكتوب');
        if (!body.crew_recruit_opportunities && !body.crew_unavailable_reason_ar) {
          problems.push('فرص تجنيد الفريق غايبة بلا سبب مكتوب');
        }
        if (!body.crew_status && !body.crew_unavailable_reason_ar) problems.push('حالة الطاقم غايبة بلا سبب مكتوب');
      }
      results.push({ label, status, problems, body });
    };

    await check('طلب بلا نطاق خدمة (كان بيرجّع 400)', await makeOrder({ zone: false }));
    await check('طلب فردي بنطاق، لسه ما اتوزّعش', await makeOrder({}));
    await check('طلب راح للفني على طول (متعيّن بلا جولات)', await makeOrder({ technician: tech.id, status: 'accepted' }));
    await check('طلب فريق (فنيين ومساعدين مطلوبين)', await makeOrder({ bookingMode: 'team' }));
    await check('طلب مش في مرحلة توزيع (مكتمل)', await makeOrder({ technician: tech.id, status: 'completed' }));

    await h.deleteOrders(`order_number LIKE $1`, ['MIC-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— مفتّش المطابقة على كل شكل طلب —\n');
  let allOk = true;
  for (const { label, status, problems, body } of results) {
    const ok = problems.length === 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}  (HTTP ${status})`);
    if (status === 200) {
      console.log(`     مسار: ${body.dispatch_route?.route} — ${body.dispatch_route?.explanation_ar}`);
      console.log(`     مجمّع: ${body.pool ? `محسوب (${body.pool.category_eligible} للفئة)` : body.pool_unavailable_reason_ar}`);
      console.log(`     عروض: اتبعت ${body.dispatch_assignments?.sent} · رُفض ${body.dispatch_assignments?.rejected}`);
      console.log(
        `     طاقم: ${body.crew_status ? `${body.crew_status.assignedTechnicians}/${body.crew_status.requiredTechnicians} فنيين` : body.crew_unavailable_reason_ar}`,
      );
    }
    for (const p of problems) console.log(`     ⚠️  ${p}`);
    console.log('');
  }
  console.log(allOk ? '✅ كل قسم بيتعرض أو بيقول سبب غيابه — على كل شكل طلب.' : '❌ فيه قسم بيختفي بصمت.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
