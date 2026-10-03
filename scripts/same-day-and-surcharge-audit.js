#!/usr/bin/env node
/**
 * **«نفس اليوم كحجز عادي» و«رسوم الطوارئ» لكل خدمة — من زرار الأدمن لحد الطلب المتسجّل**
 * (ADR-0118 §4/§5، docs/08 §196).
 *
 * طلب المالك: «المكوجي في نفس اليوم مش طوارئ»، و«زرار يخلي الخدمة دي ينطبق عليها الـemergency
 * cost أو لا». السكربت بيمشي المسار الحقيقي كله عبر الـAPI:
 *
 *   أ  الأدمن: العلَم من غير «حجز مجدول» بيترفض برسالة واضحة، ومعاه بيتحفظ ويوصل للعميل.
 *   ب  العميل (خدمة نفس اليوم): الاقتراح مابيستناش ٤٨ ساعة، ونسخة التطبيق القديمة اللي بتبعت
 *      `booking_mode=emergency` للنهارده مابتشوفش رسوم، والقايمة/المعاينة/الطلب كلهم موعد عادي
 *      برسوم صفر — والساعة اللي أقرب من مهلة التجهيز بتترفض.
 *   ج  رسوم الطوارئ مقفولة: الطلب المستعجل بيفضل طوارئ لكن الرسوم صفر.
 *
 *   node scripts/same-day-and-surcharge-audit.js [--keep]
 *
 * محتاج الـAPI شغّال بـ`THROTTLE_LIMIT=100000`. لو الساعة متأخرة ومفيش ساعة متاحة النهارده بعد
 * المهلة، السكربت بيقصّر المهلة مؤقتًا وبيرجّعها في الآخر.
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('sda');
const messageOf = (b) => String(b?.message ?? b?.error?.message ?? '').slice(0, 160);
const original = new Map();
let admin = null;

async function flipSetting(key, value) {
  if (!original.has(key)) {
    const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [key]);
    original.set(key, row?.value);
  }
  await h.setSetting(key, value);
}

const patchService = (body) =>
  h.api(`/admin/services/${h.catalog.service.id}`, { method: 'PATCH', token: admin.token, body });

const estimate = (query) =>
  h.api(`/services/${h.catalog.service.id}/estimate?${query}`, { method: 'POST' });

/** «HH:00» بتوقيت القاهرة النهارده كـISO. */
const cairoTodayAt = (hour, minute = 0) => {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`).toISOString();
};
const cairoMinutesNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
};

async function run() {
  await h.connect();
  console.log(`\n=== نفس اليوم + رسوم الطوارئ — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
  await h.q(
    `UPDATE services SET allows_scheduling = true, allows_emergency = true, requires_start_time_only = true WHERE id = $1`,
    [h.catalog.service.id],
  );
  await h.makeTechnician('t');
  const customer = await h.makeCustomer('c');
  admin = await h.makeAdmin();

  // ── أ) الأدمن ─────────────────────────────────────────────────────────────
  const invalid = await patchService({ same_day_scheduling_enabled: true, allows_scheduling: false });
  h.record(
    'أ الأدمن: «نفس اليوم كحجز عادي» من غير «حجز مجدول» بيترفض برسالة بتقول الناقص',
    invalid.status === 400 && messageOf(invalid.body).includes('حجز مجدول'),
    `HTTP=${invalid.status} ${messageOf(invalid.body)}`,
  );
  const saved = await patchService({ same_day_scheduling_enabled: true, allows_scheduling: true });
  h.record(
    'أ الأدمن: العلَم بيتحفظ ويرجع في رد الأدمن',
    saved.status === 200 && saved.body?.data?.same_day_scheduling_enabled === true,
    `HTTP=${saved.status} ${messageOf(saved.body)}`,
  );
  const publicService = await h.api(`/services/${h.catalog.service.id}`);
  h.record(
    'أ العميل بيقرا العلَم من رد الخدمة العام (التطبيق والويب بيبنوا عليه)',
    publicService.body?.data?.same_day_scheduling_enabled === true && publicService.body?.data?.emergency_surcharge_enabled === true,
    JSON.stringify({
      same_day: publicService.body?.data?.same_day_scheduling_enabled,
      surcharge: publicService.body?.data?.emergency_surcharge_enabled,
    }),
  );

  // ── ب) العميل على خدمة نفس اليوم ─────────────────────────────────────────
  const days = await h.api(
    `/booking-slots/days?service_id=${h.catalog.service.id}&address_id=${customer.addressId}&duration_minutes=60`,
    { token: customer.token },
  );
  h.record(
    'ب الاقتراح مابيستناش ٤٨ ساعة (النهارده لو لسه فيه وقت، وإلا بكرة)',
    days.status === 200 && Number(days.body?.data?.lead_hours) < 24,
    `lead_hours=${days.body?.data?.lead_hours} · أول يوم=${days.body?.data?.days?.[0]?.day ?? '—'}`,
  );
  const legacyEstimate = await estimate(`booking_mode=emergency&zone_id=${h.catalog.zone.id}`);
  h.record(
    'ب نسخة التطبيق القديمة (booking_mode=emergency للنهارده) مابتشوفش رسوم طوارئ',
    legacyEstimate.status === 200 || legacyEstimate.status === 201
      ? Number(legacyEstimate.body?.data?.emergency_surcharge_cents) === 0
      : false,
    `HTTP=${legacyEstimate.status} surcharge=${legacyEstimate.body?.data?.emergency_surcharge_cents}`,
  );

  // أول ساعة كاملة النهارده بعد المهلة وجوّه نافذة الحجز. لو مفيش، بنقصّر المهلة مؤقتًا.
  const [{ value: endRaw }] = await h.q(`SELECT value FROM settings WHERE key = 'booking.selectable_end_hour'`);
  const endHour = Number(endRaw ?? 19);
  const [{ value: leadRaw }] = await h.q(`SELECT value FROM settings WHERE key = 'booking.same_day_min_lead_minutes'`);
  let leadMinutes = Number(leadRaw ?? 90);
  const nowMinutes = cairoMinutesNow();
  let targetHour = Math.ceil((nowMinutes + leadMinutes) / 60);
  if (targetHour > endHour) {
    const room = endHour * 60 - nowMinutes - 5;
    if (room < 10) {
      h.record('ب حجز النهارده كموعد عادي', true, `اتخطّى: الساعة متأخرة (بعد ${endHour}:00 بالقاهرة) — مفيش ساعة نهارده تتحجز أصلاً`);
      return surchargePhase(customer);
    }
    leadMinutes = room;
    await flipSetting('booking.same_day_min_lead_minutes', leadMinutes);
    targetHour = endHour;
    console.log(`(المهلة اتقصّرت مؤقتًا لـ${leadMinutes} دقيقة عشان يفضل فيه ساعة النهارده)`);
  }
  const todayAt = cairoTodayAt(targetHour);

  const list = await h.api(
    `/services/${h.catalog.service.id}/technicians?address_id=${customer.addressId}&scheduled_at=${encodeURIComponent(todayAt)}&include_ineligible=1`,
    { token: customer.token },
  );
  const available = (list.body?.data ?? []).filter((i) => i.availability_status === 'available');
  h.record(
    'ب قايمة المنفّذين للنهارده بتشتغل (اختيار منفّذ موجود — مش بث طوارئ)',
    list.status === 200 && available.length > 0,
    `HTTP=${list.status} متاح=${available.length} ${messageOf(list.body)}`,
  );
  const preview = await h.api('/orders/match-preview', {
    method: 'POST',
    token: customer.token,
    body: { service_id: h.catalog.service.id, address_id: customer.addressId, scheduled_at: todayAt, selection_mode: 'auto' },
  });
  h.record(
    'ب الترشيح التلقائي للنهارده بينجح بسعر من غير رسوم استعجال',
    (preview.status === 200 || preview.status === 201) && Number(preview.body?.data?.pricing?.emergency_surcharge_cents ?? 0) === 0,
    `HTTP=${preview.status} ${messageOf(preview.body)} surcharge=${preview.body?.data?.pricing?.emergency_surcharge_cents}`,
  );
  if (preview.status === 200 || preview.status === 201) {
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `sda-${h.nextTag()}` },
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        scheduled_at: todayAt,
        match_preview_id: preview.body.data.match_preview_id,
        problem_description: 'SDA نفس اليوم',
      },
    });
    const [order] = created.body?.data?.id
      ? await h.q(`SELECT booking_mode::text, surge_amount_cents, total_amount_cents FROM orders WHERE id = $1`, [created.body.data.id])
      : [];
    h.record(
      '**ب طلب النهارده بيتسجّل موعد عادي: مش طوارئ، رسوم الاستعجال صفر، بنفس السعر المعروض**',
      created.status === 201 && order?.booking_mode !== 'emergency' && Number(order?.surge_amount_cents) === 0
        && Number(order?.total_amount_cents) === Number(preview.body.data.pricing.total_amount_cents),
      `HTTP=${created.status} ${messageOf(created.body)} · mode=${order?.booking_mode} surge=${order?.surge_amount_cents}`,
    );
  }
  // ساعة أقرب من المهلة ⇒ رفض برسالة واضحة. أقرب ربع ساعة بعد ١٠ دقايق من دلوقتي.
  const soonMinutes = nowMinutes + 10;
  if (soonMinutes < endHour * 60 && soonMinutes + 1 < nowMinutes + leadMinutes) {
    const soonAt = cairoTodayAt(Math.floor(soonMinutes / 60), soonMinutes % 60);
    const tooSoon = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `sda-${h.nextTag()}` },
      body: { service_id: h.catalog.service.id, address_id: customer.addressId, scheduled_at: soonAt, problem_description: 'SDA قريب أوي' },
    });
    h.record(
      'ب ساعة أقرب من مهلة التجهيز بتترفض برسالة بتقول أقرب ميعاد',
      tooSoon.status === 400 && messageOf(tooSoon.body).includes('أقرب ميعاد'),
      `HTTP=${tooSoon.status} ${messageOf(tooSoon.body)}`,
    );
  }

  return surchargePhase(customer);
}

