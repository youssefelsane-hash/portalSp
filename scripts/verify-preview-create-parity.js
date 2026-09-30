/**
 * **تحقق حي: السعر اللي العميل شافه قبل التأكيد = السعر اللي اتسجّل** (docs/08 §188).
 *
 * > مراجعة معمارية 2026-09-30: «عندك مصدرين للحقيقة في أهم جزء في البيع: Preview وCreate، وبدأوا
 * > ينحرفوا فعلًا… العميل يطلب flexible range يبدأ النهارده، الـpreview يحسبه same-day/emergency،
 * > لكن وقت Create النظام يلاقي أول availability بكرة ويعمل التسعير على التاريخ المحلول.»
 *
 * بيبني الحالة دي بالظبط على بيانات حقيقية وبينادي **الـendpoints الاتنين من الـHTTP** زي
 * العميل بالظبط — مش الدوال من جوّه — فبيقيس كمان إن الـDTO بيقبل الحقول الجديدة.
 *
 *   node scripts/verify-preview-create-parity.js
 *
 * محتاج الـAPI شغّال بـ`THROTTLE_LIMIT=100000` (بيعمل كذا طلب ورا بعض).
 */
'use strict';

const { randomUUID } = require('node:crypto');
const { LiveHarness } = require('./lib/live-harness');

/** اليوم بتوقيت القاهرة (YYYY-MM-DD) + إزاحة أيام — نفس اتفاقية «اليوم المجرّد» في الواجهات. */
function cairoDay(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
}

async function main() {
  const h = new LiveHarness('ppc');
  await h.connect();
  const results = [];
  const record = (label, ok, detail) => results.push({ label, ok, detail });

  try {
    await h.seedCatalog({ priceCents: 40_000, durationMinutes: 120 });
    const serviceId = h.catalog.service.id;
    await h.q(`UPDATE services SET allows_date_range_booking = true WHERE id = $1`, [serviceId]);
    const tech = await h.makeTechnician('t');
    const customer = await h.makeCustomer('c');

    const [{ value: capacityRaw } = { value: 720 }] = await h.q(
      `SELECT value FROM settings WHERE key = 'matching.daily_capacity_minutes'`,
    );
    const capacity = Number(capacityRaw) || 720;

    // الفني يومه النهارده **مليان** (شغلانة بطول السعة اليومية كلها) وبكرة فاضي.
    const today = cairoDay(0);
    const tomorrow = cairoDay(1);
    await h.q(
      `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
         order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
         total_amount_cents, payment_method, commission_rate_applied)
       VALUES ($1,$2,$3,$4,$5,'accepted','individual',$6,$7,$8,40000,'cash',20.00)`,
      [customer.profileId, serviceId, customer.addressId, h.catalog.zone.id, `PPC-${h.nextTag()}`,
       `${today}T06:00:00.000Z`, capacity, tech.id],
    );

    const body = {
      service_id: serviceId,
      address_id: customer.addressId,
      scheduled_at: `${today}T00:00:00.000Z`,
      scheduled_at_range_end: `${tomorrow}T00:00:00.000Z`,
    };

    // ── (١) النطاق المرن «من النهارده لبكرة» والنهارده مليان ──
    const preview = await h.api('/orders/preview', { method: 'POST', token: customer.token, body });
    const p = preview.body?.data ?? preview.body;
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body,
      headers: { 'Idempotency-Key': randomUUID() },
    });
    const o = created.body?.data ?? created.body;

    if (preview.status !== 201 && preview.status !== 200) {
      record('المعاينة بتقبل النطاق المرن', false, `HTTP ${preview.status}: ${JSON.stringify(p).slice(0, 200)}`);
    } else if (created.status !== 201 && created.status !== 200) {
      record('الإنشاء اتعمل', false, `HTTP ${created.status}: ${JSON.stringify(o).slice(0, 200)}`);
    } else {
      const resolvedDay = String(o.scheduled_at).slice(0, 10);
      record(
        'الإنشاء حلّ النطاق لبكرة (النهارده مليان)',
        resolvedDay === tomorrow,
        `اليوم المسجّل ${resolvedDay} (المتوقع ${tomorrow})`,
      );
      record(
        'رسوم الطوارئ: المعاينة = المسجّل',
        Number(p.emergency_surcharge_cents) === Number(o.surge_amount_cents),
        `معاينة ${p.emergency_surcharge_cents} · مسجّل ${o.surge_amount_cents}`,
      );
      record(
        'الإجمالي: المعاينة = المسجّل',
        Number(p.total_amount_cents) === Number(o.total_amount_cents),
        `معاينة ${p.total_amount_cents} · مسجّل ${o.total_amount_cents}`,
      );
    }

    // ── (٢) نافذة المواعيد: ساعة بره الفترة لازم تترفض في المعاينة **قبل** التأكيد ──
    await h.q(`UPDATE services SET requires_start_time_only = true WHERE id = $1`, [serviceId]);
    const lateBody = {
      service_id: serviceId,
      address_id: customer.addressId,
      // ١١:٣٠ مساءً بتوقيت القاهرة (UTC+3 صيفًا) — بره نافذة ٥ص–٧م الافتراضية.
      scheduled_at: `${cairoDay(3)}T20:30:00.000Z`,
    };
    const latePreview = await h.api('/orders/preview', { method: 'POST', token: customer.token, body: lateBody });
    const lateCreate = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: lateBody,
      headers: { 'Idempotency-Key': randomUUID() },
    });
    const msg = (r) => (r.body?.error?.message ?? r.body?.message ?? '').toString();
    record(
      'ساعة بره النافذة: المعاينة بترفض زي الإنشاء بالظبط',
      latePreview.status === 400 && lateCreate.status === 400 && msg(latePreview) === msg(lateCreate),
      `معاينة ${latePreview.status} «${msg(latePreview)}» · إنشاء ${lateCreate.status} «${msg(lateCreate)}»`,
    );

    // الطلب اللي اتعمل بيدخل التوزيع فورًا، والموزّع ممكن يكتب صف عرض **وإحنا بنمسح** — فالمسح
    // بيتعاد مرة بعد ما الموزّع يهدى بدل ما يوقّع التقرير كله.
    const cleanup = () => h.deleteOrders(`order_number LIKE $1 OR customer_id = $2`, ['PPC-%', customer.profileId]);
    await cleanup().catch(async () => {
      await new Promise((r) => setTimeout(r, 2000));
      await cleanup();
    });
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— المعاينة مقابل الإنشاء —\n');
  let allOk = true;
  for (const { label, ok, detail } of results) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}\n     ${detail}\n`);
  }
  console.log(allOk ? '✅ اللي العميل شافه قبل التأكيد هو اللي اتسجّل.' : '❌ فيه فرق بين المعاينة والإنشاء.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
