'use strict';
/**
 * إعادة إنتاج حيّة لبلاغ المالك (2026-09-11):
 * «لما يكون فيه فريق وعايزين نضيف حد، الناس كلها بتبان إن هي مشغولة والسيستم مش بيرضى يضيف
 *  حد للطلب رغم إن الطلب محتاج ناس وفيه ناس فاضية… التاريخ بيكون فعليًا عدى.»
 *
 * الفرضية: طلب فريق ممتد أيام بدأ في الماضي — نافذة فحص القدرة اليومية بتتحسب من **يوم البداية
 * الأصلي** لطول المدة كلها، فبتغطّي أيام عدّت وأيام جاية. أي مرشّح عنده شغل في أي يوم من
 * النافذة دي بيتحسب «مشغول» رغم إن الأيام اللي فاتت مش قابلة للحجز أصلاً.
 */
const { LiveHarness, sleep } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('crewrepro');
  await h.connect();
  try {
    // خدمة فريق ممتدة أيام
    const catalog = await h.seedCatalog({ priceCents: 500_000, durationMinutes: 480 });
    await h.q(`UPDATE services SET allows_team = true, allows_individual = true WHERE id = $1`, [catalog.service.id]);

    const customer = await h.makeCustomer('c1');
    const leader = await h.makeTechnician('leader');
    const freeGuy = await h.makeTechnician('free');
    const busyToday = await h.makeTechnician('busytoday');
    // فنيين مخصّصين لكل سيناريو — الإضافة الناجحة في سيناريو بتخلي الفني ملتزم فعلاً، فإعادة
    // استخدامه في السيناريو اللي بعده بتقيس التلوث مش السلوك.
    const freeGuy2 = await h.makeTechnician('free2');
    const busyToday2 = await h.makeTechnician('busytoday2');
    const admin = await h.makeAdmin();

    // ── الطلب: فريق، بدأ من ١٠ أيام، ممتد ٢٠ يوم (يعني لسه شغّال) ─────────────
    const [order] = await h.q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, booking_mode, scheduled_at, estimated_duration_days, duration_minutes,
          required_technicians, required_assistants, total_amount_cents, payment_method,
          commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'in_progress','team', now() - interval '10 days', 20, NULL,
               4, 0, 500000, 'cash', 20)
       RETURNING id, order_number, scheduled_at`,
      [
        `CR-${h.runNum}-1`,
        customer.profileId,
        leader.id,
        catalog.service.id,
        customer.addressId,
        catalog.zone.id,
      ],
    );

    // ── طلب تاني نشط لكل من busyToday/busyToday2 النهاردة بس (يوم واحد) ──────
    await h.q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, booking_mode, scheduled_at, duration_minutes, total_amount_cents, payment_method,
          commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','individual', now(), 120, 50000, 'cash', 20)`,
      [`CR-${h.runNum}-2`, customer.profileId, busyToday.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );
    await h.q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, booking_mode, scheduled_at, duration_minutes, total_amount_cents, payment_method,
          commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','individual', now(), 120, 50000, 'cash', 20)`,
      [`CR-${h.runNum}-2b`, customer.profileId, busyToday2.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );

    console.log(`الطلب: ${order.order_number} — فريق، بدأ ${order.scheduled_at.toISOString().slice(0, 10)}، ممتد ٢٠ يوم، محتاج ٤ فنيين`);
    console.log('');

    for (const [label, tech] of [
      ['فني فاضي تمامًا (صفر طلبات)', freeGuy],
      ['فني عنده طلب النهاردة ساعتين بس', busyToday],
    ]) {
      const res = await h.api(`/admin/orders/${order.id}/team-members`, {
        method: 'POST',
        token: admin.token,
        body: { technician_id: tech.id, role_label: 'عضو طاقم', member_type: 'team_member' },
      });
      const outcome =
        res.status >= 400
          ? `❌ ${res.status} — ${res.body?.error?.message ?? JSON.stringify(res.body)}`
          : `✅ ${res.status} — ${res.body?.data?.status ?? 'ok'}`;
      console.log(`${label}: ${outcome}`);
    }

    // ── نفس السيناريو بالظبط بس التاريخ في المستقبل، للمقارنة ────────────────
    const [futureOrder] = await h.q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, booking_mode, scheduled_at, estimated_duration_days, duration_minutes,
          required_technicians, required_assistants, total_amount_cents, payment_method,
          commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','team', now() + interval '40 days', 20, NULL,
               4, 0, 500000, 'cash', 20)
       RETURNING id, order_number`,
      [`CR-${h.runNum}-3`, customer.profileId, leader.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );
    console.log('');
    console.log(`مقارنة — نفس الطلب بالظبط بس بيبدأ بعد ٤٠ يوم (${futureOrder.order_number}):`);
    const freeOnFuture = await h.api(`/admin/orders/${futureOrder.id}/team-members`, {
      method: 'POST',
      token: admin.token,
      body: { technician_id: freeGuy.id, role_label: 'عضو طاقم', member_type: 'team_member' },
    });
    console.log(
      `  فني فاضي: ${freeOnFuture.status >= 400 ? `❌ ${freeOnFuture.status} — ${freeOnFuture.body?.error?.message}` : `✅ ${freeOnFuture.status}`}`,
    );

    // ── عزل السبب التاني: بداية في الماضي، بس في حالة الطاقم فيها **قابل للتعديل** ──────
    const [pastAssigned] = await h.q(
      `INSERT INTO orders
         (order_number, customer_id, technician_id, service_id, address_id, service_zone_id,
          order_status, booking_mode, scheduled_at, estimated_duration_days, duration_minutes,
          required_technicians, required_assistants, total_amount_cents, payment_method,
          commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'technician_assigned','team', now() - interval '10 days', 20, NULL,
               4, 0, 500000, 'cash', 20)
       RETURNING id, order_number`,
      [`CR-${h.runNum}-4`, customer.profileId, leader.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );
    console.log('');
    console.log(`عزل — طلب فريق بدأ من ١٠ أيام بس لسه في حالة قابلة لتعديل الطاقم (${pastAssigned.order_number}):`);
    for (const [label, tech] of [
      ['فني فاضي تمامًا', freeGuy2],
      ['فني عنده طلب النهاردة ساعتين بس', busyToday2],
    ]) {
      const res = await h.api(`/admin/orders/${pastAssigned.id}/team-members`, {
        method: 'POST',
        token: admin.token,
        body: { technician_id: tech.id, role_label: 'عضو طاقم', member_type: 'team_member' },
      });
      console.log(
        `  ${label}: ${res.status >= 400 ? `❌ ${res.status} — ${res.body?.error?.message}` : `✅ ${res.status} — ${res.body?.data?.status ?? 'ok'}`}`,
      );
    }

    // ── القوايم اللي الأدمن بيشوفها: مين «متاح» فعلاً في كل حالة ──────────────
    console.log('');
    console.log('قوايم المرشّحين اللي الأدمن بيشوفها:');
    for (const [label, oid] of [
      ['طلب شغّال بدأ من ١٠ أيام', order.id],
      ['طلب بيبدأ بعد ٤٠ يوم', futureOrder.id],
    ]) {
      const elig = await h.api(`/admin/orders/${oid}/eligible-technicians`, { token: admin.token });
      const asst = await h.api(`/admin/orders/${oid}/eligible-assistants`, { token: admin.token });
      const eligItems = elig.body?.data?.items ?? [];
      const asstItems = Array.isArray(asst.body?.data) ? asst.body.data : [];
      console.log(`  ${label}: eligible-technicians=${eligItems.length} — eligible-assistants=${asstItems.length}`);
    }

    // ── تشخيص خام: النافذة اللي الفحص بيمشي عليها فعلاً ──────────────────────
    const [win] = await h.q(
      `SELECT (scheduled_at AT TIME ZONE 'Africa/Cairo')::date AS start_day,
              ((scheduled_at AT TIME ZONE 'Africa/Cairo')::date + (estimated_duration_days - 1)) AS end_day,
              (now() AT TIME ZONE 'Africa/Cairo')::date AS today
       FROM orders WHERE id = $1`,
      [order.id],
    );
    console.log('');
    console.log(
      `نافذة فحص القدرة للطلب الشغّال: من ${win.start_day.toISOString().slice(0, 10)} لـ ${win.end_day.toISOString().slice(0, 10)} — النهاردة ${win.today.toISOString().slice(0, 10)}`,
    );
    const elapsed = Math.round((win.today - win.start_day) / 86400000);
    console.log(`منهم ${elapsed} يوم عدّوا خلاص ومش قابلين للحجز، وبيتحسبوا على المرشّح.`);

    await sleep(200);
  } finally {
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
