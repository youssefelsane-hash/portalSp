#!/usr/bin/env node
/**
 * **تتبّع الأكواد الخاصة من زاوية الشخص اللي ماسك الموبايل** (docs/08 §195، طلب مالك 2026-10-03).
 *
 * > «لو أخدت كيو آر كود من السيستم، علقته عندي في الأوضة، وكتبت إن ده خاص بسموحة، وصورته بس…
 * > يظهر إن في شخص واحد عمل scanning، ولو طلبت يظهر إن في شخص عمل scanning وطلب برضه… وكمان
 * > فلوس الشريك محسوبة كويس».
 *
 * `promo-code-journey-audit.js` بيثبت المسار السعيد: عميل **جديد** بيسجّل **على الويب** بالرابط.
 * الملف ده بيمشي على الحالات اللي بتحصل فعلاً لما ملصق يتعلّق:
 *
 *   س-١  الرابط **المطبوع** نفسه (share_url) — مش رابط الـAPI المباشر — بيوصل ويتسجّل.
 *   س-٢  مسح بس من غير طلب = زيارة واحدة، ومن غير ما يتعدّ طلب.
 *   س-٣  عميل **قديم** بيمسح ويطلب بالكود = الطلب بيتنسب للكود.
 *   س-٤  عميل جديد بيسجّل من **التطبيق** (التطبيق مابيبعتش كود الرابط) ويطلب بالكود.
 *   س-٥  كود شريك **من غير خصم** (بواب/محل) — عميل قديم بيمسح ويطلب.
 *   س-٦  الأرقام اللي اللوحة بتعرضها لكل كود مطابقة للي حصل.
 *   س-٧  مستحق الشريك: يتحسب مرة، يتصرف، ولو الطلب اتسترد بعد الصرف يبان.
 *
 *   node scripts/qr-code-tracking-scenarios-audit.js [--keep]
 *
 * محتاج الـAPI شغّال بـ`THROTTLE_LIMIT=100000 AUTH_REGISTRATION_THROTTLE_LIMIT=1000` (السكربت بيسجّل
 * ٧ عملاء في دقيقتين، والسقف الافتراضي ٥/دقيقة)، وموقع العميل شغّال عشان س-١ يقيس الدومين المطبوع
 * فعلاً (`CUSTOMER_WEB_URL` في الـAPI = عنوان الموقع).
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('qrt');
const API_ROOT = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const PAYOUT = 3_000;
const messageOf = (b) => String(b?.message ?? b?.error?.message ?? '').slice(0, 160);

/**
 * مسح زي الموبايل بالظبط: بيتبع التحويلات **جوّه منظومتنا** (الموقع ← الـAPI) وبيقف عند أول
 * وجهة برّه (المتجر/صفحة الهبوط) — اللي الموبايل كان هيفتحها.
 */
async function scan(url) {
  const hops = [];
  let current = url;
  try {
    for (let i = 0; i < 4; i += 1) {
      const res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': ANDROID } });
      const location = res.headers.get('location') ?? '';
      hops.push(`${res.status}`);
      if (res.status < 300 || res.status >= 400 || !location) return { status: res.status, location, hops };
      const next = new URL(location, current).toString();
      if (!/\/(p|r|t)\/[^/]+$/.test(new URL(next).pathname)) return { status: res.status, location: next, hops };
      current = next;
    }
  } catch (err) {
    return { status: 0, location: String(err.message), hops };
  }
  return { status: 0, location: 'تحويلات كتير', hops };
}

async function createCode(admin, { discount }) {
  const code = `Q${discount ? 'D' : 'M'}${h.runId.toUpperCase()}`.slice(0, 20);
  const res = await h.api('/admin/promo-codes', {
    method: 'POST',
    token: admin.token,
    body: {
      code,
      name_ar: `سموحة ${discount ? 'بخصم' : 'شريك'} ${h.runId}`,
      discount_type: 'percentage',
      discount_value: 10,
      discount_enabled: discount,
      valid_from: new Date(Date.now() - 86_400_000).toISOString(),
      valid_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      marketing_channel: 'poster',
      marketing_region_label: 'سموحة',
      payout_per_completed_order_cents: PAYOUT,
      payout_contact_name: 'شريك سموحة',
      payout_contact_phone: '01000000002',
    },
  });
  return res.body?.data ?? { error: `HTTP=${res.status} ${messageOf(res.body)}` };
}

async function stats(admin, promoId) {
  const res = await h.api('/admin/promo-codes?per_page=100', { token: admin.token });
  const row = (res.body?.data?.items ?? res.body?.data ?? []).find((p) => p.id === promoId);
  return row ?? {};
}

