/**
 * تحقق حي من مؤشر الوصول (docs/08 §153، ADR-0099).
 *
 * > «لو الطلب فوري أو قريب جدًا، المسافة ووقت الوصول المتوقع يبقوا فعليين ومهمين. لو الطلب
 * >  مجدول بعد فترة… بدل ETA لحظي نستخدم متوسط التزام الفني بالمواعيد.»
 *
 * بيزرع فني بتاريخ زيارات حقيقي (بعضها في المعاد وبعضها متأخر) وبيقرا نفس القايمة مرتين:
 * مرة لطلب قريب ومرة لطلب بعيد، وبيتأكد إن المؤشر بيتبدّل فعلاً. **الضابط جزء أصيل**: من
 * غير الحالة القريبة، «الالتزام ظهر» ممكن يبقى صح لأي سبب تاني.
 *
 *   node scripts/verify-arrival-metrics.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('arr');
  await h.connect();
  try {
    await h.seedCatalog({ priceCents: 25_000, durationMinutes: 90 });
    await h.q(`UPDATE services SET allows_emergency=true WHERE id=$1`, [h.catalog.service.id]);
    const tech = await h.makeTechnician('t');
    const customer = await h.makeCustomer('c');

    // تاريخ زيارات: ٦ في المعاد و٣ متأخرين ٣٠ دقيقة، وكلهم بمدة انتقال ٢٠ دقيقة في نفس النطاق.
    for (let i = 0; i < 9; i += 1) {
      const scheduledAt = new Date(Date.now() - (i + 2) * 86_400_000);
      scheduledAt.setUTCHours(9, 0, 0, 0);
      const late = i >= 6;
      const arrivedAt = new Date(scheduledAt.getTime() + (late ? 30 : 5) * 60_000);
      const departedAt = new Date(arrivedAt.getTime() - 20 * 60_000);
      await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           technician_departed_at, technician_arrived_at,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ((SELECT id FROM customer_profiles WHERE user_id=$1),$2,$3,$4,$5,
           'completed','individual',$6,90,$7,$8,$9,25000,'cash',20.00)`,
        [
          customer.userId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `ARR-${h.nextTag()}`,
          scheduledAt.toISOString(),
          tech.id,
          departedAt.toISOString(),
          arrivedAt.toISOString(),
        ],
      );
    }

    const read = async (scheduledAt) => {
      const query =
        `address_id=${customer.addressId}` +
        (scheduledAt ? `&scheduled_at=${encodeURIComponent(scheduledAt)}` : '');
      const res = await h.api(`/services/${h.catalog.service.id}/technicians?${query}`, {
        token: customer.token,
      });
      const items = res.body?.data ?? res.body ?? [];
      const row = Array.isArray(items) ? items.find((item) => item.id === tech.id) : null;
      return row
        ? {
            mode: row.arrival_metric_mode,
            expected: row.expected_arrival_minutes,
            punctuality: row.punctuality,
            distanceKm: row.distance_km,
            serviceCompleted: row.service_completed_count,
            totalCompleted: row.total_completed_count,
            levelLabel: row.technician_level_label_ar,
          }
        : { error: `الفني مش في القايمة (status ${res.status})` };
    };

    const soon = new Date(Date.now() + 6 * 3_600_000);
    soon.setUTCHours(9, 0, 0, 0);
    const far = new Date(Date.now() + 10 * 86_400_000);
    far.setUTCHours(9, 0, 0, 0);

    const nearResult = await read(soon.toISOString());
    const farResult = await read(far.toISOString());

    console.log('\n— طلب قريب (٦ ساعات) — الضابط —');
    console.log(JSON.stringify(nearResult, null, 2));
    console.log('\n— طلب بعيد (١٠ أيام) —');
    console.log(JSON.stringify(farResult, null, 2));

    const checks = [
      ['القريب مؤشره مدة وصول', nearResult.mode === 'expected_arrival'],
      ['القريب فيه مدة وصول حقيقية (مش صفر)', (nearResult.expected ?? 0) > 0],
      ['القريب مافيهوش التزام', nearResult.punctuality === null],
      ['البعيد مؤشره الالتزام', farResult.mode === 'punctuality'],
      ['البعيد مافيهوش مدة وصول', farResult.expected === null],
      ['البعيد فيه نسبة التزام', (farResult.punctuality?.on_time_rate ?? null) !== null],
      ['نسبة الالتزام ٦٧٪ (٦ من ٩)', farResult.punctuality?.on_time_rate === 67],
      ['حجم العيّنة ٩', farResult.punctuality?.sample_count === 9],
      ['متوسط التأخير ٣٠ د', farResult.punctuality?.average_late_minutes === 30],
      ['المسافة ظاهرة في الحالتين', nearResult.distanceKm !== null && farResult.distanceKm !== null],
      ['اسم المستوى جاي من الأدمن', typeof farResult.levelLabel === 'string' && farResult.levelLabel.length > 0],
      ['عدّاد الخدمة والإجمالي حقلين منفصلين', farResult.serviceCompleted !== undefined && farResult.totalCompleted !== undefined],
    ];

    console.log('\n— الفحوص —');
    let allOk = true;
    for (const [label, ok] of checks) {
      if (!ok) allOk = false;
      console.log(`${ok ? '✅' : '❌'} ${label}`);
    }
    console.log(allOk ? '\n✅ المؤشر بيتبدّل بأفق الطلب، والأرقام كلها حقيقية.' : '\n❌ فيه فحص فشل.');

    await h.deleteOrders(`order_number LIKE $1`, ['ARR-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
