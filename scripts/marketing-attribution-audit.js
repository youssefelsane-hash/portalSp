#!/usr/bin/env node
/**
 * **إسناد التسويق end-to-end** (ADR-0082، docs/08 §135).
 *
 * ## اللي بيتقاس هنا ليه بالذات
 *
 * الفكرة كلها بتقف على سؤال واحد: «العميل ده جه من أنهي إعلان؟». والسؤال ده بيتكسر في نقطتين
 * مالهمش تالت:
 *
 * 1. **الرابط**: لو `‎/r/:code` مابيحوّلش صح حسب الجهاز، الملصق بيبقى ورقة على حيطة.
 * 2. **الإسناد**: لو التسجيل بالكود مابيربطش المستخدم بالمصدر، كل الأرقام اللي بعده صفر —
 *    والصرف يفضل بلا مقابل زي ما كان.
 *
 * فالتدقيق ده بيمشي الرحلة الحقيقية بالترتيب: أدمن بيعمل مصدر ← زائر أندرويد/iOS/ويب بيفتح
 * الرابط ← عميل بيسجّل بالكود ← بيعمل طلب ← الطلب بيتم ← الأرقام بتبان في التقرير والمستحق
 * بيتحسب مرة واحدة بالظبط.
 *
 *   node scripts/marketing-attribution-audit.js [--keep]
 */
'use strict';

const fs = require('node:fs');
const { LiveHarness, sleep } = require('./lib/live-harness');

/** لوج التطوير — المصدر الوحيد لكود الـOTP (متخزّن مهشّر في القاعدة). */
const API_LOG = process.env.API_LOG_PATH ?? '/tmp/claude-0/api.log';

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('mk');
const API_ROOT = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
};

/**
 * تسجيل عميل **بالمسار الحقيقي** (`POST /auth/register`) مش إدخال مباشر في القاعدة.
 *
 * ده مقصود: الحتة اللي بتتقاس هنا هي `marketing_code` في الـDTO والحدث اللي بيتصدر بعده —
 * وإدخال صف `users` مباشرةً بيتخطاهم بالكامل فالفحص كان هيعدّي وهو فاضي.
 */
async function registerCustomer(marketingCode) {
  const phone = h.nextPhone();
  // الكود متخزّن مهشّر (bcrypt) فمينفعش يتقرا من القاعدة. في التطوير الباك-إند بيطبعه في
  // اللوج (`[OTP] …`)، وده المصدر الوحيد المتاح لتشغيل المسار الحقيقي بلا تزييف.
  const otpRes = await h.api('/auth/otp/request', {
    method: 'POST',
    body: { phone_number: phone, purpose: 'register' },
  });
  if (otpRes.status !== 200 && otpRes.status !== 201) {
    return { error: `طلب OTP فشل: HTTP=${otpRes.status} ${messageOf(otpRes.body)}` };
  }
  await sleep(400);
  const log = fs.readFileSync(API_LOG, 'utf8');
  const match = [...log.matchAll(new RegExp(`\\[OTP\\] \\${phone} .*→ (\\d{6})`, 'g'))].pop();
  if (!match) return { error: `مالقيناش كود OTP في لوج التطوير (${API_LOG})` };

  const res = await h.api('/auth/register', {
    method: 'POST',
    body: {
      phone_number: phone,
      otp_code: match[1],
      full_name: `عميل تسويق ${h.nextTag()}`,
      user_type: 'customer',
      ...(marketingCode ? { marketing_code: marketingCode } : {}),
    },
  });
  if (res.status !== 201 && res.status !== 200) return { error: `HTTP=${res.status} ${messageOf(res.body)}` };
  const [row] = await h.q(`SELECT id FROM users WHERE phone_number = $1`, [phone]);
  if (row) h.created.users.push(row.id);
  return { userId: row?.id, token: row ? h.token(row.id) : null };
}