async function newCustomer(extra = {}) {
  const reg = await h.registerCustomerWithPin({ fullName: `عميل ${h.nextTag()}`, ...extra });
  // التسجيل مسقوف ٥/دقيقة لكل IP؛ لو اتقفل نوقف بوضوح بدل ما نكمّل بتوكن فاضي ونطلع «توكن غير صالح».
  if (reg.error) throw new Error(`تسجيل عميل فشل (${reg.error}) — شغّل الـAPI بـAUTH_REGISTRATION_THROTTLE_LIMIT=1000`);
  const [address] = await h.q(
    `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
     VALUES ($1,$2,'شارع سموحة','7',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true) RETURNING id`,
    [reg.userId, h.catalog.city.id],
  );
  await h.fundWallet(reg.userId, 1_000_000);
  return { userId: reg.userId, token: reg.token, addressId: address.id };
}

async function placeOrder(customer, body = {}) {
  const res = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `qrt-${h.nextTag()}` },
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'QRT تدقيق تتبّع الكود',
      ...body,
    },
  });
  return { id: res.body?.data?.id, status: res.status, message: messageOf(res.body) };
}

async function complete(orderId, tech, customer) {
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
    headers: { 'Idempotency-Key': `qrt-pay-${h.nextTag()}` },
  });
  await sleep(1800);
  const [state] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
  return state?.order_status;
}

/** عميل «قديم» بجد: عنده طلب مكتمل قبل ما يشوف الملصق — غير كده النظام صح لما يعتبره جديد. */
async function existingCustomer(tech) {
  const customer = await newCustomer();
  const first = await placeOrder(customer);
  const status = first.id ? await complete(first.id, tech, customer) : `فشل ${first.message}`;
  if (status !== 'completed') throw new Error(`تجهيز عميل قديم فشل: ${status}`);
  return customer;
}

const commissionsFor = (promoId) =>
  h.q(`SELECT order_id, customer_user_id, amount_cents, status FROM promo_code_marketing_commissions WHERE promo_code_id = $1 ORDER BY accrued_at`, [promoId]);

