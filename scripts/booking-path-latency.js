/**
 * **قياس زمن مسار الحجز** (طلب مالك 2026-09-16، docs/08 §152).
 *
 * > «مهم نتأكد إن مفيش جزء صغير في الـbooking أو availability أو schedule lookup يبقى أبطأ من
 * >  باقي السيستم ويبدأ يسبب lag تحت الضغط.»
 *
 * بيقيس كل نداء في الرحلة على حِمل بيانات حقيقي (فنيين + شغل موجود)، وبيطلّع p50/p95 لكل
 * نقطة عشان نعرف **أضعف نقطة** بالاسم مش بالتخمين.
 *
 *   node scripts/booking-path-latency.js [--technicians 40] [--rounds 12]
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : Number(args[index + 1]);
};
const TECHNICIANS = argValue('--technicians', 40);
const ROUNDS = argValue('--rounds', 12);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function measure(label, run, rounds) {
  const samples = [];
  let failures = 0;
  for (let i = 0; i < rounds; i += 1) {
    const startedAt = process.hrtime.bigint();
    try {
      const res = await run(i);
      if (res && res.status >= 400) failures += 1;
    } catch {
      failures += 1;
    }
    samples.push(Number(process.hrtime.bigint() - startedAt) / 1e6);
  }
  return {
    label,
    p50: Math.round(percentile(samples, 50)),
    p95: Math.round(percentile(samples, 95)),
    max: Math.round(Math.max(...samples)),
    failures,
  };
}

async function main() {
  const h = new LiveHarness('lat');
  await h.connect();
  try {
    await h.seedCatalog({ priceCents: 25_000, durationMinutes: 90 });
    await h.q(`UPDATE services SET allows_emergency=false WHERE id=$1`, [h.catalog.service.id]);

    // مجمّع فنيين حقيقي — الاستعلامات دي كلها بتتقاس بعدد المؤهّلين، فالقياس على فني واحد
    // مالوش أي معنى.
    const technicians = [];
    for (let i = 0; i < TECHNICIANS; i += 1) technicians.push(await h.makeTechnician(`t${i}`));
    const customer = await h.makeCustomer('c');

    // وحِمل شغل موجود: نص المجمّع عليه طلب في الأفق، فحساب الطاقة يشتغل على بيانات مش فاضية.
    const loadDay = new Date(Date.now() + 3 * 86_400_000);
    loadDay.setUTCHours(9, 0, 0, 0);
    for (let i = 0; i < Math.floor(TECHNICIANS / 2); i += 1) {
      await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ((SELECT id FROM customer_profiles WHERE user_id=$1),$2,$3,$4,$5,
           'accepted','individual',$6,240,$7,25000,'cash',20.00)`,
        [
          customer.userId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `LAT-${h.nextTag()}`,
          new Date(loadDay.getTime() + (i % 5) * 86_400_000).toISOString(),
          technicians[i].id,
        ],
      );
    }

    const day = new Date(Date.now() + 6 * 86_400_000);
    day.setUTCHours(9, 0, 0, 0);
    const dayString = day.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const qs = `service_id=${h.catalog.service.id}&address_id=${customer.addressId}`;

    const results = [];
    // الترتيب هنا هو ترتيب الرحلة الحقيقية بالظبط.
    results.push(await measure('GET /settings/booking-window', () => h.api('/settings/booking-window'), ROUNDS));
    results.push(
      await measure(
        'GET /booking-slots/days (اقتراح الأيام)',
        () => h.api(`/booking-slots/days?${qs}&duration_minutes=90`, { token: customer.token }),
        ROUNDS,
      ),
    );
    results.push(
      await measure(
        'GET /booking-slots/times (اقتراح الساعات)',
        () => h.api(`/booking-slots/times?${qs}&day=${dayString}&duration_minutes=90`, { token: customer.token }),
        ROUNDS,
      ),
    );
    results.push(
      await measure(
        'GET /services/:id/technicians (قايمة الاختيار)',
        () =>
          h.api(
            `/services/${h.catalog.service.id}/technicians?address_id=${customer.addressId}` +
              `&scheduled_at=${encodeURIComponent(day.toISOString())}`,
            { token: customer.token },
          ),
        ROUNDS,
      ),
    );
    results.push(
      await measure(
        'POST /orders/preview (تقدير السعر)',
        () =>
          h.api('/orders/preview', {
            method: 'POST',
            token: customer.token,
            body: {
              service_id: h.catalog.service.id,
              address_id: customer.addressId,
              booking_mode: 'individual',
              scheduled_at: day.toISOString(),
            },
          }),
        ROUNDS,
      ),
    );
    results.push(
      await measure(
        'POST /orders/match-preview (تذكرة الفني)',
        () =>
          h.api('/orders/match-preview', {
            method: 'POST',
            token: customer.token,
            body: {
              service_id: h.catalog.service.id,
              address_id: customer.addressId,
              selection_mode: 'auto',
              booking_mode: 'individual',
              scheduled_at: day.toISOString(),
            },
          }),
        ROUNDS,
      ),
    );

    console.log(`\nمجمّع: ${TECHNICIANS} فني، نصهم عليه شغل. ${ROUNDS} نداء لكل نقطة.\n`);
    console.log('النقطة'.padEnd(46), 'p50', ' p95', ' max', 'فشل');
    for (const row of results) {
      console.log(
        row.label.padEnd(46),
        String(row.p50).padStart(4),
        String(row.p95).padStart(4),
        String(row.max).padStart(4),
        String(row.failures).padStart(3),
      );
    }

    const slowest = results.reduce((worst, row) => (row.p95 > worst.p95 ? row : worst));
    console.log(`\nأضعف نقطة بالـp95: ${slowest.label} — ${slowest.p95}ms`);
    const failed = results.filter((row) => row.failures > 0);
    if (failed.length) {
      console.log(`⚠️ نداءات فشلت: ${failed.map((row) => `${row.label} (${row.failures})`).join(', ')}`);
    }

    await h.deleteOrders(`order_number LIKE $1`, ['LAT-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
