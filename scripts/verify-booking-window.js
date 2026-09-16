/**
 * تحقق حي من نافذة اختيار الموعد (docs/08 §151، ADR-0097).
 *
 * بيجرّب ساعات بداية مختلفة بتوقيت القاهرة على نفس الخدمة والعميل، وبيقارن اللي حصل باللي
 * المفروض. **الضابط جزء أصيل**: من غير ساعة جوّه النافذة بتعدّي، «كل الطلبات اترفضت» ممكن
 * يبقى صح لأي سبب تاني خالص.
 *
 *   node scripts/verify-booking-window.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

/** لحظة UTC للساعة دي بتوقيت القاهرة، بعد N يوم من دلوقتي. */
function cairoAt(daysAhead, hour, minute = 0) {
  const day = new Date(Date.now() + daysAhead * 86_400_000);
  const dayString = day.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const pad = (n) => String(n).padStart(2, '0');
  // الإزاحة بتتحسب من التاريخ نفسه عشان التوقيت الصيفي مايزحلقش الحساب.
  const probe = new Date(`${dayString}T12:00:00Z`);
  const offsetMinutes =
    (new Date(probe.toLocaleString('en-US', { timeZone: 'Africa/Cairo' })).getTime() -
      new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()) /
    60_000;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return new Date(`${dayString}T${pad(hour)}:${pad(minute)}:00${offset}`);
}

async function main() {
  const h = new LiveHarness('bw');
  await h.connect();
  const createdOrders = [];
  try {
    await h.seedCatalog({ priceCents: 20_000, durationMinutes: 60 });
    await h.q(`UPDATE services SET allows_emergency=false WHERE id=$1`, [h.catalog.service.id]);
    await h.makeTechnician('t');
    const customer = await h.makeCustomer('c');

    const publicWindow = await h.api('/settings/booking-window');
    const win = publicWindow.body?.data ?? publicWindow.body;
    console.log('النافذة المعلنة:', JSON.stringify(win));

    const cases = [
      { hour: 4, minute: 30, expect: 'reject', label: '٤:٣٠ ص (قبل النافذة)' },
      { hour: 5, minute: 0, expect: 'accept', label: '٥:٠٠ ص (أول النافذة)' },
      { hour: 13, minute: 0, expect: 'accept', label: '١:٠٠ م (وسط النافذة — الضابط)' },
      { hour: 19, minute: 0, expect: 'accept', label: '٧:٠٠ م (آخر النافذة، شاملة)' },
      { hour: 19, minute: 30, expect: 'reject', label: '٧:٣٠ م (بعد النافذة)' },
      { hour: 23, minute: 0, expect: 'reject', label: '١١:٠٠ م (برّه تمامًا)' },
    ];

    let allOk = true;
    let dayOffset = 4;
    for (const testCase of cases) {
      dayOffset += 1;
      const scheduledAt = cairoAt(dayOffset, testCase.hour, testCase.minute);
      const res = await h.api('/orders', {
        method: 'POST',
        token: customer.token,
        body: {
          service_id: h.catalog.service.id,
          address_id: customer.addressId,
          booking_mode: 'individual',
          scheduled_at: scheduledAt.toISOString(),
          problem_description: 'تحقق نافذة الحجز',
        },
      });
      const accepted = res.status < 400;
      if (accepted) createdOrders.push(res.body?.id ?? res.body?.data?.id);
      const ok = accepted === (testCase.expect === 'accept');
      if (!ok) allOk = false;
      const detail = accepted ? 'اتقبل' : `اترفض: ${res.body?.error?.message ?? res.status}`;
      console.log(`${ok ? '✅' : '❌'} ${testCase.label} → ${detail}`);
    }

    // **الاستثناء اللي ١٤ اختبار قايم كشفوه**: اتفاقية «اليوم المجرّد» (T00:00:00.000Z) هي
    // ٣ الفجر بتوقيت القاهرة — برّه النافذة — لكنها **مش اختيار ساعة**، فلازم تعدّي.
    await h.q(`UPDATE services SET requires_start_time_only=false WHERE id=$1`, [h.catalog.service.id]);
    const bareDay = new Date(Date.now() + 12 * 86_400_000);
    bareDay.setUTCHours(0, 0, 0, 0);
    const bareRes = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        booking_mode: 'individual',
        scheduled_at: bareDay.toISOString(),
        problem_description: 'تحقق: اليوم المجرّد',
      },
    });
    const bareOk = bareRes.status < 400;
    if (bareOk) createdOrders.push(bareRes.body?.id ?? bareRes.body?.data?.id);
    if (!bareOk) allOk = false;
    console.log(
      `${bareOk ? '✅' : '❌'} «يوم بس» بلا ساعة (T00:00Z = ٣ الفجر بالقاهرة) → ${
        bareOk ? 'اتقبل — الاستثناء شغّال' : `اترفض: ${bareRes.body?.error?.message ?? bareRes.status}`
      }`,
    );

    console.log(
      allOk
        ? '\n✅ النافذة شغّالة بالحدود المطلوبة، والضابط بيثبت إن الأوقات الجوّه بتعدّي فعلاً.'
        : '\n❌ فيه حالة مش زي المتوقع — شوف فوق.',
    );
  } finally {
    for (const id of createdOrders) if (id) await h.deleteOrders(`id = $1`, [id]);
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
