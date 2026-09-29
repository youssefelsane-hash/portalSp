#!/usr/bin/env node
/**
 * تحقق حي (API + Postgres حقيقيين) من بيانات العرض الإضافية — docs/08 §185.
 *
 * خدمة شبه المكوجي: نوع أساسي إجباري + عدّاد قمصان + «نوع الخدمة للقمصان» بافتراضي
 * `same_as_main` + عدّاد تيشيرتات بشرح طويل، ومدة تشغيلية = دقيقة واحدة (زي المغسلة).
 * العميل بيحجز من المسار الحقيقي (`POST /orders`) بقيمة كسرية زي النسخ القديمة من التطبيق،
 * وبعدين بنقرا الطلب زي ما الفني والعميل بيشوفوه ونتأكد من:
 *   ١. `customer_inputs` فيها النوع/الإجباري/الافتراضي/العدّاد الصحيح — والقيمة المخزّنة زي ما هي.
 *   ٢. العنوان للفني فيه العمارة/الدور/الشقة/ملاحظات الوصول/المستلم **بس** جوّه سياسة الظهور.
 *   ٣. `duration_minutes` بيفضل 1 للجدولة (العرض هو اللي بيخفيه، مش البيانات).
 *   ٤. العميل صاحب العنوان بيشوف تفاصيله.
 *
 *   THROTTLE_LIMIT=100000 node dist/main.js   # في apps/api
 *   node scripts/verify-customer-inputs-display.js
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('cid');
  await h.connect();
  try {
    const catalog = await h.seedCatalog({ priceCents: 20_000, durationMinutes: 60 });
    const serviceId = catalog.service.id;
    await h.q(
      `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
       VALUES ($1,'formula','final_price',$2,1, now(), true)`,
      [
        serviceId,
        JSON.stringify({
          price_cents: { type: 'literal', value: 20000 },
          // المغسلة: دقيقة واحدة عمدًا عشان الـscheduler مايعتبرهاش مشغولة ساعات.
          duration_minutes: { type: 'literal', value: 1 },
        }),
      ],
    );
    const sameAsMain = JSON.stringify([
      { value: 'same_as_main', label_ar: 'نفس الخدمة الأساسية' },
      { value: 'dry_clean_iron', label_ar: 'دراي كلين + كي' },
    ]);
    const mainOptions = JSON.stringify([
      { value: 'iron_only', label_ar: 'كي فقط' },
      { value: 'wash_iron', label_ar: 'غسيل + كي' },
    ]);
    await h.q(
      `INSERT INTO service_pricing_fields
         (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, options, min_value, max_value, default_value)
       VALUES
         ($1,'main_type','نوع الخدمة الأساسي','dropdown',true,1,NULL,$2::jsonb,NULL,NULL,NULL),
         ($1,'shirts','عدد القمصان','slider',false,2,'قميص',NULL,0,15,NULL),
         ($1,'shirts_type','نوع الخدمة للقمصان','dropdown',false,3,NULL,$3::jsonb,NULL,NULL,'same_as_main'),
         ($1,'tshirts','عدد التيشيرتات','slider',false,4,'(حدد إجمالي عدد التيشيرتات والبولو في الطلب.)',NULL,0,15,NULL)`,
      [serviceId, mainOptions, sameAsMain],
    );

    const customer = await h.makeCustomer('c');
    await h.q(
      `UPDATE addresses SET building_number='15', floor_number='3', apartment_number='7', landmark='جنب شركة الكهرباء',
              delivery_notes='الجرس مش شغال، كلمني قبل ما تطلع', contact_name='مدام سعاد', contact_phone='+201011111111'
        WHERE id = $1`,
      [customer.addressId],
    );
    const tech = await h.makeTechnician('t');

    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `cid-${h.runId}` },
      body: {
        service_id: serviceId,
        address_id: customer.addressId,
        booking_mode: 'individual',
        scheduled_at: h.bookableScheduledAt(3),
        customer_notes: 'هاسيب الهدوم مع البواب',
        // قيمة كسرية زي نسخ التطبيق القديمة (1.0.7/1.0.8) + افتراضيين بعتهم العميل صراحةً.
        field_values: { main_type: 'wash_iron', shirts: 1.9639846991701237, shirts_type: 'same_as_main', tshirts: 0 },
      },
    });
    if (created.status >= 400) {
      throw new Error(`الحجز فشل ${created.status}: ${JSON.stringify(created.body?.error)}`);
    }
    const orderId = created.body.data.id;
    h.record('الحجز من المسار الحقيقي بيعدّي', true, created.body.data.order_number);

    // الطلب على الفني — بيانات العرض هي المختبرة هنا، مش المطابقة.
    await h.q(`UPDATE orders SET technician_id = $2, order_status = 'accepted' WHERE id = $1`, [orderId, tech.id]);

    const asTech = await h.api(`/technician/orders/${orderId}`, { token: tech.token });
    const order = asTech.body?.data ?? {};
    const byKey = Object.fromEntries((order.customer_inputs ?? []).map((i) => [i.key, i]));
    h.record(
      'النوع الأساسي: إجباري ومش افتراضي',
      byKey.main_type?.field_type === 'dropdown' && byKey.main_type?.is_required === true && byKey.main_type?.is_default === false,
      JSON.stringify(byKey.main_type),
    );
    h.record(
      'القمصان: عدّاد صحيح، والقيمة الكسرية القديمة متخزّنة زي ما هي (العرض بيقرّبها)',
      byKey.shirts?.integer_quantity === true && byKey.shirts?.value === '1.9639846991701237' && byKey.shirts?.is_default === false,
      JSON.stringify(byKey.shirts),
    );
    h.record(
      '«نفس الخدمة الأساسية» علامتها افتراضي — الفني مش محتاج يقراها',
      byKey.shirts_type?.is_default === true && byKey.shirts_type?.value === 'نفس الخدمة الأساسية',
      JSON.stringify(byKey.shirts_type),
    );
    h.record(
      'تيشيرتات = 0 على حقل اختياري افتراضيه الصفر ⇒ افتراضي',
      byKey.tshirts?.is_default === true && byKey.tshirts?.is_required === false,
      JSON.stringify(byKey.tshirts),
    );
    const address = order.address ?? {};
    h.record(
      'العنوان للفني (accepted): العمارة والدور والشقة وملاحظات الوصول والمستلم',
      address.building_number === '15' &&
        address.floor_number === '3' &&
        address.apartment_number === '7' &&
        address.delivery_notes === 'الجرس مش شغال، كلمني قبل ما تطلع' &&
        address.contact_phone === '+201011111111',
      JSON.stringify(address),
    );
    h.record('الملاحة لسه بالإحداثيات', typeof address.latitude === 'number' && typeof address.longitude === 'number', `${address.latitude},${address.longitude}`);
    h.record('ملاحظات العميل راجعة للفني', order.customer_notes === 'هاسيب الهدوم مع البواب', String(order.customer_notes));
    h.record('duration_minutes = 1 فاضل للجدولة', order.duration_minutes === 1, String(order.duration_minutes));

    // برّه سياسة ظهور بيانات العميل (قبل القبول): الشارع للملاحة بس.
    await h.q(`UPDATE orders SET order_status = 'technician_assigned' WHERE id = $1`, [orderId]);
    const beforeAccept = await h.api(`/technician/orders/${orderId}`, { token: tech.token });
    if (beforeAccept.status === 200) {
      const a = beforeAccept.body.data.address ?? {};
      h.record(
        'قبل القبول: الشقة وتليفون المستلم مش بيطلعوا للفني',
        a.apartment_number === null && a.contact_phone === null && a.delivery_notes === null && typeof a.latitude === 'number',
        JSON.stringify(a),
      );
    } else {
      h.record('قبل القبول: الطلب مش متاح للفني أصلًا (أقوى من الإخفاء)', beforeAccept.status === 404 || beforeAccept.status === 403, String(beforeAccept.status));
    }

    const asCustomer = await h.api(`/orders/${orderId}`, { token: customer.token });
    const ca = asCustomer.body?.data?.address ?? {};
    h.record('العميل صاحب العنوان بيشوف تفاصيله كاملة', ca.apartment_number === '7' && ca.contact_name === 'مدام سعاد', JSON.stringify(ca));
    h.record(
      'العميل بياخد نفس الـmetadata (additive)',
      (asCustomer.body?.data?.customer_inputs ?? []).every((i) => 'is_default' in i && 'label' in i && 'value' in i),
      String(asCustomer.body?.data?.customer_inputs?.length),
    );
  } finally {
    await h.cleanup();
    await h.close();
  }
  const failures = h.failures;
  console.log(failures.length === 0 ? `\n${h.results.length}/${h.results.length} فحص نضيف 🟢` : `\n${failures.length} فحص فشل 🔴`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