/** بيتابع الرابط القصير **من غير** ما يتبع التحويل — إحنا بنقيس الوجهة نفسها. */
async function follow(code, userAgent) {
  const res = await fetch(`${API_ROOT}/r/${code}`, { redirect: 'manual', headers: { 'user-agent': userAgent } });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

function messageOf(body) {
  return String(body?.message ?? body?.error?.message ?? '').slice(0, 140);
}

async function run() {
  await h.connect();
  console.log(`\n=== إسناد التسويق — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  const admin = await h.makeAdmin();
  const tech = await h.makeTechnician('mk');

  // ── م-١: الأدمن بيعمل مصدر بعمولة بواب ───────────────────────────────
  const created = await h.api('/admin/marketing/sources', {
    method: 'POST',
    token: admin.token,
    body: {
      name_ar: `بواب عمارة ${h.runId}`,
      channel: 'doorman',
      region_label: 'سموحة',
      payout_per_completed_order_cents: 2500,
      payout_contact_name: 'عم سيد',
      payout_contact_phone: '01000000000',
    },
  });
  h.record('م-١/أ المصدر اتعمل بكود وشير-لينك', created.status === 201 && !!created.body?.data?.code, `HTTP=${created.status} ${messageOf(created.body)}`);
  const source = created.body?.data;
  if (!source?.code) return finish();
  h.record(
    'م-١/ب الرابط المطبوع مبني من العنوان العام مش متخزّن',
    String(source.share_url).endsWith(`/r/${source.code}`),
    source.share_url,
  );

  // ── م-٢: التوزيع حسب الجهاز ──────────────────────────────────────────
  //
  // الإعدادات فاضية دلوقتي (روابط المتاجر لسه ما اتدخّلتش) — المتوقّع إن **الكل** يروح لصفحة
  // الويب، مش لصفحة مكسورة. ده أهم من التوزيع نفسه: الوضع الطبيعي قبل نزول التطبيق المتاجر.
  for (const [name, ua] of Object.entries(UA)) {
    const res = await follow(source.code, ua);
    h.record(
      `م-٢/أ زائر ${name} بيتحوّل لوجهة شغّالة (302 + وجهة مش فاضية)`,
      res.status === 302 && res.location.length > 0,
      `HTTP=${res.status} → ${res.location}`,
    );
    h.record(
      `م-٢/ب كود المصدر ماشي مع التحويل (${name})`,
      res.location.includes(`m=${source.code}`),
      res.location,
    );
  }

  // دلوقتي نحط رابط أندرويد ونتأكد إن التوزيع بقى فعلي.
  const play = 'https://play.google.com/store/apps/details?id=com.ostahome.customer';
  await h.setSetting('marketing.android_store_url', play);
  // الكاش المحلي للإعدادات عمره ثانيتين (stale-while-revalidate) — الانتظار هنا بيخلّي الفحص
  // يقيس القيمة الجديدة فعلاً بدل ما يتهم كود سليم.
  await sleep(2600);
  const androidAfter = await follow(source.code, UA.android);
  const desktopAfter = await follow(source.code, UA.desktop);
  h.record(
    'م-٢/ج بعد إدخال رابط جوجل بلاي، الأندرويد بيروح للمتجر',
    androidAfter.location.startsWith(play),
    androidAfter.location,
  );
  h.record(
    'م-٢/د والديسكتوب **ما اتأثرش** — التوزيع لكل منصة لوحدها',
    !desktopAfter.location.startsWith(play),
    desktopAfter.location,
  );

  // ── م-٣: الزيارات اتسجّلت بالمنصة الصح ───────────────────────────────
  await sleep(400);
  const hits = await h.q(
    `SELECT platform, COUNT(*)::int AS n FROM marketing_link_hits WHERE source_id = $1 GROUP BY platform ORDER BY platform`,
    [source.id],
  );
  const byPlatform = new Map(hits.map((r) => [r.platform, r.n]));
  h.record(
    'م-٣/أ الزيارات اتسجّلت والمنصة اتحدّدت من User-Agent',
    byPlatform.get('android') === 2 && byPlatform.get('ios') === 1 && byPlatform.get('web') === 2,
    [...byPlatform].map(([p, n]) => `${p}=${n}`).join(' '),
  );
  // **زيارة مش شخص** — لازم مفيش أي عمود بيعرّف الزائر (قرار خصوصية صريح في ADR-0082 §4).
  const hitCols = await h.q(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'marketing_link_hits'`,
  );
  const names = hitCols.map((c) => c.column_name);
  h.record(
    'م-٣/ب مفيش أي عمود بيعرّف الزائر (لا IP ولا جهاز ولا كوكي)',
    !names.some((n) => /ip|device|cookie|fingerprint|user_agent|user_id/.test(n)),
    names.join(', '),
  );

  // ── م-٤: التسجيل بالكود بيربط العميل بالمصدر ─────────────────────────
  const registered = await registerCustomer(source.code);
  h.record('م-٤/٠ التسجيل بالمسار الحقيقي نجح', !registered.error, registered.error ?? `user=${registered.userId}`);
  await sleep(900);
  const [attribution] = await h.q(
    `SELECT source_id FROM marketing_attributions WHERE user_id = $1 AND deleted_at IS NULL`,
    [registered.userId],
  );
  h.record('م-٤/أ التسجيل بالكود ربط العميل بالمصدر', attribution?.source_id === source.id, `source=${attribution?.source_id ?? 'مفيش'}`);

  // **كود غلط مايوقفش التسجيل** — ده الفرق بين خسارة إسناد وخسارة عميل.
  const badCode = await registerCustomer('ZZZZZZ');
  h.record(
    'م-٤/ب كود غلط مايوقفش التسجيل (خسارة إسناد ≠ خسارة عميل)',
    !badCode.error && !!badCode.userId,
    badCode.error ?? 'الحساب اتعمل عادي',
  );

  // العميل المسجّل محتاج عنوان عشان يقدر يطلب — التسجيل مابيعملش عنوان.
  const [address] = await h.q(
    `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
     VALUES ($1,$2,'شارع التدقيق','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
    [registered.userId, h.catalog.city.id],
  );
  const customer = { userId: registered.userId, token: registered.token, addressId: address.id };

  // ── م-٥: الطلب المكتمل بيولّد مستحق **مرة واحدة بالظبط** ─────────────
  await h.fundWallet(customer.userId, 1_000_000);
  const created2 = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `mk-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق إسناد التسويق',
    },
  });
  const orderId = created2.body?.data?.id;
  h.record('م-٥/أ الطلب اتعمل', created2.status === 201 && !!orderId, `HTTP=${created2.status} ${messageOf(created2.body)}`);
  if (orderId) {
    for (let i = 0; i < 60 && !(await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]))[0]?.technician_id; i++) {
      await sleep(500);
    }
    for (const step of ['depart', 'arrive', 'start']) {
      await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
    }
    await h.uploadAfterPhoto(orderId, tech.token);
    await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });
    // العمولة بتتحسب على `completed` — والدفع هو اللي بيوصّل الطلب للحالة دي.
    await h.api(`/orders/${orderId}/pay-with-wallet`, {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `mk-pay-${h.nextTag()}` },
    });
    await sleep(1800);
    const [state] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    h.record('م-٥/أ٢ الطلب وصل completed', state?.order_status === 'completed', `الحالة=${state?.order_status}`);
    const order = { id: orderId };
    const commissions = await h.q(
      `SELECT amount_cents, status FROM marketing_source_commissions WHERE order_id = $1`,
      [order.id],
    );
    h.record(
      'م-٥/ب مستحق واحد بالظبط بالقيمة المضبوطة',
      commissions.length === 1 && commissions[0].amount_cents === 2500 && commissions[0].status === 'accrued',
      commissions.length ? `${commissions.length} صف، ${commissions[0].amount_cents} قرش، ${commissions[0].status}` : 'مفيش',
    );
  }

  // ── م-٦: التقرير بيعرض الأرقام ───────────────────────────────────────
  const dayMs = 86_400_000;
  const from = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const to = new Date(Date.now() + dayMs).toISOString().slice(0, 10);
  const perf = await h.api(`/admin/marketing/performance/sources?from=${from}&to=${to}`, { token: admin.token });
  const row = (perf.body?.data?.sources ?? []).find((s) => s.source_id === source.id);
  h.record(
    'م-٦/أ التقرير بيعرض زيارات وتسجيل وطلبات للمصدر',
    !!row && row.hits >= 5 && row.signups >= 1 && row.orders >= 1,
    row ? `زيارات=${row.hits} تسجيل=${row.signups} طلبات=${row.orders} مكتملة=${row.completed_orders}` : `HTTP=${perf.status}`,
  );

  const channels = await h.api(`/admin/marketing/performance/channels?from=${from}&to=${to}`, { token: admin.token });
  const doorman = (channels.body?.data?.channels ?? []).find((c) => c.channel === 'doorman');
  h.record('م-٦/ب التجميع بالقناة شغّال', !!doorman, doorman ? `قناة البواب: مصادر=${doorman.sources}` : `HTTP=${channels.status}`);
  // **مقام صفر = `null` مش صفر** — «CAC صفر» بيتقري كأن الاكتساب ببلاش.
  h.record(
    'م-٦/ج CAC بيرجع null لما مفيش صرف مسجّل (مش صفر كاذب)',
    doorman ? doorman.cac_cents === null : false,
    doorman ? `cac=${doorman.cac_cents} spend=${doorman.spend_cents}` : '-',
  );

  // ── م-٧: الصلاحية بتحمي الأرقام ──────────────────────────────────────
  const asCustomer = await h.api('/admin/marketing/sources', { token: customer.token });
  h.record(
    'م-٧/أ عميل عادي مايقدرش يشوف مصادر التسويق',
    asCustomer.status === 401 || asCustomer.status === 403,
    `HTTP=${asCustomer.status}`,
  );

  await finish();
}

async function finish() {
  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }
  if (!KEEP) {
    console.log(`\nتنظيف...`);
    await h.q(`DELETE FROM marketing_link_hits WHERE source_id IN (SELECT id FROM marketing_sources WHERE name_ar LIKE $1)`, [`%${h.runId}%`]).catch(() => {});
    await h.q(`DELETE FROM marketing_source_commissions WHERE source_id IN (SELECT id FROM marketing_sources WHERE name_ar LIKE $1)`, [`%${h.runId}%`]).catch(() => {});
    await h.q(`DELETE FROM marketing_attributions WHERE source_id IN (SELECT id FROM marketing_sources WHERE name_ar LIKE $1)`, [`%${h.runId}%`]).catch(() => {});
    await h.q(`DELETE FROM marketing_sources WHERE name_ar LIKE $1`, [`%${h.runId}%`]).catch(() => {});
    await h.cleanup();
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await h.close().catch(() => {});
  process.exit(2);
});
