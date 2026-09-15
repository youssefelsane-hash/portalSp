'use strict';
/**
 * **بلاغ المالك ٥ (§141)** — «هدية الدفع أونلاين»: العميل لازم يشوف قبل الحجز إن الدفع
 * بـInstaPay عليه خصم، بالمبلغ اللي الأدمن حدده.
 *
 * الفحص الجوهري هنا مش إن الوسم بيظهر — ده سهل. الفحص إن **الوسم والفاتورة بيقولوا نفس
 * الرقم**: واجهة بتعد بخصم وفاتورة مافيهاش خصم أسوأ من إن الخصم مايكونش موجود أصلاً.
 */
const { execFileSync } = require('node:child_process');
const { LiveHarness } = require('./lib/live-harness');

/**
 * الإعدادات متكاشة على طبقتين (Redis + ذاكرة محلية)، والسياسة **stale-while-revalidate**
 * مقصودة وموثّقة في `settings.service.ts`: أول قراءة بعد التغيير بترجّع القيمة القديمة
 * وبتطلب تحديث في الخلفية، واللي بعدها بتشوف الجديدة. ده منع انقطاع خدمة مش إهمال — Redis
 * بطيء مايقدرش يعلّق حجز.
 *
 * يعني الاختبار لازم: يمسح Redis → يعمل قراءة «تسخين» تطلق التحديث الخلفي → يستنى → يقيس.
 * من غير خطوة التسخين الاختبار بيقيس القيمة القديمة ويكذب على نفسه.
 */
