/**
 * **تحقّق حي: الشركة مش مقفولة على نفسها** (docs/08 §163، ADR-0086 تعديل ١).
 *
 * بلاغ مالك 2026-09-17: «لما الكاستمر يختار شركة، والشركة دي محتاجة عدد ناس كبير… يكون الطلب
 * قادر يدعو أي حد سواء من جوا الشركة أو من برا الشركة… مش عايزين تكون الشركة مغلقة على نفسها».
 *
 * الفرق بين ده وبين `company-recruitment-scope.spec.ts`: السبيك بتمتحن **الشرط** على القاعدة،
 * والسكربت ده بيمتحن **المسار كله**: endpoint الأدمن الحقيقي بيغيّر السياسة، وقايمة التجنيد
 * الحقيقية اللي تطبيق الفني بينادیها بتتغيّر نتيجتها فعلاً. الاتنين لازمين — واحد بيثبت
 * المنطق والتاني بيثبت إن فيه طريقة تشغّله.
 *
 *   node scripts/verify-company-open-recruitment.js   # محتاج API شغّال
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);

async function main() {
  const h = new LiveHarness('cor');
  await h.connect();
  let failures = 0;
  const check = (pass, label, extra) => {
    ok(pass, label, extra);
    if (!pass) failures += 1;
  };

  try {
    await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    const serviceId = h.catalog.service.id;
    const customer = await h.makeCustomer('c');
    const admin = await h.makeEmployee(['technician_companies.manage', 'technician_companies.view', 'orders.view'], 'ops');

    const leader = await h.makeTechnician('lead');
    const insider = await h.makeTechnician('in');
    const outsider = await h.makeTechnician('out');

    // شركة جديدة من المسار العادي — **بلا أي UPDATE على السياسة**، عشان الافتراضي هو اللي يتقاس.
    const [company] = await h.q(
      `INSERT INTO technician_companies (owner_user_id, name) VALUES ($1,$2) RETURNING id, allows_external_recruitment`,
      [leader.userId, `شركة ${h.nextTag('co')}`],
    );
    check(
      company.allows_external_recruitment === true,
      '**الافتراضي مفتوح** — شركة جديدة تقدر تدعو من برّها بلا تدخّل أدمن',
      `allows_external_recruitment=${company.allows_external_recruitment}`,
    );
    await h.q(`UPDATE technician_profiles SET company_id = $1 WHERE id = ANY($2::uuid[])`, [
      company.id,
      [leader.id, insider.id],
    ]);

    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: serviceId,
        address_id: customer.addressId,
        scheduled_at: tomorrow.toISOString(),
        requested_technician_id: leader.id,
        problem_description: 'COR اختبار تجنيد الشركة',
      },
    });
    const orderId = created.body.data?.id;
    if (!orderId) {
      check(false, 'الطلب اتعمل', `status=${created.status} ${created.body.error?.message ?? ''}`);
      return;
    }
    // الطلب بيتعمل على الفني مباشرةً؛ بنربطه بالشركة زي ما `resolveAssignedCompanyId()` بتعمل
    // للطلب اللي العميل اختار فيه الشركة، وبنحطّه في حالة الطاقم قابل للتعديل.
    await h.q(
      `UPDATE orders SET assigned_company_id = $2, technician_id = $3, order_status = 'technician_assigned',
              booking_mode = 'team', required_technicians = 3
        WHERE id = $1`,
      [orderId, company.id, leader.id],
    );

    const listCandidates = async () => {
      const res = await h.api(`/technician/orders/${orderId}/recruit-candidates?role=technician`, {
        token: leader.token,
      });
      const rows = res.body.data ?? [];
      return { status: res.status, ids: rows.map((r) => r.technician_id), rows };
    };

    const openRun = await listCandidates();
    const sawOutsider = openRun.ids.includes(outsider.id);
    check(
      openRun.status === 200 && sawOutsider,
      '**الشركة المفتوحة بتشوف فني من برّها في قايمة الدعوة** — نقطة الطلب بالحرف',
      `status=${openRun.status} عدد=${openRun.ids.length} من برّه=${sawOutsider}`,
    );

    const insiderRow = openRun.rows.find((r) => r.technician_id === insider.id);
    check(
      insiderRow?.is_leader_team_member === true,
      'وعضو الشركة عليه علامة عضوية (البادج اللي تطبيق الفني بيعرضه)',
      `is_leader_team_member=${insiderRow?.is_leader_team_member}`,
    );
    const insiderIndex = openRun.ids.indexOf(insider.id);
    const outsiderIndex = openRun.ids.indexOf(outsider.id);
    check(
      insiderIndex !== -1 && outsiderIndex !== -1 && insiderIndex < outsiderIndex,
      'وأعضاء الشركة فوق في الترتيب، من غير ما الباقي يتشال',
      `ترتيب العضو=${insiderIndex} ترتيب اللي من برّه=${outsiderIndex}`,
    );

    // ═══ الأدمن يقفلها من الـendpoint الحقيقي (اللي بقى ليه زرار في اللوحة) ═══
    const closed = await h.api(`/admin/technician-companies/${company.id}/recruitment-policy`, {
      method: 'PATCH',
      token: admin.token,
      body: { allows_external_recruitment: false, note: 'اختبار حي' },
    });
    check(
      closed.status === 200 && closed.body.data?.allows_external_recruitment === false,
      'الأدمن قفلها من الـAPI الحقيقي، والرد بيعلن الحقل (النوع المشترك بقى بيعرفه)',
      `status=${closed.status} القيمة=${closed.body.data?.allows_external_recruitment}`,
    );

    const closedRun = await listCandidates();
    check(
      !closedRun.ids.includes(outsider.id) && closedRun.ids.includes(insider.id),
      'وبعد القفل: اللي من برّه اختفى وعضو الشركة فضل — القفل بيشتغل فعلاً مش بيتجاهل',
      `عدد=${closedRun.ids.length} من برّه=${closedRun.ids.includes(outsider.id)}`,
    );

    const reopened = await h.api(`/admin/technician-companies/${company.id}/recruitment-policy`, {
      method: 'PATCH',
      token: admin.token,
      body: { allows_external_recruitment: true },
    });
    const reopenedRun = await listCandidates();
    check(
      reopened.status === 200 && reopenedRun.ids.includes(outsider.id),
      'والفتح تاني بيرجّعه — القرار قابل للعكس في الاتجاهين',
      `عدد=${reopenedRun.ids.length}`,
    );

    const [audit] = await h.q(
      `SELECT action FROM audit_logs WHERE entity_id = $1 AND action LIKE '%recruitment%' ORDER BY created_at DESC LIMIT 1`,
      [company.id],
    );
    check(!!audit, 'وكل تغيير بيتسجّل في سجل النشاط باسم الموظف', `آخر حدث=${audit?.action ?? 'مفيش'}`);
  } finally {
    await h.q(
      `DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE problem_description LIKE $1)`,
      ['COR %'],
    );
    await h.deleteOrders(`problem_description LIKE $1`, ['COR %']);
    await h.cleanup();
    await h.close();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ الشركة مفتوحة افتراضيًا، الأدمن يقدر يقفل ويفتح، وأعضاؤها فوق القايمة.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
