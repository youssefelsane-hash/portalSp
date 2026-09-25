#!/usr/bin/env node
/**
 * **رحلة كود الخصم end-to-end** (docs/08 §164، بلاغ مالك 2026-09-18).
 *
 * > «في الفلو بتاعت العروض أو كروت الخصم، محتاج تتشيك عليها إن هي شغالة مظبوط، لأن إحنا كنا
 * > قايلين إن المفروض لما حد يسكان الكود بيظهر إن في حد سكان الكود، ولما الطلب بتاعه يبقى
 * > مكتمل يبتدي المستحقات تتوزع… وفي الرحلة مكتوب جنبها زيرو».
 *
 * ## ليه ملف منفصل عن `marketing-attribution-audit.js`
 *
 * دول **نظامين متوازيين مقصودين**، بجدولين مختلفين ورابطين مختلفين:
 *
 * | | مصادر التسويق | أكواد الخصم |
 * |---|---|---|
 * | الرابط | `‎/r/:code` | `‎/p/:code` |
 * | الزيارات | `marketing_source_hits` | `promo_code_link_hits` |
 * | الإسناد | `marketing_source_attributions` | `promo_code_link_attributions` |
 * | المستحق | `marketing_source_commissions` | `promo_code_marketing_commissions` |
 * | الفرق الجوهري | إسناد بس، مفيش خصم | **بيطبّق خصم فعلي على الطلب كمان** |
 *
 * التدقيق القديم بيغطي العمود الشمال بالكامل، والعمود اليمين كان **بلا أي تغطية** — وهو
 * اللي شاشة `/promotions` بتعرضه. فده مش تكرار، ده النص الناقص.
 *
 *   node scripts/promo-code-journey-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('pj');
const API_ROOT = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
};

const PAYOUT_CENTS = 2_500;
const messageOf = (body) => String(body?.message ?? body?.error?.message ?? '').slice(0, 140);

/** بيتابع رابط الكود **من غير** ما يتبع التحويل — الوجهة نفسها هي اللي بتتقاس. */
async function follow(code, userAgent) {
  const res = await fetch(`${API_ROOT}/p/${encodeURIComponent(code)}`, {
    redirect: 'manual',
    headers: { 'user-agent': userAgent },
  });
  return { status: res.status, location: res.headers.get('location') ?? '' };
}

/**
 * تسجيل عميل بالمسار الحقيقي مع `promo_link_code` — الحقل ده هو اللي بيطلق
 * `PROMO_LINK_CAPTURED_EVENT`، وإدخال صف `users` مباشرةً كان هيتخطّاه فالفحص يعدّي وهو فاضي.
 */
async function registerCustomer(promoLinkCode) {
  const reg = await h.registerCustomerWithPin({
    fullName: `عميل كوبون ${h.nextTag()}`,
    ...(promoLinkCode ? { promo_link_code: promoLinkCode } : {}),
  });
  if (reg.error) return { error: reg.error };
  return { userId: reg.userId, token: reg.token };
}