async function run() {
  await h.connect();
  console.log(`\n=== تتبّع الأكواد الخاصة من موبايل حقيقي — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog({ priceCents: 40_000, durationMinutes: 60 });
  const admin = await h.makeAdmin();
  const tech = await h.makeTechnician('qrt');

  const promo = await createCode(admin, { discount: true });
  const partner = await createCode(admin, { discount: false });
  if (promo.error || partner.error) {
    h.record('س-٠ إنشاء الكودين', false, promo.error ?? partner.error);
    return;
  }

  // ── س-١: الرابط المطبوع تحت الـQR ─────────────────────────────────────
  const printed = await scan(promo.share_url);
  const [afterPrinted] = await h.q(`SELECT COUNT(*)::int n FROM promo_code_link_hits WHERE promo_code_id = $1`, [promo.id]);
  h.record(
    '**س-١ الرابط المطبوع تحت الـQR بيوصل ويتسجّل** (ده اللي الناس بتمسحه فعلاً)',
    printed.status === 302 && afterPrinted.n === 1 && printed.location.includes(`p=${promo.code}`),
    `share_url=${promo.share_url} → ${printed.hops.join('→')} ${printed.location.slice(0, 70)} · زيارات=${afterPrinted.n}`,
  );

  // ── س-٢: مسح بس ─────────────────────────────────────────────────────
  await scan(`${API_ROOT}/p/${promo.code}`);
  let s = await stats(admin, promo.id);
  h.record(
    'س-٢ مسح من غير طلب بيظهر زيارة ومفيش طلب',
    s.link_hit_count >= 1 && s.attributed_order_count === 0,
    `زيارات=${s.link_hit_count} طلبات=${s.attributed_order_count}`,
  );

  // ── س-٣: عميل قديم بيمسح ويطلب بالكود ──────────────────────────────
  const oldCustomer = await existingCustomer(tech);
  await scan(`${API_ROOT}/p/${promo.code}`);
  const o3 = await placeOrder(oldCustomer, { promo_code: promo.code });
  const st3 = o3.id ? await complete(o3.id, tech, oldCustomer) : `فشل الطلب ${o3.message}`;
  s = await stats(admin, promo.id);
  const c3 = (await commissionsFor(promo.id)).filter((c) => c.order_id === o3.id);
  h.record(
    '**س-٣ عميل قديم مسح وطلب بالكود — الطلب بيتعدّ على الكود**',
    st3 === 'completed' && s.attributed_order_count >= 1,
    `حالة=${st3} · طلبات على الكود=${s.attributed_order_count} مكتمل=${s.attributed_completed_order_count} · استخدام الكود=${s.used_count}`,
  );
  h.record(
    'س-٣/ب عميل قديم مابيولّدش مستحق للشريك (المستحق لاكتساب عميل جديد بس — السياسة القائمة)',
    c3.length === 0,
    `مستحقات على الطلب=${c3.length}`,
  );

  // ── س-٤: عميل جديد من التطبيق (مفيش promo_link_code في جسم التسجيل) ─────
  await scan(`${API_ROOT}/p/${promo.code}`);
  const appCustomer = await newCustomer(); // نفس جسم تسجيل التطبيق بالحرف: مفيش كود رابط
  const o4 = await placeOrder(appCustomer, { promo_code: promo.code });
  const st4 = o4.id ? await complete(o4.id, tech, appCustomer) : `فشل الطلب ${o4.message}`;
  await sleep(800);
  const [attr4] = await h.q(`SELECT promo_code_id FROM promo_code_link_attributions WHERE user_id = $1`, [appCustomer.userId]);
  const c4 = (await commissionsFor(promo.id)).filter((c) => c.order_id === o4.id);
  h.record(
    '**س-٤ عميل جديد سجّل من التطبيق وطلب بالكود — اتنسب للكود والشريك ليه مستحق**',
    st4 === 'completed' && attr4?.promo_code_id === promo.id && c4.length === 1,
    `حالة=${st4} · إسناد=${attr4 ? 'أيوه' : 'مفيش'} · مستحق=${c4.length ? c4[0].amount_cents : 'مفيش'}`,
  );

  // ── س-٥: كود شريك من غير خصم — عميل قديم مسح وطلب ──────────────────
  const oldCustomer2 = await existingCustomer(tech);
  await scan(`${API_ROOT}/p/${partner.code}`);
  const o5 = await placeOrder(oldCustomer2, { promo_code: partner.code });
  const st5 = o5.id ? await complete(o5.id, tech, oldCustomer2) : `مرفوض: HTTP=${o5.status} ${o5.message}`;
  const sp = await stats(admin, partner.id);
  h.record(
    '**س-٥ كود شريك بلا خصم: عميل قديم مسح وطلب — الطلب بيتعدّ للشريك**',
    st5 === 'completed' && sp.attributed_order_count >= 1,
    `طلب=${st5} · زيارات=${sp.link_hit_count} طلبات=${sp.attributed_order_count}`,
  );
  const c5 = (await commissionsFor(partner.id)).filter((c) => c.order_id === o5.id);
  h.record('س-٥/ب وعميل قديم مابيولّدش مستحق للشريك هنا برضه', c5.length === 0, `مستحقات=${c5.length}`);

  // ── س-٦: عميل جديد على الويب بالرابط (المسار السعيد) + أرقام اللوحة ───
  const webCustomer = await newCustomer({ promo_link_code: promo.code });
  await sleep(1000);
  const o6 = await placeOrder(webCustomer, { promo_code: promo.code });
  const st6 = o6.id ? await complete(o6.id, tech, webCustomer) : `فشل ${o6.message}`;
  const c6 = (await commissionsFor(promo.id)).filter((c) => c.order_id === o6.id);
  s = await stats(admin, promo.id);
  h.record('س-٦/أ المسار السعيد (ويب، عميل جديد) — مستحق واحد بالقيمة', st6 === 'completed' && c6.length === 1 && c6[0].amount_cents === PAYOUT, `حالة=${st6} مستحق=${c6[0]?.amount_cents ?? 'مفيش'}`);

  // ── س-٧: الاسترداد قبل وبعد صرف مستحق الشريك ─────────────────────────
  const refundOrder = async (orderId) => {
    const stepUp = await h.stepUpToken(admin.userId);
    const res = await h.api(`/admin/orders/${orderId}/refund`, {
      method: 'POST',
      token: admin.token,
      headers: { 'x-step-up-token': stepUp, 'Idempotency-Key': `qrt-ref-${h.nextTag()}` },
      body: { reason_notes: 'تدقيق استرداد ومستحق الشريك' },
    });
    await sleep(1500);
    const [order] = await h.q(`SELECT order_status FROM orders WHERE id = $1`, [orderId]);
    const [commission] = await h.q(`SELECT status FROM promo_code_marketing_commissions WHERE order_id = $1`, [orderId]);
    return { http: res.status, message: messageOf(res.body), order: order?.order_status, commission: commission?.status };
  };

  // (أ) لسه ما اتصرفش: الاسترداد لازم يلغيه.
  const r4 = await refundOrder(o4.id);
  h.record(
    '**س-٧/أ استرداد طلب قبل صرف مستحق الشريك — المستحق بيتلغي**',
    r4.order === 'refunded' && r4.commission === 'cancelled',
    `استرداد HTTP=${r4.http} ${r4.message} · الطلب=${r4.order} · المستحق=${r4.commission}`,
  );

  // (ب) زرار «اتدفعت» في اللوحة.
  const [c6row] = await h.q(`SELECT id FROM promo_code_marketing_commissions WHERE order_id = $1`, [o6.id]);
  const paidRes = await h.api('/admin/promo-codes/marketing-commissions/mark-paid', {
    method: 'POST',
    token: admin.token,
    body: { ids: c6row ? [c6row.id] : [], note: 'تدقيق' },
  });
  const [c6paid] = await h.q(`SELECT status FROM promo_code_marketing_commissions WHERE order_id = $1`, [o6.id]);
  const sPaid = await stats(admin, promo.id);
  h.record(
    '**س-٧/ب تعليم مستحق الشريك «اتدفع» من اللوحة بيشتغل، والكود بيوري المدفوع**',
    paidRes.status < 300 && c6paid?.status === 'paid' && sPaid.paid_partner_commission_cents === PAYOUT,
    `HTTP=${paidRes.status} ${messageOf(paidRes.body)} · الحالة=${c6paid?.status} · مدفوع على الكود=${sPaid.paid_partner_commission_cents}`,
  );

  // (ج) اتصرف وبعدين الطلب اترد: الفلوس خرجت فعلًا، فمايتلغيش بصمت — بيتعلّم للمتابعة.
  const r6 = await refundOrder(o6.id);
  const sRefunded = await stats(admin, promo.id);
  h.record(
    '**س-٧/ج استرداد بعد ما الشريك اتدفعله — بيبان على الكود للمتابعة (مش بيضيع بصمت)**',
    r6.order === 'refunded' && r6.commission === 'paid' && sRefunded.paid_commission_on_refunded_orders === 1,
    `الطلب=${r6.order} · المستحق=${r6.commission} · تنبيه على الكود=${sRefunded.paid_commission_on_refunded_orders}`,
  );

  // ── س-٨: الأرقام النهائية على الكود زي ما الأدمن هيشوفها ────────────────
  h.record(
    'س-٨ ملخص الكود في اللوحة',
    sRefunded.attributed_order_count === 3 && sRefunded.link_signup_count === 2,
    `مسح=${sRefunded.link_hit_count} · عملاء جداد=${sRefunded.link_signup_count} · طلبات=${sRefunded.attributed_order_count} · مكتمل=${sRefunded.attributed_completed_order_count} · استخدام=${sRefunded.used_count} · للشريك مستحق=${sRefunded.accrued_partner_commission_cents} مدفوع=${sRefunded.paid_partner_commission_cents}`,
  );
}

run()
  .catch((err) => h.record('خطأ غير متوقع', false, err.stack))
  .finally(async () => {
    if (!KEEP) {
      console.log('\nتنظيف...');
      // الأكواد بتاعة التشغيلة دي بس (QD/QM + runId) — مش أي كود بيبدأ بحرف Q.
      const codes = [`QD${h.runId.toUpperCase()}`.slice(0, 20), `QM${h.runId.toUpperCase()}`.slice(0, 20)];
      const ids = `(SELECT id FROM promo_codes WHERE code = ANY($1::text[]))`;
      await h.q(`DELETE FROM promo_code_marketing_commissions WHERE promo_code_id IN ${ids}`, [codes]);
      await h.q(`DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE problem_description LIKE $1)`, ['QRT %']);
      await h.deleteOrders(`problem_description LIKE $1`, ['QRT %']);
      for (const t of ['promo_code_link_hits', 'promo_code_link_attributions', 'promo_code_usages']) {
        await h.q(`DELETE FROM ${t} WHERE promo_code_id IN ${ids}`, [codes]);
      }
      await h.q(`DELETE FROM promo_codes WHERE code = ANY($1::text[])`, [codes]);
      await h.cleanup();
    }
    const failed = h.failures;
    console.log(`\n--- الخلاصة ---\n${h.results.length - failed.length}/${h.results.length} نجحوا`);
    if (failed.length) process.exitCode = 1;
    await h.close();
  });
