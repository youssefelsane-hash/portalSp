'use strict';
/**
 * تدقيق حي لمركز المراجعة (ADR-0084، docs/08 §139) — على الـAPI الحقيقي، مش الخدمة مباشرة.
 *
 * الفرق عن `admin-review-center.service.spec.ts` مقصود: السبيك بيثبت منطق الاستعلام، وده بيثبت
 * **العقد اللي الواجهة بتاكل منه**: الصلاحية، شكل الـJSON، snake_case، والفلاتر من الـquery
 * string (اللي بتوصل كنصوص، وهي أكتر حتة بتتكسر بصمت).
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('rvcaudit');
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
    const admin = await h.makeAdmin();

    const [order] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at)
       VALUES (20,$1,$2,$3,$4,$5,$6,'in_progress','pending',50000,0, now()) RETURNING id, order_number`,
      [`RVA-${h.runNum}`, customer.profileId, tech.id, catalog.service.id, customer.addressId, catalog.zone.id],
    );

    await h.q(
      `INSERT INTO order_items (order_id, item_type, name_ar, description, quantity, unit_price_cents,
                                total_price_cents, added_by_user_id, proposal_status)
       VALUES ($1,'extra_labor','ساعتين شغل زيادة','الحيطة كانت محتاجة تكسير أكتر من المتوقع عشان نوصل للماسورة',2,10000,20000,$2,'pending')`,
      [order.id, tech.userId],
    );

    // ── ١) العقد نفسه ────────────────────────────────────────────────────────
    const res = await h.api('/admin/operations/review-center?since_days=1', { token: admin.token });
    check('GET /admin/operations/review-center بيرد 200', res.status === 200, `رجع ${res.status}`);
    const body = res.body?.data;
    check(
      'الأقسام الأربعة موجودة بالأسماء المتفق عليها',
      body &&
        ['technician_money_actions', 'failed_visits', 'cash_disputes', 'unresolved_complaints'].every((k) => k in body),
      JSON.stringify(Object.keys(body ?? {})),
    );

    const mine = (body?.technician_money_actions?.items ?? []).find((i) => i.order_id === order.id);
    check('الفعل المالي بتاع الطلب ظاهر في القايمة', Boolean(mine), 'مش موجود');
    check(
      'النص اللي الفني كتبه بيوصل بالحرف عبر الـAPI',
      mine?.justification === 'الحيطة كانت محتاجة تكسير أكتر من المتوقع عشان نوصل للماسورة',
      JSON.stringify(mine?.justification),
    );
    check('الحقول snake_case زي باقي واجهة الأدمن', mine && 'order_number' in mine && 'is_pending' in mine, JSON.stringify(Object.keys(mine ?? {})));

    // ── ٢) الفلاتر من الـquery string (نصوص، مش قيم TS) ──────────────────────
    const pendingRes = await h.api('/admin/operations/review-center?since_days=1&pending_only=true', { token: admin.token });
    const pendingItems = pendingRes.body?.data?.technician_money_actions?.items ?? [];
    check(
      'pending_only=true بيفلتر فعلاً (مش بيتقرا كنص truthy وخلاص)',
      pendingRes.status === 200 && pendingItems.every((i) => i.is_pending === true),
      `${pendingRes.status} / ${pendingItems.filter((i) => !i.is_pending).length} صف مش pending`,
    );

    const otherTech = await h.makeTechnician('t2');
    const filtered = await h.api(`/admin/operations/review-center?since_days=1&technician_id=${otherTech.id}`, {
      token: admin.token,
    });
    const filteredItems = filtered.body?.data?.technician_money_actions?.items ?? [];
    check(
      'technician_id بيفلتر على الفني المطلوب بس',
      filtered.status === 200 && !filteredItems.some((i) => i.order_id === order.id),
      'صف فني تاني ظهر في الفلترة',
    );

    const badRange = await h.api('/admin/operations/review-center?since_days=9999', { token: admin.token });
    check('مدى زمني خارج الحدود بيترفض بوضوح مش بيتقصّ بصمت', badRange.status === 400, `رجع ${badRange.status}`);

    // ── ٣) الصلاحية ─────────────────────────────────────────────────────────
    const noPerm = await h.makeEmployee([], 'noperm');
    const denied = await h.api('/admin/operations/review-center', { token: noPerm.token });
    check('موظف بلا operations.view بيترفض', denied.status === 403, `رجع ${denied.status}`);

    // ── ٤) التبرير الإجباري على المسار الحقيقي ──────────────────────────────
    const noJustification = await h.api(`/technician/orders/${order.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: { items: [{ item_type: 'spare_part', name_ar: 'قطعة', quantity: 1, unit_price_cents: 5000 }] },
    });
    check('اقتراح بند بلا تبرير بيترفض من الـAPI', noJustification.status === 400, `رجع ${noJustification.status}`);

    // ── ٥) الشكوى بترجّع طرفيها ─────────────────────────────────────────────
    const [cmpNum] = await h.q(`SELECT next_human_readable_number('CMP') AS n`);
    await h.q(
      `INSERT INTO complaints (complaint_number, order_id, filed_by_user_id, against_user_id, category,
                               severity, title, description, complaint_status, compensation_cents, sla_due_at)
       VALUES ($1,$2,$3,$4,'overcharging','high','سعر مبالغ فيه','الفني طلب زيادة',
               'open',0, now() + interval '4 hours')`,
      [cmpNum.n, order.id, customer.userId, tech.userId],
    );
    const complaints = await h.api('/admin/complaints', { token: admin.token });
    const row = (complaints.body?.data ?? []).find((c) => c.order_id === order.id);
    check(
      'GET /admin/complaints بيرجّع مقدّم الشكوى والمشكو في حقه بالاسم',
      Boolean(row?.filed_by?.full_name) && Boolean(row?.against?.full_name),
      JSON.stringify({ filed_by: row?.filed_by, against: row?.against }),
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
