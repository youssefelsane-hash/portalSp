/**
 * **تحقّق حي: كل جنيه في `total_amount_cents` مفسَّر، والشرح تاريخي** (ADR-0107).
 *
 * بلاغ مالك 2026-09-17: «أريد هذا الـbreakdown أن يكون historical/auditable. تغيير zone
 * percentage أو pricing tier settings بعد أسبوع لا يجب أن يغيّر تفسير طلب قديم».
 *
 * الاختبار بيعمل **طلب حقيقي** عبر الـAPI بمنطقة عليها نسبة وفني بفئة مهارة لها مضاعف، يقرا
 * `GET /admin/orders/:id/price-trail`، وبعدها **يغيّر الإعدادات** ويقرا تاني — الشرح لازم
 * يفضل حرفيًا نفسه.
 *
 *   node scripts/verify-order-price-trail.js   # محتاج API شغّال
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);
const egp = (c) => `${(c / 100).toFixed(2)} ج.م`;

/** إعدادات InstaPay اللي التدقيق بيضبطها مؤقتًا ويرجّعها بعد كده. */
const INSTAPAY_KEYS = ['payments.instapay.ipa_address', 'payments.instapay.recipient_name'];

async function main() {
  const h = new LiveHarness('trl');
  await h.connect();
  let failures = 0;
  const originalSettings = new Map();
  try {
    await h.seedCatalog({ priceCents: 100_000, durationMinutes: 180 });
    const serviceId = h.catalog.service.id;
    const zoneId = h.catalog.zone.id;
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t', { level: 'premium' });
    /*
      **فئة مهارة التسعير هي المصدر التجاري، مش المستوى التشغيلي.**

      `technician_profiles.pricing_tier` افتراضيها `'standard'`، و`resolveLevelPriceMultiplier`
      بتفضّل الفئة الصريحة على تحويل المستوى (التحويل احتياطي للكوللرز اللي مش عارفة الفئة).
      فني `premium` فئته لسه `standard` لحد ما الأدمن يغيّرها — والاختبار الأول هنا كان بيفترض
      إن المستوى بيتحوّل، وده كان **خطأ في الافتراض مش في الكود**.
    */
    await h.q(`UPDATE technician_profiles SET pricing_tier = 'expert' WHERE id = $1`, [tech.id]);
    const admin = await h.makeEmployee(['orders.view', 'catalog.manage'], 'ops');

    // منطقة عليها +10%، وفئة الخبير ×1.25 (الفني premium → فئة expert)
    await h.q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage,
         inspection_fee_cents, is_active, valid_from)
       VALUES ($1,$2,'percentage',10.00,15000,true, now() - interval '1 day')`,
      [serviceId, zoneId],
    );
    await h.q(
      `INSERT INTO service_pricing_tier_pricing (service_id, pricing_tier, price_multiplier, is_active)
       VALUES ($1,'expert',1.25,true)`,
      [serviceId],
    );

    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(9, 0, 0, 0);

    // طلب باختيار فني يدوي ⇒ المضاعف داخل السعر من الأول
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: serviceId,
        address_id: customer.addressId,
        scheduled_at: tomorrow.toISOString(),
        requested_technician_id: tech.id,
        problem_description: 'TRAIL اختبار مسار السعر',
      },
    });
    const orderId = created.body.data?.id;
    ok(!!orderId, 'الطلب اتعمل', `status=${created.status} ${orderId ?? created.body.error?.message ?? ''}`);
    if (!orderId) {
      failures += 1;
      return;
    }

    const readTrail = async () => {
      const res = await h.api(`/admin/orders/${orderId}/price-trail`, { token: admin.token });
      return { status: res.status, trail: res.body.data ?? res.body };
    };

    const first = await readTrail();
    ok(first.status === 200 && first.trail.formation_snapshot_available === true, 'اللقطة اتسجّلت على الطلب', `status=${first.status} snapshot=${first.trail?.formation_snapshot_available}`);
    if (!(first.status === 200 && first.trail.formation_snapshot_available === true)) failures += 1;

    const stage = (key) => first.trail.stages.find((s) => s.key === key);
    const raw = stage('engine_raw');
    const zone = stage('zone_adjustment');
    const tier = stage('pricing_tier_multiplier');

    ok(
      raw?.amount_cents === 100_000,
      'المرحلة ١ — ناتج المحرك الخام ظاهر لوحده (مش مدفون في السعر)',
      `${egp(raw?.amount_cents ?? 0)}`,
    );
    if (raw?.amount_cents !== 100_000) failures += 1;

    ok(
      zone?.applied === true && zone?.amount_cents === 10_000,
      'المرحلة ٢ — تعديل المنطقة +10% بقيمته',
      `${zone?.detail_ar}`,
    );
    if (!(zone?.applied === true && zone?.amount_cents === 10_000)) failures += 1;

    ok(
      tier?.applied === true && tier?.amount_cents === 27_500,
      'المرحلة ٣ — مضاعف فئة المهارة ×1.25 بقيمته',
      `${tier?.detail_ar}`,
    );
    if (!(tier?.applied === true && tier?.amount_cents === 27_500)) failures += 1;

    // **كل جنيه مفسَّر**
    const [row] = await h.q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]);
    ok(
      first.trail.reconciles === true && first.trail.current_total_cents === Number(row.total_amount_cents),
      '**مجموع المراحل = الإجمالي المسجّل على الطلب بالظبط**',
      `المراحل=${egp(first.trail.total_at_booking_cents)} · المسجّل=${egp(Number(row.total_amount_cents))} · غير مفسَّر=${egp(first.trail.unexplained_cents)}`,
    );
    if (!(first.trail.reconciles === true && first.trail.current_total_cents === Number(row.total_amount_cents))) {
      failures += 1;
    }

    // ═══ الشرح تاريخي: نغيّر الإعدادات ونقرا تاني ═══
    await h.q(`UPDATE service_zone_pricing SET modifier_percentage = 90.00 WHERE service_id = $1`, [serviceId]);
    await h.q(`UPDATE service_pricing_tier_pricing SET price_multiplier = 3.00 WHERE service_id = $1`, [serviceId]);
    const second = await readTrail();
    const unchanged = JSON.stringify(second.trail) === JSON.stringify(first.trail);
    ok(
      unchanged,
      '**تغيير نسبة المنطقة (10%→90%) ومضاعف الفئة (1.25→3.00) مالهومش أي أثر على شرح الطلب القديم**',
      unchanged
        ? 'الشرح حرفيًا نفسه'
        : `اتغير! منطقة=${second.trail.stages.find((s) => s.key === 'zone_adjustment')?.amount_cents} مضاعف=${second.trail.stages.find((s) => s.key === 'pricing_tier_multiplier')?.amount_cents}`,
    );
    if (!unchanged) failures += 1;

    // وطلب **جديد** بنفس الإعدادات الجديدة بياخد الأرقام الجديدة (اللقطة مش تجميد للنظام كله)
    const created2 = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      body: {
        service_id: serviceId,
        address_id: customer.addressId,
        scheduled_at: tomorrow.toISOString(),
        requested_technician_id: tech.id,
        problem_description: 'TRAIL طلب بعد تغيير الإعدادات',
      },
    });
    const newOrderId = created2.body.data?.id;
    if (newOrderId) {
      const res = await h.api(`/admin/orders/${newOrderId}/price-trail`, { token: admin.token });
      const t = res.body.data ?? res.body;
      const newZone = t.stages.find((s) => s.key === 'zone_adjustment');
      ok(
        newZone?.amount_cents === 90_000,
        'والطلب الجديد بياخد الإعدادات الجديدة (+90%) — اللقطة لكل طلب لوحده',
        `${newZone?.detail_ar}`,
      );
      if (newZone?.amount_cents !== 90_000) failures += 1;
    }

    /*
      ═══ حافز InstaPay: خصم بعد الحجز، وممنوع يتحسب مرتين (بلاغ مالك 2026-09-17) ═══

      الأدمن كان بيشوف «غير مفسّر 30 ج» على طلب عليه حافز. السبب إن
      `instapay_discount_cents` **جزء من** `discount_amount_cents`، فطرح العمود كله كخصم حجز
      + إظهار الحافز تحت = تحصيل مزدوج. هنا بنمشي المسار الحقيقي (إعداد الحافز + نداء
      `pay-with-instapay` الحقيقي) مش بنكتب الأعمدة بالإيد.
    */
    await h.setSetting('payments.instapay_discount_egp', 30);
    // InstaPay مابيبقاش «مُهيّأ» غير لما العنوان واسم المستلم موجودين (`provider.isConfigured`)،
    // وإلا النداء بيرجع 503 قبل ما يوصل للحافز أصلاً. القيمتين دول نص تعليمات للعميل مش سر.
    // بناخد نسخة من القيم الأصلية ونرجّعها في `finally` — التدقيق مايسيبش بيئة متغيّرة وراه.
    for (const key of INSTAPAY_KEYS) {
      const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [key]);
      if (row) originalSettings.set(key, row.value);
    }
    await h.setSetting('payments.instapay.ipa_address', 'trail.audit@instapay');
    await h.setSetting('payments.instapay.recipient_name', 'تدقيق مسار السعر');
    const beforeInstapay = Number(
      (await h.q(`SELECT total_amount_cents FROM orders WHERE id = $1`, [orderId]))[0].total_amount_cents,
    );
    const pay = await h.api(`/orders/${orderId}/pay-with-instapay`, {
      method: 'POST',
      token: customer.token,
      headers: { 'idempotency-key': `trail-instapay-${orderId}` },
    });
    const [afterRow] = await h.q(
      `SELECT total_amount_cents, discount_amount_cents, instapay_discount_cents FROM orders WHERE id = $1`,
      [orderId],
    );
    const granted = Number(afterRow.instapay_discount_cents);
    ok(
      granted === 3_000 && Number(afterRow.total_amount_cents) === beforeInstapay - 3_000,
      'الحافز اتطبّق فعلاً من المسار الحقيقي (مش كتابة أعمدة بالإيد)',
      `status=${pay.status} حافز=${egp(granted)} إجمالي=${egp(beforeInstapay)}→${egp(Number(afterRow.total_amount_cents))}`,
    );
    if (!(granted === 3_000 && Number(afterRow.total_amount_cents) === beforeInstapay - 3_000)) failures += 1;

    const withInstapay = await readTrail();
    const instapayEntry = withInstapay.trail.post_booking.find((c) => c.key === 'instapay_discount');
    const bookingDiscountStage = withInstapay.trail.stages.find((s) => s.key === 'discount');
    const explainedOnce =
      withInstapay.trail.reconciles === true &&
      withInstapay.trail.unexplained_cents === 0 &&
      instapayEntry?.amount_cents === -3_000 &&
      bookingDiscountStage?.amount_cents === 0;
    ok(
      explainedOnce,
      '**الحافز مفسَّر مرة واحدة بس**: خصم الحجز صفر، الحافز تحت بقيمته، وصفر غير مفسَّر',
      `خصم حجز=${egp(bookingDiscountStage?.amount_cents ?? 0)} · حافز=${egp(instapayEntry?.amount_cents ?? 0)} · غير مفسَّر=${egp(withInstapay.trail.unexplained_cents)}`,
    );
    if (!explainedOnce) failures += 1;

    ok(
      withInstapay.trail.total_at_booking_cents === beforeInstapay,
      'وإجمالي وقت الحجز فضل هو الإجمالي قبل الحافز (الحافز مش خصم حجز)',
      `${egp(withInstapay.trail.total_at_booking_cents)} = ${egp(beforeInstapay)}`,
    );
    if (withInstapay.trail.total_at_booking_cents !== beforeInstapay) failures += 1;

    // ═══ توزيع المستحقات مش في المسار ═══
    const keys = [...first.trail.stages.map((s) => s.key), ...first.trail.post_booking.map((c) => c.key)];
    const noEarnings = !keys.some((k) => /earning|assistant|commission|pool/.test(k));
    ok(noEarnings, 'توزيع المستحقات مش ظاهر كعامل رفع سعر العميل', keys.join(', '));
    if (!noEarnings) failures += 1;
  } finally {
    // العروض بتتولّد تلقائيًا للطلب (التوزيع)، والحذف الآمن بيقف على الـFK بتاعها — فبنشيلها
    // الأول. مفيش منطق جديد، ترتيب تنضيف بس.
    await h.q(
      `DELETE FROM order_assignments WHERE order_id IN
         (SELECT id FROM orders WHERE problem_description LIKE $1)`,
      ['TRAIL %'],
    );
    await h.deleteOrders(`problem_description LIKE $1`, ['TRAIL %']);
    for (const [key, value] of originalSettings) await h.setSetting(key, value);
    await h.cleanup();
    await h.close();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ كل مرحلة ظاهرة بقيمتها، المجموع = الإجمالي، والشرح تاريخي.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