/** بيوصّل طلب لحالة `completed` بالمسار الحقيقي (تنفيذ الفني + دفع العميل). */
async function driveOrderToCompleted(orderId, tech, customer) {
  for (let i = 0; i < 60; i += 1) {
    const [row] = await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    if (row?.technician_id) break;
    await sleep(500);
  }
  for (const step of ['depart', 'arrive', 'start']) {
    await h.api(`/technician/orders/${orderId}/${step}`, { method: 'POST', token: tech.token });
  }
  await h.uploadAfterPhoto(orderId, tech.token);
  await h.api(`/technician/orders/${orderId}/complete`, { method: 'POST', token: tech.token });
  await h.api(`/orders/${orderId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `pj-pay-${h.nextTag()}` },
  });
  await sleep(1800);
  const [state] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
  return state?.order_status;
}

async function run() {
  await h.connect();
  console.log(`\n=== رحلة كود الخصم — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog({ priceCents: 50_000, durationMinutes: 60 });
  const admin = await h.makeAdmin();
  const tech = await h.makeTechnician('pj');

  // ── ك-١: الأدمن بيعمل كود بخصم + مستحق شريك + بيانات تواصل ────────────
  const code = `PJ${h.runId.toUpperCase()}`.slice(0, 20);
  const created = await h.api('/admin/promo-codes', {
    method: 'POST',
    token: admin.token,
    body: {
      code,
      name_ar: `كوبون مؤثّر ${h.runId}`,
      discount_type: 'percentage',
      discount_value: 10,
      discount_enabled: true,
      valid_from: new Date(Date.now() - 86_400_000).toISOString(),
      valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      marketing_channel: 'influencer',
      payout_per_completed_order_cents: PAYOUT_CENTS,
      payout_contact_name: 'مؤثّر التدقيق',
      payout_contact_phone: '01000000001',
    },
  });
  const promo = created.body?.data;
  h.record('ك-١/أ الكود اتعمل ومعاه رابط مشاركة', created.status === 201 && !!promo?.share_url, `HTTP=${created.status} ${messageOf(created.body)}`);
  if (!promo) return;

  h.record(
    'ك-١/ب بيانات الشريك اتخزّنت ورجعت في الرد (اسم + رقم)',
    promo.payout_contact_name === 'مؤثّر التدقيق' && promo.payout_contact_phone === '01000000001',
    `اسم=${promo.payout_contact_name ?? 'مفيش'} رقم=${promo.payout_contact_phone ?? 'مفيش'}`,
  );

  // ── ك-٢: المسح بيتسجّل ويحوّل ─────────────────────────────────────────
  for (const [platform, ua] of Object.entries(UA)) {
    const res = await follow(code, ua);
    h.record(
      `ك-٢/أ زائر ${platform} بيتحوّل لوجهة شغّالة`,
      res.status === 302 && res.location.length > 0,
      `HTTP=${res.status} → ${res.location}`,
    );
    h.record(`ك-٢/ب الكود ماشي مع التحويل (${platform})`, res.location.includes(`p=${code}`), res.location);
  }
  // كود مش موجود: الزائر مايتسابش في صفحة خطأ، وولا زيارة بتتسجّل لكود وهمي.
  const ghost = await follow(`${code}-GHOST`, UA.desktop);
  h.record('ك-٢/ج كود مش موجود بيحوّل برضه بلا كود (مش صفحة خطأ)', ghost.status === 302, `HTTP=${ghost.status} → ${ghost.location}`);

  const [hits] = await h.q(
    `SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE platform='android')::int AS android,
            COUNT(*) FILTER (WHERE platform='ios')::int AS ios, COUNT(*) FILTER (WHERE platform='web')::int AS web
       FROM promo_code_link_hits WHERE promo_code_id = $1`,
    [promo.id],
  );
  h.record(
    '**ك-٣/أ المسح بيتسجّل فعلاً** — «بيظهر إن في حد سكان الكود»',
    hits.n === 3 && hits.android === 1 && hits.ios === 1 && hits.web === 1,
    `إجمالي=${hits.n} android=${hits.android} ios=${hits.ios} web=${hits.web}`,
  );

  // ── ك-٤: التسجيل بالكود بيربط العميل ─────────────────────────────────
  const registered = await registerCustomer(code);
  h.record('ك-٤/٠ التسجيل بالمسار الحقيقي نجح', !registered.error, registered.error ?? `user=${registered.userId}`);
  if (registered.error) return;

  // الإسناد بيتم في listener **بعد** رد التسجيل (التسجيل مايستناش القياس عمدًا)، فالقراءة
  // الفورية بترجع فاضية. الانتظار هنا بيقيس السلوك الحقيقي مش بيداري عليه: لو مابقاش بيوصل
  // خلال ٥ ثواني يبقى فيه عطل فعلي.
  let attribution;
  for (let i = 0; i < 10 && !attribution; i += 1) {
    await sleep(500);
    [attribution] = await h.q(
      `SELECT promo_code_id FROM promo_code_link_attributions WHERE user_id = $1`,
      [registered.userId],
    );
  }
  h.record(
    '**ك-٤/أ التسجيل بالكود ربط العميل بالكوبون** — ده اللي عمود «الرحلة» بيعدّه',
    attribution?.promo_code_id === promo.id,
    `الكود المرتبط=${attribution?.promo_code_id ?? 'مفيش'}`,
  );

  const [address] = await h.q(
    `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
     VALUES ($1,$2,'شارع تدقيق الكوبون','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
    [registered.userId, h.catalog.city.id],
  );
  const customer = { userId: registered.userId, token: registered.token, addressId: address.id };
  await h.fundWallet(customer.userId, 1_000_000);

  // ── ك-٥: الطلب بالكود — الخصم بيتطبّق فعلاً ──────────────────────────
  const createdOrder = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `pj-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      promo_code: code,
      problem_description: 'PJ تدقيق رحلة الكوبون',
    },
  });
  const orderId = createdOrder.body?.data?.id;
  h.record('ك-٥/أ الطلب اتعمل بالكود', createdOrder.status === 201 && !!orderId, `HTTP=${createdOrder.status} ${messageOf(createdOrder.body)}`);
  if (!orderId) return;

  const [priced] = await h.q(
    `SELECT discount_amount_cents, promo_code_id, total_amount_cents FROM orders WHERE id = $1`,
    [orderId],
  );
  h.record(
    'ك-٥/ب الخصم اتطبّق على الطلب والكود اتسجّل عليه',
    Number(priced.discount_amount_cents) > 0 && priced.promo_code_id === promo.id,
    `خصم=${priced.discount_amount_cents} قرش · كود=${priced.promo_code_id ? 'متسجّل' : 'مفيش'}`,
  );
  const [usage] = await h.q(`SELECT COUNT(*)::int AS n FROM promo_code_usages WHERE promo_code_id = $1`, [promo.id]);
  h.record('ك-٥/ج الاستخدام اتسجّل مرة واحدة (عمود «القيود»)', usage.n === 1, `صفوف الاستخدام=${usage.n}`);

  // ── ك-٦: الاكتمال بيولّد المستحق **مرة واحدة** ────────────────────────
  const status = await driveOrderToCompleted(orderId, tech, customer);
  h.record('ك-٦/أ الطلب وصل completed بالمسار الحقيقي', status === 'completed', `الحالة=${status}`);

  const commissions = await h.q(
    `SELECT amount_cents, status FROM promo_code_marketing_commissions WHERE order_id = $1`,
    [orderId],
  );
  h.record(
    '**ك-٦/ب المستحقات بتتوزع لحظة اكتمال الطلب** — مستحق واحد بالقيمة المضبوطة',
    commissions.length === 1 && Number(commissions[0].amount_cents) === PAYOUT_CENTS && commissions[0].status === 'accrued',
    commissions.length ? `${commissions.length} صف · ${commissions[0].amount_cents} قرش · ${commissions[0].status}` : 'مفيش',
  );

  // ── ك-٧: الأرقام بتوصل لشاشة الأدمن ──────────────────────────────────
  const listed = await h.api('/admin/promo-codes?page=1&per_page=100', { token: admin.token });
  const row = (listed.body?.data?.items ?? listed.body?.items ?? listed.body?.data ?? []).find((item) => item.id === promo.id);
  h.record(
    '**ك-٧/أ عمود «الرحلة» بيعرض الأرقام الحقيقية مش صفر**',
    row?.link_hit_count === 3 && row?.link_signup_count === 1,
    `زيارات=${row?.link_hit_count} تسجيل=${row?.link_signup_count}`,
  );
  h.record(
    'ك-٧/ب عمود «النتيجة» بيعرض الطلب المكتمل وإيراده',
    row?.attributed_completed_order_count === 1 && Number(row?.attributed_gross_revenue_cents) > 0,
    `مكتمل=${row?.attributed_completed_order_count} إيراد=${row?.attributed_gross_revenue_cents}`,
  );
  h.record(
    'ك-٧/ج بيانات الشريك بتوصل للوحة مع الكود (اسم + رقم)',
    row?.payout_contact_name === 'مؤثّر التدقيق' && row?.payout_contact_phone === '01000000001',
    `اسم=${row?.payout_contact_name ?? 'مفيش'} رقم=${row?.payout_contact_phone ?? 'مفيش'}`,
  );
  h.record(
    'ك-٧/د المستحق المتراكم ظاهر على الكود',
    Number(row?.accrued_partner_commission_cents) === PAYOUT_CENTS,
    `متراكم=${row?.accrued_partner_commission_cents}`,
  );

  // ── ك-٨: الإلغاء بيلغي المستحق (مش بيسيبه متراكم) ────────────────────
  const second = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `pj2-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'PJ طلب هيتلغي',
    },
  });
  const secondId = second.body?.data?.id;
  if (secondId) {
    // المستحق بيتحقن هنا بعميل **وهمي مختلف** عن عميل الرحلة: الحقن بعميل الرحلة كان بيلوّث
    // عدّ ك-٩ تحت (اللي بيمتحن «مستحق واحد للعميل الواحد») فيفشل الفحص لسبب من صنع التدقيق.
    await h.q(
      `INSERT INTO promo_code_marketing_commissions (promo_code_id, order_id, customer_user_id, amount_cents)
       VALUES ($1,$2,$3,$4)`,
      [promo.id, secondId, admin.userId, PAYOUT_CENTS],
    );
    // الإلغاء بيطلب سبب من القايمة المعتمدة (نص حر لوحده بيترفض) — بناخد أول سبب متاح
    // للعميل بدل ما نخترع UUID.
    const reasons = await h.api('/cancellation-reasons?applies_to=customer', { token: customer.token });
    const reasonId = (reasons.body?.data ?? reasons.body?.items ?? [])[0]?.id;
    const cancelRes = await h.api(`/orders/${secondId}/cancel`, {
      method: 'POST',
      token: customer.token,
      body: { reason: 'تدقيق الإلغاء', ...(reasonId ? { cancellation_reason_id: reasonId } : {}) },
    });
    await sleep(2000);
    const [orderAfter] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [secondId]);
    // بنفرّق صراحةً بين «الإلغاء نفسه فشل» و«الإلغاء نجح والمستحق ما اتلغاش» — البلاغين
    // مختلفين تمامًا، وبلاغ واحد مدموج كان هيوّدي المراجعة في الاتجاه الغلط.
    h.record(
      'ك-٨/٠ الطلب اتلغى فعلاً بالمسار الحقيقي',
      orderAfter?.order_status === 'cancelled_by_customer',
      `HTTP=${cancelRes.status} الحالة=${orderAfter?.order_status} ${messageOf(cancelRes.body)}`,
    );
    const [cancelled] = await h.q(
      `SELECT status FROM promo_code_marketing_commissions WHERE order_id = $1`,
      [secondId],
    );
    h.record(
      'ك-٨/أ إلغاء الطلب بيلغي مستحق الشريك (مايفضلش متراكم على شغل ما تمّش)',
      cancelled?.status === 'cancelled',
      `الحالة=${cancelled?.status ?? 'مفيش صف'}`,
    );
  }

  // ── ك-٩: مستحق واحد للعميل الواحد مهما عمل طلبات ─────────────────────
  const third = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `pj3-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'PJ طلب تاني مكتمل',
    },
  });
  const thirdId = third.body?.data?.id;
  if (thirdId) {
    const thirdStatus = await driveOrderToCompleted(thirdId, tech, customer);
    const all = await h.q(
      `SELECT COUNT(*)::int AS n FROM promo_code_marketing_commissions
        WHERE customer_user_id = $1 AND status = 'accrued'`,
      [customer.userId],
    );
    h.record(
      'ك-٩/أ العميل الواحد بيولّد مستحق واحد بس مهما عمل طلبات (أول طلب مكتمل)',
      all[0].n === 1,
      `طلب تاني=${thirdStatus} · مستحقات متراكمة للعميل=${all[0].n}`,
    );
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!KEEP) {
      console.log('\nتنظيف...');
      await h.q(`DELETE FROM promo_code_marketing_commissions WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE code LIKE $1)`, [`PJ%`]);
      await h.q(`DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE problem_description LIKE $1)`, ['PJ %']);
      await h.deleteOrders(`problem_description LIKE $1`, ['PJ %']);
      await h.q(`DELETE FROM promo_code_link_hits WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE code LIKE $1)`, ['PJ%']);
      await h.q(`DELETE FROM promo_code_link_attributions WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE code LIKE $1)`, ['PJ%']);
      await h.q(`DELETE FROM promo_code_usages WHERE promo_code_id IN (SELECT id FROM promo_codes WHERE code LIKE $1)`, ['PJ%']);
      await h.q(`DELETE FROM promo_codes WHERE code LIKE $1`, ['PJ%']);
      await h.cleanup();
    }
    const failed = h.failures;
    console.log(`\n--- الخلاصة ---\n${h.results.length - failed.length}/${h.results.length} نجحوا`);
    if (failed.length) process.exitCode = 1;
    await h.close();
  });
