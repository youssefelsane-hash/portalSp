'use strict';
/**
 * **بلاغ المالك ٤ (§141)** — «أهم نقطة» بكلامه: «اتأكد إن الفنيين والمساعدين بيكونوا ظاهرين
 * لبعض، إن هما يعرفوا يدعوا بعض أو يدخلوا بعض في الشغلانة معاهم، واتأكد إن كل حاجة ماشية
 * بسلاسة وما فيهاش أي كعبلة».
 *
 * ده بند **تحقّق** مش بند إصلاح — فالسكربت بيمشي المسار الحقيقي من الطرفين:
 *
 *   ١) قائد **فني** يشوف المساعدين ويدعو واحد فيهم.
 *   ٢) نفس القائد يشوف الفنيين ويدعو واحد فيهم.
 *   ٣) قائد **مساعد** (ADR-0055 بيسمح للمساعد يبقى قائد) يشوف الفنيين ويدعو واحد.
 *   ٤) وقائد مساعد يشوف المساعدين ويدعو واحد.
 *
 * وكمان بيثبت الفصل اللي ADR-0050 عمله: قايمة «فني» مافيهاش مساعدين والعكس — عشان «ظاهرين
 * لبعض» ما تتفهمش غلط على إنها خلط القايمتين.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('crewvis');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    // شغلانة طاقم محتاجة فنيين ومساعدين — عشان الخانتين يبقوا مفتوحين
    await h.q(`UPDATE services SET allows_team = true WHERE id = $1`, [catalog.service.id]);
    const customer = await h.makeCustomer('c');

    /** بيعمل فني/مساعد معتمد ومؤهّل للخدمة والمنطقة. */
    const makeWorker = async (label, kind, level = 'professional') => {
      const w = await h.makeTechnician(label);
      await h.q(`UPDATE technician_profiles SET technician_kind = $2, current_level = $3 WHERE id = $1`, [
        w.id,
        kind,
        level,
      ]);
      return w;
    };

    const leaderTech = await makeWorker('lead-t', 'technician', 'team_leader');
    const leaderAsst = await makeWorker('lead-a', 'assistant', 'team_leader');
    const helper1 = await makeWorker('help1', 'assistant', 'professional');
    const helper2 = await makeWorker('help2', 'assistant', 'professional');
    const mate1 = await makeWorker('mate1', 'technician', 'professional');
    const mate2 = await makeWorker('mate2', 'technician', 'professional');

    let orderSeq = 0;
    const makeOrder = async (leaderId) => {
      const [o] = await h.q(
        `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                             address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                             technician_earning_cents, scheduled_at, booking_mode,
                             required_technicians, required_assistants, duration_minutes, payment_method)
         VALUES (20,$1,$2,$3,$4,$5,$6,'accepted','pending',50000,0,
                 ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '2 day' + interval '10 hour')
                   AT TIME ZONE 'Africa/Cairo',
                 'team',3,3,120,'cash')
         RETURNING id`,
        [
          `CVS-${h.runNum}-${(orderSeq += 1)}`,
          customer.profileId,
          leaderId,
          catalog.service.id,
          customer.addressId,
          catalog.zone.id,
        ],
      );
      return o.id;
    };

    /** بيجيب قايمة المرشّحين لدور معيّن ويتأكد إنها مش فاضية ومفيهاش الدور التاني. */
    const listAndAssert = async (label, token, orderId, role, expectedIds, forbiddenIds) => {
      const res = await h.api(`/technician/orders/${orderId}/recruit-candidates?role=${role}`, { token });
      const items = res.body?.data ?? [];
      const ids = new Set(items.map((i) => i.technician_id ?? i.technicianId));
      check(
        `${label}: قايمة «${role}» رجعت 200`,
        res.status === 200,
        `رجع ${res.status} — ${JSON.stringify(res.body?.error?.message)}`,
      );
      check(
        `${label}: و${role === 'assistant' ? 'المساعدين' : 'الفنيين'} ظاهرين فيها`,
        expectedIds.every((id) => ids.has(id)),
        `ظاهر منهم ${expectedIds.filter((id) => ids.has(id)).length}/${expectedIds.length} — ${JSON.stringify([...ids])}`,
      );
      check(
        `${label}: والدور التاني **مش** مخلوط فيها (فصل ADR-0050)`,
        forbiddenIds.every((id) => !ids.has(id)),
        'لقينا الدور التاني في القايمة',
      );
      return items;
    };

    /** بيدعو مرشّح فعليًا ويتأكد إن الدعوة عدّت (إضافة مباشرة أو فرصة). */
    const recruit = async (label, token, orderId, technicianId, role) => {
      const res = await h.api(`/technician/orders/${orderId}/recruit-candidates/${technicianId}`, {
        method: 'POST',
        token,
        body: { role },
      });
      const ok = res.status === 200 || res.status === 201;
      check(
        `${label}: الدعوة الفعلية عدّت (${res.body?.data?.status ?? '—'})`,
        ok,
        `رجع ${res.status} — ${JSON.stringify(res.body?.error?.message)}`,
      );
      return res.body?.data?.status;
    };

    // ── ١+٢) قائد فني: بيشوف ويدعو مساعدين وفنيين ────────────────────────────
    const orderA = await makeOrder(leaderTech.id);
    await listAndAssert('قائد فني', leaderTech.token, orderA, 'assistant', [helper1.id, helper2.id], [mate1.id, mate2.id]);
    await recruit('قائد فني → مساعد', leaderTech.token, orderA, helper1.id, 'assistant');
    await listAndAssert('قائد فني', leaderTech.token, orderA, 'technician', [mate1.id, mate2.id], [helper1.id, helper2.id]);
    await recruit('قائد فني → فني', leaderTech.token, orderA, mate1.id, 'technician');

    // ── ٣+٤) قائد **مساعد** (ADR-0055): نفس القدرة بالظبط ────────────────────
    const orderB = await makeOrder(leaderAsst.id);
    await listAndAssert('قائد مساعد', leaderAsst.token, orderB, 'technician', [mate2.id], [helper1.id, helper2.id]);
    await recruit('قائد مساعد → فني', leaderAsst.token, orderB, mate2.id, 'technician');
    await listAndAssert('قائد مساعد', leaderAsst.token, orderB, 'assistant', [helper2.id], [mate1.id, mate2.id]);
    await recruit('قائد مساعد → مساعد', leaderAsst.token, orderB, helper2.id, 'assistant');

    // ── ٥) قيد الرتبة: مذكور هنا صراحةً عشان يبقى **معروف** مش مفاجأة ─────────
    //
    // ADR-0050 بيمنع القائد إنه يضم حد رتبته أعلى منه. ده قرار قائم (مش بَقّة)، بس معناه إن
    // «ظاهرين لبعض» مش مطلقة: قائد رتبته `new` مش هيشوف فني `premium`. السطر ده بيقيس القيد
    // ده فعليًا عشان أي تغيير فيه بعدين يبان في تدقيق، وعشان المالك يقرر لو عايز يوسّعه.
    const juniorLeader = await makeWorker('lead-jr', 'technician', 'new');
    const seniorMate = await makeWorker('mate-sr', 'technician', 'premium');
    const orderC = await makeOrder(juniorLeader.id);
    const juniorList = await h.api(`/technician/orders/${orderC}/recruit-candidates?role=technician`, {
      token: juniorLeader.token,
    });
    const juniorIds = new Set((juniorList.body?.data ?? []).map((i) => i.technician_id ?? i.technicianId));
    console.log(
      `ℹ️  قيد الرتبة (ADR-0050): قائد رتبته «new» ${
        juniorIds.has(seniorMate.id) ? 'بيشوف' : '**مش** بيشوف'
      } فني رتبته «premium» — ده قرار قائم، مش بَقّة.`,
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