// ── ج) رسوم الطوارئ لكل خدمة ────────────────────────────────────────────────
async function surchargePhase(customer) {
  await patchService({ same_day_scheduling_enabled: false, emergency_surcharge_enabled: true });
  const withFee = await estimate(`booking_mode=emergency&zone_id=${h.catalog.zone.id}`);
  h.record(
    'ج الإعداد الافتراضي: الطلب المستعجل عليه رسوم طوارئ (السلوك القديم ماتغيّرش)',
    Number(withFee.body?.data?.emergency_surcharge_cents) > 0,
    `surcharge=${withFee.body?.data?.emergency_surcharge_cents}`,
  );
  const off = await patchService({ emergency_surcharge_enabled: false });
  const noFee = await estimate(`booking_mode=emergency&zone_id=${h.catalog.zone.id}`);
  h.record(
    'ج رسوم الطوارئ مقفولة من الأدمن ⇒ التقدير المستعجل بلا رسوم',
    off.status === 200 && Number(noFee.body?.data?.emergency_surcharge_cents) === 0,
    `HTTP=${off.status} surcharge=${noFee.body?.data?.emergency_surcharge_cents}`,
  );
  // طلب مستعجل حقيقي: لازم يفضل طوارئ (التوزيع والـSLA) والرسوم صفر.
  const urgent = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `sda-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      problem_description: 'SDA طوارئ بلا رسوم',
    },
  });
  const [order] = urgent.body?.data?.id
    ? await h.q(`SELECT booking_mode::text, surge_amount_cents FROM orders WHERE id = $1`, [urgent.body.data.id])
    : [];
  const sameCairoDay =
    new Date(Date.now() + 5 * 60_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' })
    === new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  if (sameCairoDay) {
    h.record(
      '**ج الطلب المستعجل بيفضل طوارئ لكن رسومه صفر**',
      urgent.status === 201 && order?.booking_mode === 'emergency' && Number(order?.surge_amount_cents) === 0,
      `HTTP=${urgent.status} ${messageOf(urgent.body)} · mode=${order?.booking_mode} surge=${order?.surge_amount_cents}`,
    );
  }
}

run()
  .catch((err) => h.record('خطأ غير متوقع', false, err.stack))
  .finally(async () => {
    for (const [key, value] of original) {
      if (value !== undefined) await h.setSetting(key, value).catch(() => {});
    }
    if (!KEEP) {
      console.log('\nتنظيف...');
      await h.q(`DELETE FROM booking_match_previews WHERE service_id = ANY($1::uuid[])`, [h.created.serviceIds]).catch(() => {});
      await h.deleteOrders(`problem_description LIKE $1`, ['SDA %']).catch(() => {});
      await h.cleanup();
    }
    const failed = h.failures;
    console.log(`\n--- الخلاصة ---\n${h.results.length - failed.length}/${h.results.length} نجحوا`);
    if (failed.length) process.exitCode = 1;
    await h.close();
  });
