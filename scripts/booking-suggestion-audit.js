#!/usr/bin/env node
/**
 * تدقيق حي لاقتراح المواعيد (ADR-0088، docs/08 §141).
 *
 * السؤال اللي بيجاوبه: **هل الاقتراح بيعكس الطاقة الحقيقية؟** بنزرع مشهد فيه أيام مزدحمة عمدًا
 * وأيام فاضية، وبنشوف الاقتراح بيختار الفاضي ويسيب المزدحم — ومش بيقترح يوم داخل مهلة الـ٤٨ ساعة.
 *
 * محتاج API شغّال. لو الـthrottle وقفه: THROTTLE_LIMIT=100000 npm run start:dev
 */
const { LiveHarness } = require('./lib/live-harness');

const h = new LiveHarness('bkgsug');
let pass = 0;
const failures = [];
const verbose = process.argv.includes('--verbose');

function assert(group, name, ok, detail = '') {
  if (ok) {
    pass += 1;
    if (verbose) console.log(`  ✓ ${name}`);
  } else {
    failures.push(`[${group}] ${name}${detail ? `: ${detail}` : ''}`);
    if (verbose) console.log(`  ✗ ${name} ${detail}`);
  }
}
function check(group, name, actual, expected) {
  assert(group, name, actual === expected, `طلع ${JSON.stringify(actual)} المفروض ${JSON.stringify(expected)}`);
}

