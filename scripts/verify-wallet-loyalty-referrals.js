#!/usr/bin/env node
/**
 * **تحقّق حي: المحفظة والولاء والترشيحات وروابط QR** (docs/08 §165، بلاغ مالك 2026-09-18).
 *
 * أربع نقط في طلب واحد، وكلها بتتقاس هنا بالمسار الحقيقي:
 *
 * 1. العميل اللي عنده رصيد محفظة (استرداد/تعويض) **يقدر يدفع بيه فعلاً**.
 * 2. الأدمن يقدر يعدّل الرصيد (التحويل البنكي بيتم برّه المنصة، والرقم بيتظبط هنا).
 * 3. نقاط الولاء بقى ليها **قيمة حقيقية** — استبدال برصيد محفظة بسعر صرف من الإعدادات.
 * 4. روابط QR بتحوّل (مش نص خام)، و«رشّح صحابك» شغّال end-to-end.
 *
 *   node scripts/verify-wallet-loyalty-referrals.js   # محتاج API شغّال
 */
'use strict';

const fs = require('node:fs');
const { LiveHarness, sleep } = require('./lib/live-harness');
const { resolveApiLog } = require('./lib/resolve-api-log');

const API_ROOT = (process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/api\/v1\/?$/, '');
const messageOf = (body) => String(body?.message ?? body?.error?.message ?? '').slice(0, 140);
const egp = (c) => `${(c / 100).toFixed(2)} ج.م`;

/** تسجيل عميل بالمسار الحقيقي مع كود ترشيح صاحبه — الكود بيتفحص في `POST /auth/register`. */
async function registerWithReferral(h, referralCode) {
  const phone = h.nextPhone();
  const otpRes = await h.api('/auth/otp/request', {
    method: 'POST',
    body: { phone_number: phone, purpose: 'register' },
  });
  if (otpRes.status !== 200 && otpRes.status !== 201) return { error: `طلب OTP فشل: HTTP=${otpRes.status}` };
  await sleep(400);
  const apiLog = resolveApiLog();
  if (!apiLog) return { error: 'مالقيناش لوج الباك-إند' };
  const log = fs.readFileSync(apiLog, 'utf8');
  const match = [...log.matchAll(new RegExp(`\\[OTP\\] \\${phone} .*→ (\\d{6})`, 'g'))].pop();
  if (!match) return { error: 'مالقيناش كود OTP في لوج التطوير' };
  const res = await h.api('/auth/register', {
    method: 'POST',
    body: {
      phone_number: phone,
      otp_code: match[1],
      full_name: `صاحب ${h.nextTag()}`,
      user_type: 'customer',
      referral_code: referralCode,
    },
  });
  if (res.status !== 201 && res.status !== 200) return { error: `HTTP=${res.status} ${messageOf(res.body)}` };
  const [row] = await h.q(`SELECT id FROM users WHERE phone_number = $1`, [phone]);
  if (row) h.created.users.push(row.id);
  return { userId: row?.id };
}

