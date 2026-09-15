'use strict';
/**
 * **بنود المالك ٣ و٨ و٩ (§141)** — نموذج واحد: مين المسموح له يشتغل على الطلب، ومين بيقرّر.
 *
 *  ٩) الطلب **الخاص** بفني في شركة بيتعامل كأنه مش في شركة أصلاً؛ طلب **الشركة** بس هو اللي
 *     عليه قواعدها. (`orders.assigned_company_id` هو الفاصل — موجود ومطبّق من قبل، بنتحقق منه.)
 *  ٨) الشركة المقفولة (`allows_external_recruitment = false`) بتجنّد من طاقمها بس؛ والمفتوحة
 *     من مجمع المنصة كله.
 *  ٣) الخدمة اللي `requires_technician_lead = true` ماتروحش لمساعد كقائد — **في المسار العام
 *     وجوّه الشركة بنفس الحرف**.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('coRules');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    await h.q(`UPDATE services SET allows_team = true WHERE id = $1`, [catalog.service.id]);
    const customer = await h.makeCustomer('c');

    const makeWorker = async (label, kind, level = 'professional') => {
      const w = await h.makeTechnician(label);
      await h.q(`UPDATE technician_profiles SET technician_kind = $2, current_level = $3 WHERE id = $1`, [
        w.id,
        kind,
        level,
      ]);
      return w;
    };

    // ── الشركة وطاقمها ───────────────────────────────────────────────────────
    const owner = await makeWorker('owner', 'technician', 'team_leader');
    const [company] = await h.q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active, allows_external_recruitment)
       VALUES ($1,$2,true,false) RETURNING id`,
      [owner.userId, `شركة تدقيق ${h.runNum}`],
    );
    const insider = await makeWorker('inside', 'technician', 'professional');
    await h.q(`UPDATE technician_profiles SET company_id = $2 WHERE id IN ($1,$3)`, [
      owner.id,
      company.id,
      insider.id,
    ]);
    const outsider = await makeWorker('outside', 'technician', 'professional');

    let orderSeq = 0;
    const makeOrder = async (leaderId, assignedCompanyId) => {
      const [o] = await h.q(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                             address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                             technician_earning_cents, scheduled_at, booking_mode,
                             required_technicians, required_assistants, duration_minutes, payment_method,
                             assigned_company_id, requested_technician_company_id)
         VALUES (20,$1,$2,$3,$4,$5,$6,'accepted','pending',50000,0,
                 ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '2 day' + interval '10 hour')
                   AT TIME ZONE 'Africa/Cairo',
                 'team',3,3,120,'cash',$7,$7)
         RETURNING id`,
        [
          `CRL-${h.runNum}-${(orderSeq += 1)}`,
          customer.profileId,
          leaderId,
          catalog.service.id,
          customer.addressId,
          catalog.zone.id,
          assignedCompanyId,
        ],
      );
      return o.id;
    };

    const candidateIds = async (token, orderId, role = 'technician') => {
      const res = await h.api(`/technician/orders/${orderId}/recruit-candidates?role=${role}`, { token });
      return {
        status: res.status,
        ids: new Set((res.body?.data ?? []).map((i) => i.technician_id ?? i.technicianId)),
        error: res.body?.error?.message,
      };
    };

    // ── بند ٨ — الشركة **مقفولة** ───────────────────────────────────────────
    const companyOrder = await makeOrder(owner.id, company.id);
    const closed = await candidateIds(owner.token, companyOrder);
    check('طلب الشركة: القايمة رجعت 200', closed.status === 200, `${closed.status} — ${closed.error}`);
    check(
      'الشركة المقفولة: عضو الشركة ظاهر',
      closed.ids.has(insider.id),
      JSON.stringify([...closed.ids]),
    );
    check(
      '**والفني اللي برّه الشركة مش ظاهر** (ده بند ٨ بالحرف)',
      !closed.ids.has(outsider.id),
      'الفني الخارجي ظهر رغم إن الشركة مقفولة',
    );

    // ── بند ٨ — الأدمن بيفتحها ──────────────────────────────────────────────
    const admin = await h.makeAdmin();
    const patch = await h.api(`/admin/technician-companies/${company.id}/recruitment-policy`, {
      method: 'PATCH',
      token: admin.token,
      body: { allows_external_recruitment: true, note: 'تدقيق حي' },
    });
    check('الأدمن يقدر يفتح سياسة التجنيد', patch.status === 200, `${patch.status} — ${JSON.stringify(patch.body?.error)}`);
    check(
      'والرد بيعكس السياسة الجديدة',
      patch.body?.data?.allows_external_recruitment === true,
      JSON.stringify(patch.body?.data),
    );

    const opened = await candidateIds(owner.token, companyOrder);
    check(
      'بعد الفتح: الفني الخارجي بقى ظاهر',
      opened.ids.has(outsider.id),
      JSON.stringify([...opened.ids]),
    );

    // ── بند ٩ — الطلب **الخاص** مالوش علاقة بقواعد الشركة ────────────────────
    await h.api(`/admin/technician-companies/${company.id}/recruitment-policy`, {
      method: 'PATCH',
      token: admin.token,
      body: { allows_external_recruitment: false },
    });
    const personalOrder = await makeOrder(owner.id, null);
    const personal = await candidateIds(owner.token, personalOrder);
    check(
      'الطلب الخاص (assigned_company_id = NULL): الفني الخارجي ظاهر رغم إن الشركة مقفولة',
      personal.ids.has(outsider.id),
      'قواعد الشركة اتطبّقت على طلب مش بتاعها — ده بند ٩ بالحرف',
    );

    // ── بند ٣ — اشتراط قائد فني ─────────────────────────────────────────────
    const helper = await makeWorker('helper', 'assistant', 'professional');
    const listBefore = await h.api(
      `/services/${catalog.service.id}/technicians?address_id=${customer.addressId}`,
      { token: customer.token },
    );
    // الحقل اسمه `id` في الرد (مش `technician_id`) — والشركات بتيجي في نفس القايمة بـ`is_company`.
    const beforeIds = new Set((listBefore.body?.data ?? []).map((i) => i.id));
    check(
      'قبل الاشتراط: المساعد ظاهر كمنفّذ محتمل (قاعدة ADR-0055)',
      beforeIds.has(helper.id),
      JSON.stringify([...beforeIds].slice(0, 6)),
    );

    await h.q(`UPDATE services SET requires_technician_lead = true WHERE id = $1`, [catalog.service.id]);
    const listAfter = await h.api(
      `/services/${catalog.service.id}/technicians?address_id=${customer.addressId}`,
      { token: customer.token },
    );
    const afterIds = new Set((listAfter.body?.data ?? []).map((i) => i.id));
    check(
      '**بعد الاشتراط: المساعد اختفى** (ده بند ٣ بالحرف)',
      !afterIds.has(helper.id),
      'المساعد لسه ظاهر كقائد محتمل رغم الاشتراط',
    );
    check(
      'والفني الكامل فضل ظاهر — الاشتراط ما قفلش الخدمة على الكل',
      afterIds.has(outsider.id) || afterIds.has(insider.id),
      JSON.stringify([...afterIds].slice(0, 6)),
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