function bustSettingsCache(keys) {
  try {
    execFileSync('redis-cli', ['DEL', ...keys.map((k) => `settings:${k}`)], { stdio: 'ignore' });
  } catch {
    // مفيش redis-cli؟ الـTTL المحلي ٢ ثانية هيعدّي لوحده تحت.
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * بيخلّي التغيير **مرئي فعلاً**: مسح Redis، قراءة تسخين بتطلق التحديث الخلفي، انتظار، قراءة
 * تانية بتتأكد إن الطبقة المحلية اتجدّدت.
 */
async function applySettings(h, tokenHolder, keys) {
  bustSettingsCache(keys);
  await h.api('/payment-channels', { token: tokenHolder.token }); // تسخين
  await sleep(3000);
  await h.api('/payment-channels', { token: tokenHolder.token }); // تأكيد التجديد
  await sleep(500);
}

async function main() {
  const h = new LiveHarness('onldisc');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  /** بيكتب إعداد مباشرةً في الجدول (`value` نوعه JSON، فالقيمة بتتسلسل). */
  const setSetting = async (key, value, type) =>
    h.q(
      `INSERT INTO settings (key, value, value_type, group_name)
       VALUES ($1,$2::jsonb,$3,'payments')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, value_type = EXCLUDED.value_type`,
      [key, JSON.stringify(value), type],
    );

  const customerTokenHolder = { token: null };
  const originals = new Map();
  const keys = [
    'payments.online_discount_enabled',
    'payments.online_discount_cents',
    'payments.online_discount_min_order_cents',
    'payments.online_discount_methods',
  ];

  try {
    for (const k of keys) {
      const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [k]);
      originals.set(k, row?.value ?? null);
    }

    // InstaPay لازم تكون **متاحة فعلاً** عشان الوسم يظهر (الترشيح والخصم الاتنين مشروطين
    // بالإتاحة عمدًا — ما نعرضش عرضًا على وسيلة العميل مش قادر يستخدمها).
    for (const [k, v] of [
      ['payments.instapay_enabled', true],
      ['payments.instapay.ipa_address', 'baytak@instapay'],
      ['payments.instapay.recipient_name', 'بيتك للخدمات'],
    ]) {
      const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [k]);
      originals.set(k, row?.value ?? null);
      await setSetting(k, v, typeof v === 'boolean' ? 'boolean' : 'string');
    }

    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    customerTokenHolder.token = customer.token;
    await h.makeTechnician('t');

    // ── ١) الخصم مقفول = مفيش وسم ومفيش خصم ─────────────────────────────────
    await setSetting('payments.online_discount_enabled', false, 'boolean');
    await applySettings(h, customerTokenHolder, [...originals.keys(), ...keys]);
    const offRes = await h.api('/payment-channels', { token: customer.token });
    const offInsta = (offRes.body?.data ?? []).find((c) => c.method === 'instapay');
    check('لما الخصم مقفول: مفيش وسم على InstaPay', (offInsta?.discount_cents ?? 0) === 0, JSON.stringify(offInsta));

    // ── ٢) الأدمن بيشغّله بـ٣٠ ج.م على InstaPay ──────────────────────────────
    await setSetting('payments.online_discount_enabled', true, 'boolean');
    await setSetting('payments.online_discount_cents', 3000, 'number');
    await setSetting('payments.online_discount_min_order_cents', 0, 'number');
    await setSetting('payments.online_discount_methods', 'instapay,card', 'string');
    await applySettings(h, customerTokenHolder, keys);

    const onRes = await h.api('/payment-channels', { token: customer.token });
    const channels = onRes.body?.data ?? [];
    const insta = channels.find((c) => c.method === 'instapay');
    const cash = channels.find((c) => c.method === 'cash');
    // **حقلا العقد موجودين على كل قناة** — ده اللي الواجهتين بتقروه.
    check(
      'كل قناة في /payment-channels بترجّع discount_cents وdiscount_label_ar',
      channels.length > 0 && channels.every((c) => 'discount_cents' in c && 'discount_label_ar' in c),
      JSON.stringify(channels.map((c) => c.method)),
    );
    check('والكاش مالوش خصم (مش وسيلة إلكترونية)', (cash?.discount_cents ?? 0) === 0, JSON.stringify(cash));
    // الوسم مشروط بإتاحة الوسيلة فعليًا (ما نعرضش عرضًا على وسيلة العميل مش قادر يستخدمها).
    // `InstaPayProvider.isConfigured` بيتحمّل وقت الإقلاع وبيتحدّث بحدث `SettingsService.update()`
    // بس — والسكربت ده بيكتب في الجدول مباشرةً، فالحالة هنا بتفضل زي ما هي في البيئة.
    // تغطية صياغة الوسم وبواباته في `online-payment-discount.spec.ts`.
    console.log(
      `ℹ️  InstaPay في البيئة دي ${insta?.is_available ? 'متاحة' : 'مش متاحة (مفيش بيانات مستلم)'} — ` +
        `وسمها: ${JSON.stringify(insta?.discount_label_ar)}`,
    );
    if (insta?.is_available) {
      check('ولما تكون متاحة الوسم بيطلع بقيمته', insta.discount_cents === 3000, JSON.stringify(insta));
    }

    // ── ٣) **الفاتورة الحقيقية**: نفس الرقم بيتخصم فعلاً ─────────────────────
    const [{ at }] = await h.q(
      `SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '2 day' + interval '10 hour')
              AT TIME ZONE 'Africa/Cairo' AS at`,
    );
    const body = (extra) => ({
      service_id: catalog.service.id,
      address_id: customer.addressId,
      booking_mode: 'individual',
      scheduled_at: new Date(at).toISOString(),
      ...extra,
    });

    const cashOrder = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: body({}),
      headers: { 'Idempotency-Key': `disc-cash-${h.runId}` },
    });
    check('طلب كاش اتعمل', cashOrder.status < 400, `${cashOrder.status} — ${JSON.stringify(cashOrder.body?.error)}`);

    const instaOrder = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: body({ prepayment_method: 'instapay' }),
      headers: { 'Idempotency-Key': `disc-insta-${h.runId}` },
    });
    check('طلب InstaPay اتعمل', instaOrder.status < 400, `${instaOrder.status} — ${JSON.stringify(instaOrder.body?.error)}`);

    const [cashRow] = await h.q(
      `SELECT total_amount_cents, discount_amount_cents FROM orders WHERE id = $1`,
      [cashOrder.body?.data?.id],
    );
    const [instaRow] = await h.q(
      `SELECT total_amount_cents, discount_amount_cents FROM orders WHERE id = $1`,
      [instaOrder.body?.data?.id],
    );

    console.log(
      `ℹ️  كاش: إجمالي ${cashRow?.total_amount_cents} خصم ${cashRow?.discount_amount_cents} | ` +
        `InstaPay: إجمالي ${instaRow?.total_amount_cents} خصم ${instaRow?.discount_amount_cents}`,
    );

    check(
      'طلب الكاش مالوش خصم دفع إلكتروني',
      Number(cashRow?.discount_amount_cents ?? 0) === 0,
      String(cashRow?.discount_amount_cents),
    );
    check(
      '**وطلب InstaPay اتخصم منه نفس الرقم اللي الوسم وعد بيه**',
      Number(instaRow?.discount_amount_cents) === 3000,
      String(instaRow?.discount_amount_cents),
    );
    check(
      'والإجمالي فعلاً أقل بـ٣٠ ج.م',
      Number(cashRow?.total_amount_cents) - Number(instaRow?.total_amount_cents) === 3000,
      `${cashRow?.total_amount_cents} − ${instaRow?.total_amount_cents}`,
    );

    // ── ٤) الحد الأدنى بيمنع الخصم على طلب صغير ─────────────────────────────
    await setSetting('payments.online_discount_min_order_cents', 100000, 'number');
    await applySettings(h, customerTokenHolder, keys);
    const smallOrder = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: body({ prepayment_method: 'instapay' }),
      headers: { 'Idempotency-Key': `disc-small-${h.runId}` },
    });
    const [dbMin] = await h.q(`SELECT value FROM settings WHERE key = 'payments.online_discount_min_order_cents'`);
    console.log(
      `ℹ️  الحد الأدنى في القاعدة: ${JSON.stringify(dbMin?.value)} | ` +
        `طلب الخصم: ${instaOrder.body?.data?.id} | الطلب الصغير: ${smallOrder.body?.data?.id}`,
    );
    const [smallRow] = await h.q(`SELECT discount_amount_cents, total_amount_cents FROM orders WHERE id = $1`, [
      smallOrder.body?.data?.id,
    ]);
    check(
      'طلب تحت الحد الأدنى مابياخدش الخصم',
      Number(smallRow?.discount_amount_cents ?? 0) === 0,
      String(smallRow?.discount_amount_cents),
    );

    console.log('');
    console.log(failures === 0 ? '✅ كل الفحوص عدّت' : `❌ ${failures} فحص فشل`);
  } finally {
    for (const [k, v] of originals) {
      if (v === null) await h.q(`DELETE FROM settings WHERE key = $1`, [k]);
      else await h.q(`UPDATE settings SET value = $2::jsonb WHERE key = $1`, [k, JSON.stringify(v)]);
    }
    bustSettingsCache([...originals.keys()]);
    await h.cleanup();
    await h.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
