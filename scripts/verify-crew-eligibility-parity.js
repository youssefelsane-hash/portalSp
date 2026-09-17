/**
 * **تحقق حي: هل نفس الشخص مؤهّل في الحجز ومختفي في التجنيد؟** (طلب مالك 2026-09-17، docs/08 §156).
 *
 * > «Customer يرى ٧ أشخاص مؤهلين… يختار واحدًا قائدًا. القائد عند فتح قائمة التجنيد لنفس الخدمة
 * >  ونفس الوقت يُفترض أن يحصل على نفس eligibility universe الذي استخدمه الحجز.»
 *
 * السكربت ده **بيثبت الفجوة قبل الإصلاح** وبيفضل هو نفسه اختبار الانحدار بعده. بيقارن:
 *
 *   A) قايمة اختيار العميل  `GET /services/:id/technicians`
 *   B) قايمة تجنيد القائد    `GET /technician/orders/:id/recruit-candidates?role=technician`
 *
 * على **نفس الخدمة ونفس الموعد ونفس النطاق** وببيانات واحدة، وبيطلّع مين موجود في A ومش في B.
 *
 *   node scripts/verify-crew-eligibility-parity.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('cep');
  await h.connect();
  const checks = [];
  const record = (label, ok, detail) => checks.push([label, ok, detail]);

  try {
    // خدمة **مابتشترطش قائد فني** — يعني بقرار الأدمن نفسه المساعد يقدر يقودها (ADR-0087).
    await h.seedCatalog({ priceCents: 40_000, durationMinutes: 120 });
    await h.q(
      `UPDATE services SET requires_technician_lead = false, allows_team = true, allows_individual = true
        WHERE id = $1`,
      [h.catalog.service.id],
    );

    const customer = await h.makeCustomer('c');
    const techLead = await h.makeTechnician('lead');
    const techPeer = await h.makeTechnician('peer');
    const assistant = await h.makeTechnician('asst');
    // نفس الاعتماد بالظبط للتلاتة — الفرق الوحيد هو `technician_kind`.
    await h.q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [assistant.id]);

    const scheduledAt = new Date(Date.now() + 6 * 86_400_000);
    scheduledAt.setUTCHours(9, 0, 0, 0);

    // ════ A) قايمة اختيار العميل ════
    const listRes = await h.api(
      `/services/${h.catalog.service.id}/technicians?address_id=${customer.addressId}` +
        `&scheduled_at=${encodeURIComponent(scheduledAt.toISOString())}`,
      { token: customer.token },
    );
    const listed = ((listRes.body?.data ?? listRes.body) || []).filter((row) => row && row.id);
    const listedIds = new Set(listed.map((row) => row.id));

    record(
      'قايمة العميل بترجع التلاتة — الخدمة مابتشترطش قائد فني',
      listedIds.has(techLead.id) && listedIds.has(techPeer.id) && listedIds.has(assistant.id),
      `فني=${listedIds.has(techLead.id)} فني٢=${listedIds.has(techPeer.id)} مساعد=${listedIds.has(assistant.id)}`,
    );
    record(
      '**المساعد ظاهر للعميل كقائد محتمل** — ده أساس التناقض كله',
      listedIds.has(assistant.id),
      `عدد الظاهرين=${listed.length}`,
    );

    // ════ طلب حقيقي محتاج طاقم: قائد + منفّذ تاني ════
    const [order] = await h.q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
         required_technicians, required_assistants,
         total_amount_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,'accepted','team',$6,120,$7,2,0,40000,'cash',20.00)
       RETURNING id`,
      [
        customer.profileId,
        h.catalog.service.id,
        customer.addressId,
        h.catalog.zone.id,
        `CEP-${h.nextTag()}`,
        scheduledAt.toISOString(),
        techLead.id,
      ],
    );

    // ════ B) قايمة تجنيد القائد لنفس الخدمة ونفس الموعد ════
    const recruitRes = await h.api(
      `/technician/orders/${order.id}/recruit-candidates?role=technician`,
      { token: techLead.token },
    );
    const recruits = (recruitRes.body?.data ?? recruitRes.body) || [];
    const recruitIds = new Set(recruits.map((row) => row.technician_id ?? row.technicianId));

    record(
      'قايمة التجنيد شغّالة وبترجع الفني التاني (ضابط)',
      recruitRes.status === 200 && recruitIds.has(techPeer.id),
      `status=${recruitRes.status} عدد=${recruits.length}`,
    );

    // **النقطة الجوهرية**: نفس المساعد اللي العميل شافه كقائد — بيظهر في التجنيد؟
    record(
      'المساعد المؤهّل لقيادة الخدمة بيقدر كمان يملا خانة تنفيذ فيها',
      recruitIds.has(assistant.id),
      recruitIds.has(assistant.id) ? 'ظاهر' : '**مختفي** — الفجوة اللي البلاغ بيتكلم عنها',
    );

    // ════ C) بوابة الكتابة — القايمة مش وحدها المشكلة ════
    const writeRes = await h.api(`/technician/orders/${order.id}/recruit-candidates/${assistant.id}`, {
      method: 'POST',
      token: techLead.token,
      body: { role: 'technician' },
    });
    record(
      'بوابة الكتابة بتقبل المساعد في خانة التنفيذ (مش القايمة وحدها)',
      writeRes.status < 400,
      `status=${writeRes.status} ${JSON.stringify(writeRes.body?.error ?? writeRes.body?.message ?? '').slice(0, 120)}`,
    );

    // ════ D) الأجر مايتغيّرش — المساعد يفضل مساعد ماليًا ════
    const [memberRow] = await h.q(
      `SELECT member_type FROM order_team_members WHERE order_id = $1 AND technician_id = $2`,
      [order.id, assistant.id],
    );
    record(
      'لو اتضاف: اتسجّل `member_type=assistant` — الأجر مااتغيّرش',
      memberRow ? memberRow.member_type === 'assistant' : false,
      memberRow ? `member_type=${memberRow.member_type}` : 'مااتضافش أصلاً',
    );

    // ════ E) خانة التنفيذ اتملت فعلاً؟ (محاسبة الطاقم) ════
    const compRes = await h.api(`/technician/orders/${order.id}`, { token: techLead.token });
    const crew = (compRes.body?.data ?? compRes.body)?.crew_status ?? null;
    // العقد بيرجّع camelCase هنا؛ بنقرا الشكلين عشان الفحص ما يفشلش لسبب صياغة.
    const missingTechnicians = crew ? (crew.missingTechnicians ?? crew.missing_technicians) : null;
    const crewComplete = crew ? (crew.crewComplete ?? crew.crew_complete) : null;
    record(
      'خانة التنفيذ اتعدّت مملوءة — الطاقم بقى كامل',
      crewComplete === true && missingTechnicians === 0,
      crew ? JSON.stringify(crew) : `مفيش crew_status (status=${compRes.status})`,
    );

    // ════ F) خدمة بتشترط قائد فني — المساعد ممنوع يقود وممنوع يملا خانة تنفيذ ════
    await h.q(`UPDATE services SET requires_technician_lead = true WHERE id = $1`, [h.catalog.service.id]);
    const strictList = await h.api(
      `/services/${h.catalog.service.id}/technicians?address_id=${customer.addressId}` +
        `&scheduled_at=${encodeURIComponent(scheduledAt.toISOString())}`,
      { token: customer.token },
    );
    const strictIds = new Set(((strictList.body?.data ?? strictList.body) || []).map((r) => r.id));
    record(
      'خدمة `requires_technician_lead`: المساعد مابيظهرش كقائد',
      !strictIds.has(assistant.id) && strictIds.has(techLead.id),
      `مساعد=${strictIds.has(assistant.id)} فني=${strictIds.has(techLead.id)}`,
    );

    await h.deleteOrders(`order_number LIKE $1`, ['CEP-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— الفحوص —');
  let allOk = true;
  for (const [label, ok, detail] of checks) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`);
  }
  console.log(allOk ? '\n✅ الأهلية متسقة بين الحجز والتجنيد.' : '\n❌ فيه تفاوت في الأهلية.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