/** يوم بصيغة YYYY-MM-DD بتوقيت مصر بعد N يوم من النهاردة. */
function cairoDayPlus(days) {
  const now = new Date();
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  cairo.setDate(cairo.getDate() + days);
  const y = cairo.getFullYear();
  const m = String(cairo.getMonth() + 1).padStart(2, '0');
  const d = String(cairo.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

(async () => {
  await h.connect();
  if (!(await h.isApiUp())) {
    console.error('الـAPI مش شغّال على :3000 — شغّله الأول.');
    process.exit(2);
  }

  try {
    const catalog = await h.seedCatalog({ priceCents: 20_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('cust');

    // العنوان بيتقري نطاقه من الإحداثيات عبر GeoService، فلازم يقع جوّه نطاق الكتالوج. الزون
    // المزروع بلا boundary، وGeoService في الحالة دي بيرجّع أول نطاق نشط في المدينة — وهو بتاعنا.
    console.log('\n═══ بناء المشهد ═══');
    const technicians = [];
    for (let i = 0; i < 4; i += 1) technicians.push(await h.makeTechnician(`t${i}`));
    console.log(`  ${technicians.length} فنيين مؤهّلين على نفس الخدمة والنطاق`);

    // بنزحم اليوم رقم ٢ و٣ (أول يومين بعد مهلة الـ٤٨ ساعة) بشغل يملا سقف كل الفنيين، عشان
    // الاقتراح يضطر يعدّيهم لليوم رقم ٤.
    const busyDays = [cairoDayPlus(2), cairoDayPlus(3)];
    const freeDay = cairoDayPlus(4);
    for (const day of busyDays) {
      for (const [index, tech] of technicians.entries()) {
        await h.q(
          `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
              technician_id, order_status, booking_mode, scheduled_at, duration_minutes,
              subtotal_cents, total_amount_cents, payment_method, commission_rate_applied)
           VALUES ($1,$2,$3,$4,$5,$6,'accepted','individual',
                   ($7::text || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo', 720,
                   20000, 20000, 'cash', 20)`,
          [
            `BSG-${day.replace(/-/g, '')}-${index}`,
            customer.profileId, catalog.service.id, customer.addressId, catalog.zone.id, tech.id, day,
          ],
        );
      }
    }
    console.log(`  اليومين ${busyDays.join(' و')} متزحمين بالكامل (سقف يومي مليان)`);
    console.log(`  اليوم ${freeDay} فاضي تمامًا`);

    // ═══ ١ — الاقتراح بيحترم مهلة الـ٤٨ ساعة ═══
    console.log('\n═══ ١ — مهلة الحجز محترمة ═══');
    const daysRes = await h.api(
      `/booking-slots/days?service_id=${catalog.service.id}&address_id=${customer.addressId}&duration_minutes=120`,
      { token: customer.token },
    );
    check('أيام', 'المسار عدّى', daysRes.status, 200);
    const suggested = daysRes.body?.data?.days ?? [];
    if (verbose) console.log(`    ${JSON.stringify(suggested)}`);
    assert('أيام', 'رجع اقتراحات فعلاً', suggested.length > 0, `العدد ${suggested.length}`);
    check('أيام', 'عدد الاقتراحات = ٣', suggested.length, 3);
    const tooSoon = [cairoDayPlus(0), cairoDayPlus(1)];
    assert('أيام', '**مفيش يوم داخل مهلة الـ٤٨ ساعة**',
      suggested.every((d) => !tooSoon.includes(d.day)), JSON.stringify(suggested.map((d) => d.day)));

    // ═══ ٢ — الأيام المزدحمة مستبعدة ═══
    console.log('\n═══ ٢ — الزحمة الحقيقية بتستبعد اليوم ═══');
    const suggestedDayList = suggested.map((d) => d.day);
    assert('زحمة', '**اليوم المزدحم مش مقترح**',
      busyDays.every((day) => !suggestedDayList.includes(day)), JSON.stringify(suggestedDayList));
    assert('زحمة', '**اليوم الفاضي مقترح**', suggestedDayList.includes(freeDay), JSON.stringify(suggestedDayList));
    assert('زحمة', 'أول اقتراح معلَّم isEarliest', suggested[0]?.is_earliest === true);
    assert('زحمة', 'كل اقتراح جاي بعدد الفنيين المتاحين',
      suggested.every((d) => typeof d.available_technicians === 'number' && d.available_technicians > 0));

    // ═══ ٣ — الاقتراحات مرتّبة بالأقرب ═══
    console.log('\n═══ ٣ — الأقرب الأول ═══');
    const sortedAsc = [...suggestedDayList].sort();
    assert('ترتيب', '**الأيام مرتّبة تصاعديًا (مش الأعلى عددًا)**',
      JSON.stringify(sortedAsc) === JSON.stringify(suggestedDayList), JSON.stringify(suggestedDayList));

    // ═══ ٤ — الساعات المقترحة ═══
    console.log('\n═══ ٤ — ساعات اليوم المختار ═══');
    const timesRes = await h.api(
      `/booking-slots/times?service_id=${catalog.service.id}&address_id=${customer.addressId}&day=${freeDay}&duration_minutes=120`,
      { token: customer.token },
    );
    check('ساعات', 'المسار عدّى', timesRes.status, 200);
    const times = timesRes.body?.data?.times ?? [];
    if (verbose) console.log(`    ${JSON.stringify(times)}`);
    assert('ساعات', 'رجع ساعات مقترحة', times.length > 0, `العدد ${times.length}`);
    assert('ساعات', 'كل ساعة جاية بعدد الفنيين الفاضيين فيها',
      times.every((t) => typeof t.free_technicians === 'number' && t.free_technicians > 0));
    assert('ساعات', 'الساعات جوّه نافذة اليوم المضبوطة في الإعدادات',
      times.every((t) => Number(t.time.slice(0, 2)) >= 9 && Number(t.time.slice(0, 2)) <= 19),
      JSON.stringify(times.map((t) => t.time)));
    assert('ساعات', 'مرتّبة بالساعة للعرض',
      JSON.stringify(times.map((t) => t.time)) === JSON.stringify([...times.map((t) => t.time)].sort()));

    // ═══ ٥ — ساعة مزدحمة بتختفي من الاقتراح ═══
    console.log('\n═══ ٥ — الساعة المحجوزة بتتشال ═══');
    const targetHour = times[0]?.time ?? '09:00';
    for (const [index, tech] of technicians.entries()) {
      await h.q(
        `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
            technician_id, order_status, booking_mode, scheduled_at, duration_minutes,
            subtotal_cents, total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,$6,'accepted','individual',
                 ($7::text || ' ' || $8::text)::timestamp AT TIME ZONE 'Africa/Cairo', 120,
                 20000, 20000, 'cash', 20)`,
        [
          `BSH-${targetHour.replace(':', '')}-${index}`,
          customer.profileId, catalog.service.id, customer.addressId, catalog.zone.id, tech.id, freeDay, targetHour,
        ],
      );
    }
    const timesAfter = await h.api(
      `/booking-slots/times?service_id=${catalog.service.id}&address_id=${customer.addressId}&day=${freeDay}&duration_minutes=120`,
      { token: customer.token },
    );
    const timesAfterList = (timesAfter.body?.data?.times ?? []).map((t) => t.time);
    if (verbose) console.log(`    قبل: ${times.map((t) => t.time).join(',')} → بعد: ${timesAfterList.join(',')}`);
    assert('ساعات', `**الساعة ${targetHour} اتشالت بعد ما اتحجزت لكل الفنيين**`,
      !timesAfterList.includes(targetHour), JSON.stringify(timesAfterList));

    // ═══ ٦-أ — معاينة InstaPay جوّه الطلب (ADR-0089) ═══
    console.log('\n═══ ٦-أ — خانة InstaPay جوّه الطلب ═══');
    const [cashOrder] = await h.q(
      `INSERT INTO orders (order_number, customer_id, service_id, address_id, service_zone_id,
          technician_id, order_status, booking_mode, scheduled_at, duration_minutes,
          subtotal_cents, total_amount_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,$6,'work_completed','individual', now(), 120,
               20000, 20000, 'cash', 20) RETURNING id`,
      [
        `BSP-${Date.now().toString(36)}`,
        customer.profileId, catalog.service.id, customer.addressId, catalog.zone.id, technicians[0].id,
      ],
    );
    const preview = await h.api(`/orders/${cashOrder.id}/instapay-preview`, { token: customer.token });
    check('instapay', 'المعاينة عدّت على طلب كاش', preview.status, 200);
    if (verbose) console.log(`    ${JSON.stringify(preview.body?.data)}`);
    const body = preview.body?.data ?? {};
    assert('instapay', '**المبلغ المستحق جاي مع المعاينة**',
      typeof body.amount_cents === 'number' && body.amount_cents > 0, `طلع ${body.amount_cents}`);
    assert('instapay', 'وقت المراجعة المعتاد والسقف جايين',
      typeof body.confirm_typical_minutes === 'number' && typeof body.confirm_max_minutes === 'number');
    assert('instapay', 'الطلب معلَّم إنه قابل للدفع', body.is_payable === true);
    assert('instapay', 'مفيش تحويل مفتوح لسه', body.has_open_transfer === false);

    // **أهم فحص في البند ده**: المعاينة قراءة بحتة — ممنوع تفتح دفعة تقفل مسار الكاش.
    const [{ count: paymentsAfter }] = await h.q(
      `SELECT COUNT(*)::int AS count FROM payments WHERE order_id = $1`, [cashOrder.id],
    );
    check('instapay', '**المعاينة مافتحتش أي دفعة** (مسار الكاش لسه مفتوح)', paymentsAfter, 0);

    const foreignPreview = await h.api(`/orders/${cashOrder.id}/instapay-preview`, { token: (await h.makeCustomer('thief')).token });
    check('instapay', 'عميل تاني مايقدرش يشوف معاينة طلب مش بتاعه', foreignPreview.status, 404);

    // ═══ ٦ — الصلاحيات وملكية العنوان ═══
    console.log('\n═══ ٦ — ملكية العنوان ═══');
    const other = await h.makeCustomer('other');
    const stolen = await h.api(
      `/booking-slots/days?service_id=${catalog.service.id}&address_id=${customer.addressId}`,
      { token: other.token },
    );
    check('صلاحيات', '**عميل تاني مايقدرش يسأل بعنوان مش بتاعه**', stolen.status, 404);

    const anon = await h.api(`/booking-slots/days?service_id=${catalog.service.id}&address_id=${customer.addressId}`);
    assert('صلاحيات', 'بلا توكن بيترفض', anon.status === 401 || anon.status === 403, `طلع ${anon.status}`);

    console.log('\n═══ النتيجة ═══');
    const total = pass + failures.length;
    console.log(`${pass}/${total} فحص نضيف`);
    if (failures.length) {
      console.log('\n🔴 الفحوص اللي فشلت:');
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    } else {
      console.log('🟢 اقتراح المواعيد بيعكس الطاقة الحقيقية.');
    }
  } finally {
    await h.q(`DELETE FROM orders WHERE order_number LIKE 'BSG-%' OR order_number LIKE 'BSH-%' OR order_number LIKE 'BSP-%'`);
    await h.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
