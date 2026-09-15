'use strict';
/**
 * **بلاغ المالك ٢ (§141)**: «الاقتراح مش ذكي — تخلي العميل يختار اليوم اللي إنت قلت عليه إنه
 * فاضي، ويحط شغلانة كبيرة، فتطلع الناس كلها مش متاحة. ده مش منطقي.»
 *
 * السيناريو اللي بيثبته السكربت — **شغلانة تلات أيام**:
 *   اليوم ١  فاضي للفني.
 *   اليوم ٢  الفني محجوز فيه بطلب تاني.
 *   اليوم ٣  فاضي.
 *   اليوم ٤+ فاضي بالكامل.
 *
 * العميل بيحجز بنطاق مرن من اليوم ١. اليوم ١ **مش صالح فعليًا** لشغلانة تلات أيام لأنها هتصطدم
 * باليوم ٢. الصح إن البحث يعدّيه ويرسي على أول يوم الفترة **كلها** فاضية فيه.
 *
 * قبل الإصلاح: البحث كان بيسأل عن شغلانة يوم واحد افتراضية فيرسي على اليوم ١.
 */
const { LiveHarness } = require('./lib/live-harness');

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const h = new LiveHarness('flexday');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 600 });
    // نطاق أيام مرن + معادلة بتطلّع **٣ أيام** صراحةً. المعادلة هي المصدر الحي الوحيد للمدة
    // بعد migration 0242 (الـcheck constraint بيحصر `pricing_model` في formula/inspection).
    await h.q(`UPDATE services SET allows_date_range_booking = true WHERE id = $1`, [catalog.service.id]);
    await h.q(
      `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
       VALUES ($1,'formula','final_price',$2,1, now(), true)`,
      [
        catalog.service.id,
        JSON.stringify({
          price_cents: { type: 'literal', value: 50000 },
          // **٣٠ ساعة شغل** — والسقف اليومي ١٢ ساعة (720 دقيقة)، فالمدى = ceil(1800/720) = ٣ أيام.
          // الدقايق هي مصدر الحقيقة في `spanDaysExpr` (ADR-0077)، مش `estimated_duration_days`.
          estimated_duration_days: { type: 'literal', value: 3 },
          duration_minutes: { type: 'literal', value: 1800 },
        }),
      ],
    );
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');

    // اليوم ١ = بعد بكرة (بعيد عن حدود «نفس اليوم» والطوارئ)
    const [{ d1 }] = await h.q(
      `SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '3 day' + interval '9 hour')
              AT TIME ZONE 'Africa/Cairo' AS d1`,
    );
    const day1 = new Date(d1);
    const day2 = new Date(day1.getTime() + DAY_MS);

    // ── الفني محجوز في اليوم ٢ بس ────────────────────────────────────────────
    const blocker = await h.makeCustomer('blk');
    await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, technician_id, service_id,
                           address_id, service_zone_id, order_status, payment_status, total_amount_cents,
                           technician_earning_cents, scheduled_at, duration_minutes, payment_method)
       VALUES (20,$1,$2,$3,$4,$5,$6,'accepted','pending',50000,0,$7,600,'cash')`,
      [
        `FLX-${h.runNum}`,
        blocker.profileId,
        tech.id,
        catalog.service.id,
        blocker.addressId,
        catalog.zone.id,
        day2.toISOString(),
      ],
    );

    const cairoDay = (iso) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(iso));

    console.log(`ℹ️  اليوم ١ = ${cairoDay(day1)} (فاضي) — اليوم ٢ = ${cairoDay(day2)} (الفني محجوز)`);

    // ── الحجز بنطاق مرن من اليوم ١ لمدة ٨ أيام ───────────────────────────────
    const rangeEnd = new Date(day1.getTime() + 8 * DAY_MS);
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: catalog.service.id,
        address_id: customer.addressId,
        booking_mode: 'individual',
        scheduled_at: day1.toISOString(),
        scheduled_at_range_end: rangeEnd.toISOString(),
      },
      headers: { 'Idempotency-Key': `flex-${h.runId}` },
    });
    check(
      'الحجز بنطاق مرن بيعدّي',
      created.status === 200 || created.status === 201,
      `رجع ${created.status} — ${JSON.stringify(created.body?.error)}`,
    );
    if (created.status >= 400) throw new Error('الحجز فشل — الباقي مالوش معنى');

    const [order] = await h.q(`SELECT scheduled_at, estimated_duration_days FROM orders WHERE id = $1`, [
      created.body.data.id,
    ]);
    const chosen = cairoDay(order.scheduled_at);
    console.log(`ℹ️  السيستم رسى على: ${chosen} (مدة الشغلانة ${order.estimated_duration_days} يوم)`);

    check(
      'الشغلانة اتسجّلت تلات أيام فعلاً',
      Number(order.estimated_duration_days) === 3,
      String(order.estimated_duration_days),
    );

    // **الفحص الجوهري**: ما يرسيش على اليوم ١، لأن فترة التلات أيام بتاعته بتصطدم باليوم ٢.
    check(
      'ما رساش على اليوم ١ (اللي فترته بتصطدم باليوم المحجوز) — ده بلاغ المالك بالحرف',
      chosen !== cairoDay(day1),
      `رسى على ${chosen} وهو اليوم ١ — الفترة هتصطدم باليوم ٢`,
    );

    // ولا على اليوم ٢ نفسه (المحجوز)
    check('ولا على اليوم ٢ المحجوز نفسه', chosen !== cairoDay(day2), `رسى على ${chosen}`);

    // ولسه جوّه النطاق المطلوب
    check(
      'ولسه جوّه النطاق اللي العميل طلبه',
      chosen >= cairoDay(day1) && chosen <= cairoDay(rangeEnd),
      `${chosen} برّه [${cairoDay(day1)}, ${cairoDay(rangeEnd)}]`,
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
