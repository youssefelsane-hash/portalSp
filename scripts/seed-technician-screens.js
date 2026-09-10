#!/usr/bin/env node
/**
 * بذرة بيانات لمسح شاشات تطبيق الفني (`apps/technician-app/test_live/all_screens_smoke_live_test.dart`).
 *
 * **ليه سكريبت منفصل بدل ما الاختبار يعمل ده بنفسه**: إنشاء فني معتمد محتاج صفوف في
 * `technician_profiles` و`technician_services` و`technician_zones` وكتالوج كامل ورا الـAPI —
 * وده كله موجود ومختبَر أصلاً في `scripts/lib/live-harness.js`. تكراره بـDart كان هيبقى نسخة
 * تانية من نفس المنطق تتعتّق لوحدها. السكريبت بيكتب ملف JSON، والاختبار بيقراه.
 *
 * الاستخدام:
 *   node scripts/seed-technician-screens.js /tmp/tech-seed.json
 */
const fs = require('fs');
const { LiveHarness } = require('./lib/live-harness');

(async () => {
  const outPath = process.argv[2] || '/tmp/tech-seed.json';
  const h = new LiveHarness('tsc');
  await h.connect();
  try {
    await h.seedCatalog();
    const tech = await h.makeTechnician('scr');
    const customer = await h.makeCustomer('scr');

    // طلب حقيقي معيَّن للفني ده — شاشة تنفيذ الطلب من غيره مالهاش أي محتوى تعرضه.
    const created = await h.api('/orders', {
      method: 'POST',
      token: customer.token,
      headers: { 'Idempotency-Key': `tsc-${h.nextTag()}` },
      body: {
        service_id: h.catalog.service.id,
        address_id: customer.addressId,
        problem_description: 'مسح شاشات الفني — طلب اختبار',
      },
    });
    if (created.status >= 400) throw new Error(`فشل إنشاء الطلب: ${JSON.stringify(created.body).slice(0, 300)}`);
    const orderId = created.body.data.id;

    // التعيين مباشرةً في القاعدة: المسح بيختبر **الشاشات**، مش محرك المطابقة (اللي ليه
    // تدقيقاته الخاصة). التعيين اليدوي بيخلّي البذرة حتمية بدل ما تعتمد على توفّر فني.
    await h.q(
      `UPDATE orders SET technician_id = $1, order_status = 'accepted', updated_at = NOW() WHERE id = $2`,
      [tech.id, orderId],
    );

    const payload = {
      technicianUserId: tech.userId,
      technicianId: tech.id,
      technicianToken: tech.token,
      orderId,
      serviceId: h.catalog.service.id,
      customerUserId: customer.userId,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`✅ البذرة اتكتبت في ${outPath}`);
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await h.close();
  }
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