async function main() {
  const h = new LiveHarness('wlr');
  await h.connect();
  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 60 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeEmployee(['wallets.view', 'wallets.adjust', 'customers.view'], 'fin');
    // تعديل رصيد محفظة عملية مالية حسّاسة وبتطلب تأكيد Passkey حديث (ADR-0011) — مش عيب في
    // المسار، ده الحارس شغّال. بيتبعت في هيدر `X-Step-Up-Token` **وبيتستهلك مرة واحدة**،
    // فكل نداء حسّاس محتاج توكن جديد.
    const stepUpHeaders = async () => ({
      'X-Step-Up-Token': await h.stepUpToken(admin.userId),
      // أي كتابة مالية محتاجة مفتاح تكرار (docs/01 §1.4) — إعادة الإرسال ماتعملش تعديلين.
      'Idempotency-Key': `wlr-adj-${h.nextTag()}`,
    });

    // ═══ ١ الأدمن بيعدّل الرصيد (تعويض/تحويل بنكي يدوي) ═══
    const credited = await h.api(`/admin/wallets/${customer.userId}/adjust`, {
      method: 'PATCH',
      token: admin.token,
      headers: await stepUpHeaders(),
      body: { amount_cents: 50_000, direction: 'credit', reason_ar: 'تعويض شكوى — تدقيق حي' },
    });
    const balanceOf = async (userId) => {
      const [row] = await h.q(`SELECT balance_cents FROM wallets WHERE owner_user_id = $1`, [userId]);
      return row ? Number(row.balance_cents) : null;
    };
    const afterCredit = await balanceOf(customer.userId);
    h.record(
      '١/أ الأدمن بيزوّد رصيد العميل بسبب مسجّل',
      credited.status === 200 && afterCredit === 50_000,
      `HTTP=${credited.status} الرصيد=${afterCredit === null ? 'مفيش محفظة' : egp(afterCredit)} ${messageOf(credited.body)}`,
    );

    // ═══ ٢ العميل بيدفع بالرصيد ده على طلب حقيقي ═══
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `wlr-${h.nextTag()}` },
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        scheduled_at: h.nextDay(),
        problem_description: 'WLR تدقيق الدفع بالمحفظة',
      },
    });
    const orderId = created.body?.data?.id;
    h.record('٢/أ الطلب اتعمل', created.status === 201 && !!orderId, `HTTP=${created.status} ${messageOf(created.body)}`);

    if (orderId) {
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

      const [before] = await h.q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]);
      const paid = await h.api(`/orders/${orderId}/pay-with-wallet`, {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': `wlr-pay-${h.nextTag()}` },
      });
      await sleep(1500);
      const [state] = await h.q(`SELECT payment_status FROM orders WHERE id = $1`, [orderId]);
      const afterPay = await balanceOf(customer.userId);
      h.record(
        '**٢/ب العميل دفع الطلب من رصيد محفظته** — نفس الـendpoint اللي الويب بقى بيستخدمه',
        paid.status === 200 || paid.status === 201,
        `HTTP=${paid.status} الطلب=${egp(Number(before.total_amount_cents))} حالة الدفع=${state?.payment_status} الرصيد بعدها=${afterPay === null ? '—' : egp(afterPay)} ${messageOf(paid.body)}`,
      );
    }

    // ═══ ٣ الأدمن بينزّل الرصيد بعد تحويل بنكي يدوي ═══
    const remaining = (await balanceOf(customer.userId)) ?? 0;
    if (remaining > 0) {
      const debited = await h.api(`/admin/wallets/${customer.userId}/adjust`, {
        method: 'PATCH',
        token: admin.token,
        headers: await stepUpHeaders(),
        body: { amount_cents: remaining, direction: 'debit', reason_ar: 'اتحوّلت للعميل على حسابه البنكي' },
      });
      const afterDebit = await balanceOf(customer.userId);
      h.record(
        '**٣/أ «عايز فلوسي على البنك»: الأدمن بينزّل الرقم لصفر بسبب مسجّل**',
        debited.status === 200 && afterDebit === 0,
        `HTTP=${debited.status} ${egp(remaining)} → ${afterDebit === null ? '—' : egp(afterDebit)} ${messageOf(debited.body)}`,
      );
      const [audited] = await h.q(
        `SELECT action FROM audit_logs WHERE action LIKE '%wallet%' ORDER BY created_at DESC LIMIT 1`,
      );
      h.record('٣/ب التعديل متسجّل في سجل النشاط', !!audited, `آخر حدث=${audited?.action ?? 'مفيش'}`);
    }

    // ═══ ٤ نقاط الولاء: قيمة حقيقية ═══
    const quote0 = await h.api('/wallet/loyalty-redemption', { token: customer.token });
    h.record(
      '٤/أ عرض الاستبدال شغّال وبيقول السعر والحد الأدنى',
      quote0.status === 200 && quote0.body?.data?.points_per_egp > 0,
      `HTTP=${quote0.status} سعر=${quote0.body?.data?.points_per_egp} حد أدنى=${quote0.body?.data?.min_redeem_points}`,
    );

    // نمنح نقاط مباشرةً (الاكتساب من الطلبات مختبَر في مكان تاني؛ اللي بيتقاس هنا الاستبدال).
    await h.q(`UPDATE customer_profiles SET loyalty_points_balance = 250 WHERE user_id = $1`, [customer.userId]);
    const quote = await h.api('/wallet/loyalty-redemption', { token: customer.token });
    const perEgp = quote.body?.data?.points_per_egp ?? 10;
    h.record(
      '٤/ب بيحسب المتاح كمضاعفات السعر مش كسور',
      quote.body?.data?.redeemable_points === 250 - (250 % perEgp),
      `رصيد=250 متاح=${quote.body?.data?.redeemable_points} قيمته=${egp(quote.body?.data?.redeemable_value_cents ?? 0)}`,
    );

    const badPoints = await h.api('/wallet/loyalty-redemption', {
      method: 'POST',
      token: customer.token,
      body: { points: 105 },
    });
    h.record(
      '٤/ج عدد مش من مضاعفات السعر بيترفض برسالة مفهومة (مش بيضيع كسر)',
      badPoints.status === 400,
      `HTTP=${badPoints.status} ${messageOf(badPoints.body)}`,
    );

    const redeem = await h.api('/wallet/loyalty-redemption', {
      method: 'POST',
      token: customer.token,
      body: { points: 200 },
    });
    const walletAfter = (await balanceOf(customer.userId)) ?? 0;
    const [pointsAfter] = await h.q(
      `SELECT loyalty_points_balance FROM customer_profiles WHERE user_id = $1`,
      [customer.userId],
    );
    h.record(
      '**٤/د الاستبدال بيدّي رصيد محفظة حقيقي** — النقاط بقى ليها قيمة',
      redeem.status === 200 &&
        Number(pointsAfter.loyalty_points_balance) === 50 &&
        walletAfter === Math.round((200 / perEgp) * 100),
      `HTTP=${redeem.status} نقاط=250→${pointsAfter.loyalty_points_balance} رصيد=${egp(walletAfter)} ${messageOf(redeem.body)}`,
    );

    const overRedeem = await h.api('/wallet/loyalty-redemption', {
      method: 'POST',
      token: customer.token,
      body: { points: 1000 },
    });
    h.record(
      '٤/هـ استبدال أكتر من الرصيد بيترفض — مفيش رصيد سالب',
      overRedeem.status === 400,
      `HTTP=${overRedeem.status} ${messageOf(overRedeem.body)}`,
    );

    // ═══ ٥ روابط QR بتحوّل مش بتطلّع نص خام ═══
    const [techRow] = await h.q(`SELECT technician_code FROM technician_profiles WHERE id = $1`, [tech.id]);
    const summary = await h.api('/technician/referrals', { token: tech.token });
    const shareUrl = summary.body?.data?.share_url;
    h.record(
      '**٥/أ ملخّص ترشيح الفني بيرجّع رابط مشاركة** — الـQR بقى يشفّره بدل التوكن الخام',
      typeof shareUrl === 'string' && shareUrl.includes('/t/'),
      `HTTP=${summary.status} رابط=${shareUrl ?? 'مفيش'}`,
    );

    const followed = await fetch(`${API_ROOT}/t/${encodeURIComponent(techRow.technician_code)}`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36' },
    });
    const location = followed.headers.get('location') ?? '';
    h.record(
      '**٥/ب مسح الـQR بيحوّل لوجهة شغّالة بالكود** — مش صفحة خطأ ولا رقم خام',
      followed.status === 302 && location.length > 0 && location.includes('tref='),
      `HTTP=${followed.status} → ${location}`,
    );

    // ═══ ٦ رشّح صحابك end-to-end ═══
    const mine = await h.api('/me/referrals', { token: customer.token });
    const code = mine.body?.data?.referral_code;
    h.record(
      '٦/أ العميل عنده كود ترشيح جاهز',
      mine.status === 200 && typeof code === 'string' && code.length > 0,
      `HTTP=${mine.status} كود=${code ?? 'مفيش'}`,
    );

    // الصاحب بيستخدم الكود **وقت التسجيل** (مفيش مسار بعدي) — فالتدقيق بيمشي التسجيل الحقيقي.
    const friend = await registerWithReferral(h, code);
    h.record('٦/ب التسجيل بكود صاحبه نجح', !friend.error, friend.error ?? `user=${friend.userId}`);
    if (friend.userId) {
      // الربط بيتم في listener **بعد** رد التسجيل (التسجيل مايستناش القياس عمدًا) — فالقراءة
      // الفورية بترجع فاضية. الانتظار هنا بيقيس السلوك الحقيقي مش بيداري عليه.
      let link;
      for (let i = 0; i < 10 && !link; i += 1) {
        await sleep(500);
        [link] = await h.q(
          `SELECT referrer_user_id FROM referrals WHERE referred_user_id = $1`,
          [friend.userId],
        );
      }
      h.record(
        '**٦/ج صاحبه اترتبط بيه فعلاً** — ده أساس المكافأة كلها',
        !!link && link.referrer_user_id === customer.userId,
        `مرتبط بـ=${link?.referrer_user_id === customer.userId ? 'صح' : (link?.referrer_user_id ?? 'مفيش')}`,
      );
      const badCode = await registerWithReferral(h, 'ZZZZZZ');
      h.record(
        '٦/د كود ترشيح غلط بيترفض وقت التسجيل (مش بيعدّي بصمت)',
        !!badCode.error,
        badCode.error ?? 'الحساب اتعمل رغم الكود الغلط!',
      );
    }
  } finally {
    await h.q(
      `DELETE FROM order_assignments WHERE order_id IN (SELECT id FROM orders WHERE problem_description LIKE $1)`,
      ['WLR %'],
    );
    await h.deleteOrders(`problem_description LIKE $1`, ['WLR %']);
    await h.cleanup();
    const failed = h.failures;
    console.log(`\n--- الخلاصة ---\n${h.results.length - failed.length}/${h.results.length} نجحوا`);
    if (failed.length) process.exitCode = 1;
    await h.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
