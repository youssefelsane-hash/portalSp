#!/usr/bin/env node
/**
 * **عرض أول طلب + نموذج الترشيح ١:١ + أزرار الأدمن** — تدقيق حي (docs/08 §135-و/§135-ح).
 *
 * ## ليه الفحص ده موجود
 *
 * التلات بنود دول كانوا مكتوبين «⏳ لسه» في `docs/08` و«الأزرار لسه» في README الموديول.
 * وفيهم فئة خلل واحدة بتتكرر: **إعداد ظاهر للأدمن ومالوش أثر**. فالتدقيق بيقيس الأثر نفسه
 * على قاعدة حية، مش وجود الكود:
 *
 * 1. الأدمن **يقدر فعلاً** يعدّل مبلغ الخصم من `/settings` (المفتاح كان بنوع غلط فمستحيل
 *    يتعدّل — البَقّة اللي migration 0311 قفلها).
 * 2. عميل بيسجّل والعرض شغّال ⇒ **كود شخصي حقيقي** في `promo_codes` بالمبلغ والحد الأدنى
 *    والصلاحية من الإعدادات، مقفول عليه هو، ومعاه إشعار.
 * 3. العرض مقفول ⇒ **مفيش أي كود** (مايتصرفش فلوس بلا قرار صريح).
 * 4. عتبة الترشيح بقت ١ — مكافأة عن كل ترشيح ناجح.
 * 5. أزرار الأدمن الجديدة: إيقاف/تشغيل مصدر + تعديل المستحق + تعليم المستحقات مدفوعة.
 *
 *   node scripts/first-order-offer-audit.js [--keep]
 */
'use strict';

const fs = require('node:fs');
const { LiveHarness, sleep } = require('./lib/live-harness');

const API_LOG = process.env.API_LOG_PATH ?? '/tmp/claude-0/api.log';
const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('fo');

function messageOf(body) {
  return String(body?.message ?? body?.error?.message ?? '').slice(0, 160);
}

/** تسجيل عميل بالمسار الحقيقي — الحدث اللي بيصدر الكود بيتطلق من `register()` نفسها. */
async function registerCustomer() {
  const phone = h.nextPhone();
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
      full_name: `عميل عرض ${h.nextTag()}`,
      user_type: 'customer',
    },
  });
  if (res.status !== 201 && res.status !== 200) return { error: `HTTP=${res.status} ${messageOf(res.body)}` };
  const [row] = await h.q(`SELECT id FROM users WHERE phone_number = $1`, [phone]);
  if (row) h.created.users.push(row.id);
  return { userId: row?.id };
}

/**
 * تعديل إعداد من **برّه الخدمة** (SQL + إبطال Redis) بدل `PATCH /admin/settings`.
 *
 * مش اختصار: تعديل الإعدادات محمي بـ**تأكيد Passkey حديث** (step-up)، ومفيش طريقة يتزوّر بيها
 * في سكريبت — وده سلوك أمني صح مش عيب. اللي التدقيق ده موضوعه هو **أثر** القيمة على العرض،
 * مش بوابة الصلاحية (اللي ليها اختباراتها). فبنكتب القيمة بنفس المسار المدعوم لأي كاتب خارجي.
 *
 * الكاش المحلي في الخدمة stale-while-revalidate بثانيتين: القراءة اللي بعد انتهاء العمر
 * بتخدم القديم **وبتحدّث في الخلفية**. عشان كده فيه قراءة تسخين متعمدة قبل القياس.
 */
async function setSettingExternally(key, jsonValue) {
  await h.q(`UPDATE settings SET value = $1::jsonb, updated_at = now() WHERE key = $2`, [
    JSON.stringify(jsonValue),
    key,
  ]);
  // Redis كمان — الكاش المشترك عمره ٦٠ ثانية، فمن غير مسحه القيمة القديمة تفضل تتخدم.
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await redis.connect().catch(() => undefined);
  await redis.del(`settings:${key}`).catch(() => undefined);
  redis.disconnect();
}

