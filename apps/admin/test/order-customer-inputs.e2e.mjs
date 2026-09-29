// اختبار محلي End-to-End (docs/08 §185): طلب حقيقي عبر API العميل ⇒ صفحة الطلب في لوحة الأدمن.
// نفس بيئة `pricing-field-default.e2e.mjs` المعزولة (قاعدة اختبار + API + أدمن بمفتاح مرور افتراضي).
//
// بيثبت إن الأدمن **بيستهلك** اللي الـAPI بقى بيبعته:
//   - اختيارات العميل صفوف منظمة (مش سطر `·`)، الافتراضي مطوي، وشرح الأدمن الطويل مابيتعرضش كوحدة.
//   - عدّاد صحيح مسجّل بكسر من نسخة تطبيق قديمة بيتعرض مقرّب **ومعاه القيمة المسجّلة**.
//   - العنوان فيه العمارة/الدور/الشقة وملاحظات الوصول.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { LiveHarness, LIVE_TEST_PIN } = require('../../../scripts/lib/live-harness.js');
const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3301';
for (const url of [adminUrl, process.env.API_BASE_URL, process.env.DATABASE_URL]) {
  assert.ok(url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local test services only');
}
assert.match(new URL(process.env.DATABASE_URL).pathname, /audit|test/, 'Use a disposable test database');
const h = new LiveHarness('oci');
let browser;

try {
  await h.connect();
  await h.seedCatalog();
  const serviceId = h.catalog.service.id;
  await h.q(
    `INSERT INTO service_pricing_rules (service_id, rule_type, rule_key, payload, display_order, valid_from, is_active)
     VALUES ($1,'formula','final_price','{"price_cents":{"type":"literal","value":25000},"duration_minutes":{"type":"literal","value":1}}',1, now(), true)`,
    [serviceId],
  );
  await h.q(
    `INSERT INTO service_pricing_fields
       (service_id, field_key, label_ar, field_type, is_required, display_order, unit_ar, options, min_value, max_value, default_value)
     VALUES
       ($1,'main_type','نوع الخدمة الأساسي','dropdown',true,1,NULL,
        '[{"value":"wash_iron","label_ar":"غسيل + كي"},{"value":"iron_only","label_ar":"كي فقط"}]'::jsonb,NULL,NULL,NULL),
       ($1,'shirts','عدد القمصان','slider',false,2,'قميص',NULL,0,15,NULL),
       ($1,'tshirts','عدد التيشيرتات','slider',false,3,'(حدد إجمالي عدد التيشيرتات والبولو في الطلب.)',NULL,0,15,NULL)`,
    [serviceId],
  );
  const customer = await h.makeCustomer('c');
  await h.q(
    `UPDATE addresses SET building_number='15', floor_number='3', apartment_number='7', landmark='جنب شركة الكهرباء',
            delivery_notes='الجرس مش شغال، كلمني قبل ما تطلع' WHERE id = $1`,
    [customer.addressId],
  );
  // قيمة كسرية زي نسخ التطبيق ≤ 1.0.8 — عشان نشوف الأدمن بيقول الحقيقة.
  const created = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `oci-${h.runId}` },
    body: {
      service_id: serviceId,
      address_id: customer.addressId,
      booking_mode: 'individual',
      scheduled_at: h.bookableScheduledAt(3),
      field_values: { main_type: 'wash_iron', shirts: 1.9639846991701237, tshirts: 0 },
    },
  });
  assert.ok(created.status < 400, `order ${created.status}: ${JSON.stringify(created.body?.error)}`);
  const orderId = created.body.data.id;

  const admin = await h.makeAdmin();
  const [{ phone_number: phone }] = await h.q('SELECT phone_number FROM users WHERE id = $1', [admin.userId]);
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(`${adminUrl}/login`);
  await page.locator('#phone_number').fill(phone);
  await page.locator('#pin').fill(LIVE_TEST_PIN);
  await page.locator('button[type="submit"]').click();
  await page.getByRole('button', { name: /سجّل Passkey دلوقتي/ }).click();
  await page.locator('#ack').check();
  await page.getByRole('button', { name: /كمّل|الإدارة/ }).click();
  await page.waitForURL((url) => url.pathname === '/');

  await page.goto(`${adminUrl}/orders/${orderId}`);
  const inputsBlock = page.locator('div', { hasText: 'اختيارات العميل وقت الحجز' }).filter({ has: page.locator('ul') }).last();
  await inputsBlock.waitFor();
  const text = (await inputsBlock.innerText()).replace(/\s+/g, ' ');
  assert.ok(text.includes('نوع الخدمة الأساسي') && text.includes('غسيل + كي'), text);
  assert.ok(text.includes('2 قميص'), `rounded integer quantity: ${text}`);
  assert.ok(text.includes('مسجّلة: 1.9639846991701237'), `stored value shown to admin: ${text}`);
  assert.ok(text.includes('1 اختيار على الإعداد الافتراضي'), `defaults folded: ${text}`);
  assert.ok(!text.includes('حدد إجمالي'), `admin helper text is not rendered as a unit: ${text}`);
  assert.ok(!text.includes(' · '), 'no single dotted paragraph');
  console.log('PASS: admin order page renders structured customer inputs (defaults folded, stored value visible)');

  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  assert.ok(body.includes('عمارة 15 · الدور 3 · شقة 7'), 'unit line');
  assert.ok(body.includes('ملاحظات الوصول: الجرس مش شغال، كلمني قبل ما تطلع'), 'delivery notes');
  assert.ok(body.includes('جنب شركة الكهرباء'), 'landmark');
  console.log('PASS: admin order page shows building/floor/apartment, landmark and delivery notes');

  // طلب قديم: snapshot بلا metadata + عنوان بلا تفاصيل ⇒ صفحة الأدمن شغّالة بدون سطور فاضية.
  await h.q(
    `UPDATE orders SET customer_inputs = '[{"key":"shirts","label":"عدد القمصان","value":"3","unit":"قميص"}]'::jsonb WHERE id = $1`,
    [orderId],
  );
  await h.q(`UPDATE addresses SET building_number=NULL, floor_number=NULL, apartment_number=NULL, delivery_notes=NULL WHERE id=$1`, [
    customer.addressId,
  ]);
  await page.reload();
  await page.getByText('اختيارات العميل وقت الحجز').waitFor();
  const legacyBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  assert.ok(legacyBody.includes('3 قميص'), 'legacy snapshot renders');
  assert.ok(!legacyBody.includes('اختيار على الإعداد الافتراضي'), 'no default claims without metadata');
  assert.ok(!legacyBody.includes('ملاحظات الوصول'), 'no empty delivery notes line');
  assert.ok(!/عمارة\s*·|شقة\s*$/.test(legacyBody), 'no empty unit line');
  assert.deepEqual(errors, [], `browser page errors: ${errors.join(' | ')}`);
  console.log('PASS: legacy order (no metadata, old address) renders without empty rows or errors');
} finally {
  await browser?.close();
  await h.cleanup();
  await h.close();
}
