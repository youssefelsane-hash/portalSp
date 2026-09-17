/**
 * **تحقق حي: النطاق مفصول عن الترتيب** (بلاغ مالك 2026-09-17، docs/08 §157).
 *
 * > «لو دوست على الطلبات اللي موعد تنفيذها قرب، بيجيبلي أصلًا طلبات مكتملة وتنفيذها عدى من
 * >  أسبوعين تلاتة من سنة… بيجيبلي أول طلب في السيستم.»
 *
 * بيبني بالظبط الحالة دي: طلب **مكتمل** موعده من سنة، وطلب **حالي** موعده بكرة. وبعدين بيسأل
 * بـ`sort=soonest` في كل نطاق ويشوف مين بيطلع الأول.
 *
 *   node scripts/verify-orders-scope.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('osc');
  await h.connect();
  const checks = [];
  const record = (label, ok, detail) => checks.push([label, ok, detail]);

  try {
    await h.seedCatalog({ priceCents: 20_000, durationMinutes: 180 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeAdmin();

    /**
     * **`placed_at` مستقل عن `scheduled_at` عن قصد** — هما السؤالين اللي `date_field` بيفرّق
     * بينهم. لو الاتنين نفس القيمة، الفحص بيعدّي وهو مش بيقيس حاجة.
     */
    const mkOrder = async ({ tag, status, scheduledOffsetDays, placedOffsetDays = 0, technicianId, completedOffsetDays }) => {
      const at = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
      const [o] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           work_completed_at, placed_at,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,$6,'individual',$7,180,$8,$9,$10,20000,'cash',20.00)
         RETURNING id, order_number`,
        [
          customer.profileId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `OSC-${tag}-${h.nextTag()}`,
          status,
          at(scheduledOffsetDays),
          technicianId ?? null,
          completedOffsetDays === undefined ? null : at(completedOffsetDays),
          at(placedOffsetDays),
        ],
      );
      return o;
    };

    // الطلب اللي كان بيسمّم القايمة: **مكتمل**، وموعده من سنة (فأقدم موعد ⇒ أول واحد في soonest).
    const oldCompleted = await mkOrder({
      tag: 'OLD', status: 'completed', scheduledOffsetDays: -365, placedOffsetDays: -366,
      technicianId: tech.id, completedOffsetDays: -364,
    });
    // الطلب اللي الأدمن **عايز** يشوفه: حالي، موعده بكرة.
    // اتطلب **النهارده** وموعده بكرة.
    const upcoming = await mkOrder({ tag: 'NEW', status: 'accepted', scheduledOffsetDays: 1, placedOffsetDays: 0, technicianId: tech.id });
    // طلب متأخر: موعده عدّى والطلب لسه مش نهائي.
    // **اتطلب النهارده بس موعده كان امبارح أول** — ده اللي بيفرّق بين الحقلين: بيظهر في
    // «حسب تاريخ الطلب» للأيام الجاية، ومابيظهرش في «حسب موعد التنفيذ».
    const overdue = await mkOrder({ tag: 'LATE', status: 'searching_technician', scheduledOffsetDays: -2, placedOffsetDays: 0 });

    const read = async (qs) => {
      const res = await h.api(`/admin/orders?${qs}`, { token: admin.token });
      const body = res.body?.data ?? res.body;
      const items = body?.items ?? body ?? [];
      return {
        status: res.status,
        numbers: (Array.isArray(items) ? items : []).map((o) => o.order_number),
      };
    };
    const onlyOurs = (numbers) => numbers.filter((n) => n.startsWith('OSC-'));

    // ════ الضابط: السلوك القديم — soonest بلا نطاق بيطلّع المكتمل الأول ════
    const allSoonest = await read('scope=all&sort=soonest&per_page=100');
    const allOurs = onlyOurs(allSoonest.numbers);
    record(
      'الضابط: في «كل الطلبات» + الأقرب تنفيذًا، المكتمل من سنة بيطلع قبل طلب بكرة',
      allOurs.indexOf(oldCompleted.order_number) < allOurs.indexOf(upcoming.order_number),
      `الترتيب=${allOurs.join(' , ')}`,
    );

    // ════ الإصلاح: نفس الترتيب جوّه «الحالية» — المكتمل مابيدخلش خالص ════
    const currentSoonest = await read('scope=current&sort=soonest&per_page=100');
    const currentOurs = onlyOurs(currentSoonest.numbers);
    record(
      '**«الحالية» مافيهاش المكتمل** — ولا حتى بالترتيب الأقرب تنفيذًا',
      !currentOurs.includes(oldCompleted.order_number),
      `الترتيب=${currentOurs.join(' , ')}`,
    );
    record(
      'وطلب بكرة موجود فيها',
      currentOurs.includes(upcoming.order_number),
      `عدد=${currentOurs.length}`,
    );

    // ════ «المكتملة» = سجل منفصل ════
    const completedScope = await read('scope=completed&per_page=100');
    const completedOurs = onlyOurs(completedScope.numbers);
    record(
      '«المكتملة» فيها المكتمل ومافيهاش الحالي',
      completedOurs.includes(oldCompleted.order_number) && !completedOurs.includes(upcoming.order_number),
      `الترتيب=${completedOurs.join(' , ')}`,
    );

    // ════ «المتأخرة» مشتقّة: الموعد عدّى + مش نهائي ════
    const overdueBucket = await read('scope=current&bucket=overdue&per_page=100');
    const overdueOurs = onlyOurs(overdueBucket.numbers);
    record(
      '«المتأخرة» فيها اللي موعده عدّى ولسه مش نهائي',
      overdueOurs.includes(overdue.order_number),
      `الترتيب=${overdueOurs.join(' , ')}`,
    );
    record(
      '«المتأخرة» **مافيهاش** المكتمل اللي موعده عدّى كمان — الحالة شرط أصيل',
      !overdueOurs.includes(oldCompleted.order_number),
      `عدد=${overdueOurs.length}`,
    );

    // ════ «غير المعيّنة» ════
    const unassigned = onlyOurs((await read('scope=current&bucket=unassigned&per_page=100')).numbers);
    record(
      '«غير المعيّنة» فيها اللي مالوش فني وبس',
      unassigned.includes(overdue.order_number) && !unassigned.includes(upcoming.order_number),
      `الترتيب=${unassigned.join(' , ')}`,
    );

    // ════ `date_field` — نفس النطاق الزمني بيدّي إجابتين مختلفتين عن قصد ════
    const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
    const byScheduled = onlyOurs((await read(`scope=all&date_field=scheduled_at&from=${iso(0)}&to=${iso(3)}&per_page=100`)).numbers);
    const byPlaced = onlyOurs((await read(`scope=all&date_field=placed_at&from=${iso(0)}&to=${iso(3)}&per_page=100`)).numbers);
    record(
      '«حسب موعد التنفيذ» في الأيام الجاية بيلاقي طلب بكرة',
      byScheduled.includes(upcoming.order_number),
      `الترتيب=${byScheduled.join(' , ')}`,
    );
    record(
      'ونفس النطاق «حسب تاريخ الطلب» بيدّي إجابة **مختلفة** — السؤالين مش واحد',
      byScheduled.join() !== byPlaced.join(),
      `تنفيذ=[${byScheduled.join(' , ')}] طلب=[${byPlaced.join(' , ')}]`,
    );

    // ════ الملخّص بيطابق القايمة ════
    const sumRes = await h.api('/admin/orders/summary?scope=current&per_page=100', { token: admin.token });
    const sum = sumRes.body?.data ?? sumRes.body;
    const currentAll = await read('scope=current&per_page=100');
    record(
      'الملخّص بيقرا نفس فلاتر القايمة (إجمالي مطابق)',
      sum?.total === (currentAll.numbers?.length ?? -1),
      `ملخّص=${sum?.total} قايمة=${currentAll.numbers?.length}`,
    );

    // ════ التقويم بيرجّع عدّ لكل يوم ════
    const calRes = await h.api('/admin/orders/calendar?scope=all', { token: admin.token });
    const cal = (calRes.body?.data ?? calRes.body)?.days ?? [];
    record(
      'التقويم بيرجّع عدّ لكل يوم (aggregate من السيرفر)',
      calRes.status === 200 && Array.isArray(cal) && cal.length > 0 && cal.every((d) => typeof d.total === 'number'),
      `status=${calRes.status} أيام=${cal.length}`,
    );

    await h.deleteOrders(`order_number LIKE $1`, ['OSC-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— الفحوص —');
  let allOk = true;
  for (const [label, ok, detail] of checks) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `\n     ${detail}` : ''}`);
  }
  console.log(allOk ? '\n✅ النطاق مفصول عن الترتيب، والتاريخ له حقل مقصود.' : '\n❌ فيه فحص فشل.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