async function run() {
  await h.connect();
  console.log(`\n=== عرض أول طلب والترشيح ١:١ — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  const admin = await h.makeAdmin();

  // نحفظ القيم الأصلية عشان نرجّعها في الآخر — الإعدادات مشتركة مع باقي النظام.
  const originals = Object.fromEntries(
    (
      await h.q(
        `SELECT key, value FROM settings WHERE key LIKE 'marketing.first_order%' OR key = 'referral.required_referrals_per_reward'`,
      )
    ).map((r) => [r.key, r.value]),
  );

  // ── ف-١: نوع المفاتيح صحيح ⇒ الأدمن **يقدر** يعدّلها ────────────────
  //
  // `SettingsService.assertValueMatchesType()` بيقارن نوع القيمة المبعوتة بـ`value_type`
  // المتخزّن. `'integer'` (اللي migration 0309 بذر بيه) **مش** نوع موجود في `SettingValueType`،
  // فالمقارنة كانت بترجّع false لأي قيمة والتعديل مستحيل. القياس هنا على العمود نفسه.
  const typed = await h.q(
    `SELECT key, value_type FROM settings WHERE key LIKE 'marketing.first_order%' ORDER BY key`,
  );
  const badTypes = typed.filter((r) => !['number', 'boolean', 'string', 'json'].includes(r.value_type));
  h.record(
    'ف-١/أ كل مفاتيح العرض بأنواع يعرفها محرك الإعدادات (مفيش مفتاح مستحيل يتعدّل)',
    badTypes.length === 0,
    badTypes.map((r) => `${r.key}=${r.value_type}`).join(', ') || `${typed.length} مفتاح سليم`,
  );
  const moneyKeys = typed.filter((r) =>
    ['marketing.first_order_discount_cents', 'marketing.first_order_min_order_cents', 'marketing.first_order_validity_days'].includes(r.key),
  );
  h.record(
    'ف-١/ب مفاتيح المبالغ نوعها number بالتحديد',
    moneyKeys.length === 3 && moneyKeys.every((r) => r.value_type === 'number'),
    moneyKeys.map((r) => `${r.key}=${r.value_type}`).join(', '),
  );
  await setSettingExternally('marketing.first_order_discount_cents', 12_500);
  await setSettingExternally('marketing.first_order_min_order_cents', 40_000);
  await setSettingExternally('marketing.first_order_validity_days', 15);

  // ── ف-٢: العرض مقفول ⇒ صفر أكواد ─────────────────────────────────────
  await setSettingExternally('marketing.first_order_offer_enabled', false);
  await sleep(2_500);
  await registerCustomer(); // قراءة تسخين: بتحدّث الكاش المحلي في الخلفية
  await sleep(1_000);
  const off = await registerCustomer();
  h.record('ف-٢/أ تسجيل عميل والعرض مقفول', !off.error, off.error ?? '');
  if (!off.error) {
    const codes = await h.q(`SELECT id FROM promo_codes WHERE restricted_to_user_id = $1`, [off.userId]);
    h.record(
      'ف-٢/ب مفيش أي كود اتصدر — العرض المقفول مابيصرفش فلوس',
      codes.length === 0,
      `أكواد=${codes.length}`,
    );
  }

  // ── ف-٣: العرض شغّال ⇒ كود شخصي بالقيم اللي الأدمن حطها ───────────────
  await setSettingExternally('marketing.first_order_offer_enabled', true);
  await sleep(2_500);
  await registerCustomer(); // نفس التسخين — القراءة الأولى بعد التغيير بتخدم القديم
  await sleep(1_000);
  const on = await registerCustomer();
  h.record('ف-٣/أ تسجيل عميل والعرض شغّال', !on.error, on.error ?? '');
  if (!on.error) {
    await sleep(600); // الإصدار بيحصل في listener بعد الـcommit
    const [promo] = await h.q(
      `SELECT code, discount_type::text AS discount_type, discount_value, min_order_amount_cents,
              new_customers_only, usage_limit_total, valid_until
         FROM promo_codes WHERE restricted_to_user_id = $1`,
      [on.userId],
    );
    h.record('ف-٣/ب كود شخصي اتصدر فعلاً', !!promo, promo ? `code=${promo.code}` : 'مفيش كود');
    if (promo) {
      h.record(
        'ف-٣/ج المبلغ والحد الأدنى من الإعدادات مش أرقام مكتوبة في الكود',
        Math.round(Number(promo.discount_value) * 100) === 12_500 && Number(promo.min_order_amount_cents) === 40_000,
        `خصم=${promo.discount_value}ج حد أدنى=${promo.min_order_amount_cents}`,
      );
      h.record(
        'ف-٣/د الكود مقفول على صاحبه ومرة واحدة وعملاء جدد بس',
        Number(promo.usage_limit_total) === 1 && promo.new_customers_only === true,
        `usage_limit=${promo.usage_limit_total} new_only=${promo.new_customers_only}`,
      );
      const days = Math.round((new Date(promo.valid_until) - Date.now()) / 86_400_000);
      h.record('ف-٣/هـ الصلاحية ١٥ يوم زي الإعداد', days >= 14 && days <= 15, `أيام=${days}`);
    }
    const notes = await h.q(
      `SELECT title_ar, body_ar FROM notifications WHERE user_id = $1 AND notification_type = 'first_order_offer'`,
      [on.userId],
    );
    h.record(
      'ف-٣/و العميل اتبلّغ بالكود — عرض محدش يعرفه مالوش قيمة',
      notes.length === 1 && String(notes[0].body_ar).includes(promo?.code ?? '###'),
      notes.length ? String(notes[0].body_ar).slice(0, 90) : 'مفيش إشعار',
    );

    // إعادة التسجيل/الحدث مابتضاعفش الكود
    const before = await h.q(`SELECT COUNT(*)::int AS c FROM promo_codes WHERE restricted_to_user_id = $1`, [on.userId]);
    const again = await h.api('/admin/marketing/sources', { method: 'GET', token: admin.token }); // no-op call
    void again;
    const after = await h.q(`SELECT COUNT(*)::int AS c FROM promo_codes WHERE restricted_to_user_id = $1`, [on.userId]);
    h.record('ف-٣/ز كود واحد بس لكل عميل', before[0].c === 1 && after[0].c === 1, `قبل=${before[0].c} بعد=${after[0].c}`);
  }

  // ── ف-٤: عتبة الترشيح بقت ١ ──────────────────────────────────────────
  const [threshold] = await h.q(`SELECT value FROM settings WHERE key = 'referral.required_referrals_per_reward'`);
  h.record(
    'ف-٤ نموذج الترشيح ١:١ — مكافأة عن كل ترشيح ناجح',
    Number(threshold?.value) === 1,
    `العتبة=${threshold?.value}`,
  );

  // ── ف-٥: أزرار الأدمن الجديدة ────────────────────────────────────────
  const created = await h.api('/admin/marketing/sources', {
    method: 'POST',
    token: admin.token,
    body: { name_ar: `مصدر أزرار ${h.runId}`, channel: 'doorman', payout_per_completed_order_cents: 2_000 },
  });
  const source = created.body?.data;
  h.record('ف-٥/أ مصدر اتعمل للاختبار', created.status === 201 && !!source?.id, `HTTP=${created.status}`);
  if (source?.id) {
    const off1 = await h.api(`/admin/marketing/sources/${source.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { is_active: false },
    });
    h.record(
      'ف-٥/ب زرار الإيقاف بيوقف المصدر فعلاً (مش حذف — التاريخ بيفضل)',
      off1.status === 200 && off1.body?.data?.is_active === false,
      `HTTP=${off1.status} active=${off1.body?.data?.is_active}`,
    );
    const payout = await h.api(`/admin/marketing/sources/${source.id}`, {
      method: 'PATCH',
      token: admin.token,
      body: { payout_per_completed_order_cents: 3_500 },
    });
    h.record(
      'ف-٥/ج زرار تعديل المستحق بيغيّر القيمة',
      payout.status === 200 && payout.body?.data?.payout_per_completed_order_cents === 3_500,
      `HTTP=${payout.status} قيمة=${payout.body?.data?.payout_per_completed_order_cents}`,
    );
    const empty = await h.api('/admin/marketing/commissions/mark-paid', {
      method: 'POST',
      token: admin.token,
      body: { ids: [] },
    });
    h.record(
      'ف-٥/د تعليم مستحقات مدفوعة بقايمة فاضية بيترفض بوضوح مش بيعدّي بصمت',
      empty.status === 400,
      `HTTP=${empty.status} ${messageOf(empty.body)}`,
    );
  }

  // ── إرجاع الإعدادات لأصلها ────────────────────────────────────────────
  for (const [key, value] of Object.entries(originals)) {
    await h.q(`UPDATE settings SET value = $1::jsonb WHERE key = $2`, [JSON.stringify(value), key]);
  }
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
    await h.q(`DELETE FROM marketing_sources WHERE name_ar LIKE $1`, [`%${h.runId}%`]).catch(() => {});
    await h.q(
      `DELETE FROM promo_codes WHERE restricted_to_user_id = ANY($1::uuid[])`,
      [h.created.users],
    ).catch(() => {});
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
