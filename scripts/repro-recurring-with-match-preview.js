'use strict';
/**
 * **بلاغ المالك ١ (§141)**: «لما أضيف طلبات متكررة بيجيلي إن فيه خطأ والكاستمر مايقدرش يحجز.
 * مجرد ما أشيل التكرار وأخليه مرة واحدة، الخطأ بيروح.»
 *
 * الفرضية: العميل بيعدّي على المطابقة التلقائية (فبتتعمل تذكرة `match_preview_id`)، وبعدين
 * يختار «أسبوعي» — والإنشاء بيرفض الجمع بين التذكرة والتكرار.
 *
 * السكربت بيثبت السيناريو **الكامل زي ما العميل بيعمله**: معاينة → اختيار منفّذ → إنشاء،
 * مرة بلا تكرار (لازم تعدّي) ومرة بتكرار (دي اللي المالك بيشتكي منها).
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('recur');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    // التكرار متاح للخدمة دي (شرط `service.allowsRecurringBooking`)
    await h.q(`UPDATE services SET allows_recurring_booking = true WHERE id = $1`, [catalog.service.id]);
    const customer = await h.makeCustomer('c');
    await h.makeTechnician('t');

    // موعد بكرة الساعة ١٠ صباحًا بتوقيت القاهرة
    const [{ at }] = await h.q(
      `SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '2 day' + interval '10 hour')
              AT TIME ZONE 'Africa/Cairo' AS at`,
    );
    const scheduledAt = new Date(at).toISOString();

    const previewBody = {
      service_id: catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: scheduledAt,
    };

    // ── ١) المعاينة (المطابقة التلقائية) ────────────────────────────────────
    const preview = await h.api('/orders/match-preview', {
      method: 'POST',
      token: customer.token,
      body: { ...previewBody, selection_mode: 'auto' },
    });
    check('المعاينة بترجع مرشّحين', preview.status === 200 || preview.status === 201, `رجع ${preview.status} — ${JSON.stringify(preview.body?.error)}`);
    // الرد كائن واحد (تذكرة + المنفّذ المثبّت)، مش قايمة مرشّحين.
    const previewId = preview.body?.data?.match_preview_id;
    check('المعاينة رجّعت تذكرة بمنفّذ مثبّت', Boolean(previewId), JSON.stringify(preview.body?.data ?? null).slice(0, 300));
    if (!previewId) throw new Error('مفيش تذكرة — الباقي مالوش معنى');

    const createBody = (extra) => ({
      ...previewBody,
      booking_mode: 'individual',
      match_preview_id: previewId,
      ...extra,
    });

    // ── ٢) بلا تكرار: لازم يعدّي (ده اللي المالك بيقول إنه شغال) ─────────────
    const plain = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: createBody({}),
      headers: { 'Idempotency-Key': `recur-plain-${h.runId}` },
    });
    check(
      'الحجز بلا تكرار بيعدّي',
      plain.status === 200 || plain.status === 201,
      `رجع ${plain.status} — ${JSON.stringify(plain.body?.error)}`,
    );

    // ── ٣) بتكرار: ده البلاغ ────────────────────────────────────────────────
    const preview2 = await h.api('/orders/match-preview', {
      method: 'POST',
      token: customer.token,
      body: { ...previewBody, selection_mode: 'auto' },
    });
    const previewId2 = preview2.body?.data?.match_preview_id;

    const repeated = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: createBody({ match_preview_id: previewId2, repeat_frequency: 'weekly' }),
      headers: { 'Idempotency-Key': `recur-weekly-${h.runId}` },
    });
    const ok = repeated.status === 200 || repeated.status === 201;
    check(
      'الحجز **بتكرار أسبوعي** بيعدّي كمان (ده اللي المالك بلّغ عنه)',
      ok,
      `رجع ${repeated.status} — ${JSON.stringify(repeated.body?.error?.message)}`,
    );

    if (ok) {
      const orderId = repeated.body?.data?.id;
      const [tpl] = await h.q(
        `SELECT frequency, requested_technician_id, requested_technician_company_id, next_run_at, is_active
           FROM recurring_order_templates WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [customer.profileId],
      );
      check('واتعمل قالب متكرر فعلاً', Boolean(tpl), 'مفيش قالب');
      check('تكراره أسبوعي', tpl?.frequency === 'weekly', String(tpl?.frequency));
      check(
        'والمنفّذ المثبّت في التذكرة اتنقل للقالب (نفس الفني كل أسبوع)',
        Boolean(tpl?.requested_technician_id || tpl?.requested_technician_company_id),
        JSON.stringify({ t: tpl?.requested_technician_id, c: tpl?.requested_technician_company_id }),
      );
      const [order] = await h.q(`SELECT technician_id, requested_technician_id FROM orders WHERE id = $1`, [orderId]);
      check('والطلب الأول نفسه اتربط بالمنفّذ المثبّت', Boolean(order?.requested_technician_id), JSON.stringify(order));
    }

    console.log('');
    console.log(failures === 0 ? '✅ كل الفحوص عدّت' : `❌ ${failures} فحص فشل`);
  } finally {
    await h.cleanup();
    await h.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
