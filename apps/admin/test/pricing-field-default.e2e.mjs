// اختبار محلي: واجهة أدمن وAPI وقاعدة حقيقيين، بمفتاح مرور افتراضي.
// شغّله بنفس بيئة الاختبار المعزولة للـAPI؛ ADMIN_URL لازم يطابق WEBAUTHN_ORIGIN.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const { LiveHarness, LIVE_TEST_PIN } = require('../../../scripts/lib/live-harness.js');
const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3301';
for (const url of [adminUrl, process.env.API_BASE_URL, process.env.DATABASE_URL]) {
  assert.ok(url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local test services only');
}
assert.match(new URL(process.env.DATABASE_URL).pathname, /audit|test/, 'Use a disposable test database');
const shots = mkdtempSync(join(tmpdir(), 'osta-pricing-default-'));
const h = new LiveHarness('pfd');
let browser;

try {
  await h.connect();
  await h.seedCatalog();
  const admin = await h.makeAdmin();
  const [{ phone_number: phone }] = await h.q('SELECT phone_number FROM users WHERE id = $1', [admin.userId]);
  const serviceId = h.catalog.service.id;
  browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : { channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
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
  console.log('PASS: real admin login with a virtual passkey');
  await page.goto(`${adminUrl}/catalog/services/${serviceId}`);

  async function save(name, method) {
    const response = page.waitForResponse((r) => r.url().includes('/pricing-fields') && r.request().method() === method);
    await page.getByRole('button', { name, exact: true }).click();
    const result = await response;
    assert.ok(result.ok(), `Field save HTTP ${result.status()}: ${await result.text()}`);
    await page.locator('#pf_key').waitFor({ state: 'hidden' });
    return (await result.json()).data;
  }
  async function add(key, type, max, value) {
    await page.getByRole('button', { name: '+ حقل جديد', exact: true }).click();
    await page.locator('#pf_key').fill(key);
    await page.locator('#pf_label').fill(key);
    await page.locator('#pf_type').selectOption(type);
    await page.locator('#pf_min').fill('0');
    await page.locator('#pf_max').fill(max);
    await page.getByLabel('حقل إجباري', { exact: true }).uncheck();
    await page.locator('#pf_default').fill(value);
    return save('إضافة الحقل', 'POST');
  }
  async function edit(key) {
    await page.getByRole('row').filter({ hasText: `(${key})` }).getByRole('button', { name: 'تعديل', exact: true }).click();
  }

  const number = await add('quantity', 'number', '100', '0');
  assert.equal(number.default_value, '0');
  await edit('quantity');
  assert.equal(await page.locator('#pf_default').inputValue(), '0');
  await page.getByRole('button', { name: 'إلغاء', exact: true }).click();
  console.log('PASS: number Min=0, Max=100, Default=0 create and edit round-trip');

  const slider = await add('shirts', 'slider', '10', '3');
  await page.reload();
  await edit('shirts');
  assert.equal(await page.locator('#pf_default').inputValue(), '3');
  await page.locator('#pf_default').fill('11');
  await page.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  assert.equal(await page.locator('#pf_default').evaluate((input) => input.validity.rangeOverflow), true);
  let stored = await h.api(`/admin/services/${serviceId}/pricing-fields`, { token: admin.token });
  assert.equal(stored.body.data.find((field) => field.id === slider.id).default_value, '3');
  await page.locator('#pf_default').fill('');
  const cleared = await save('حفظ التعديل', 'PATCH');
  assert.equal(cleared.default_value, null);
  console.log('PASS: slider edit reloads default, invalid value blocked, clearing persists null');

  const formula = { price_cents: { type: 'multiply', operands: [
    { type: 'field_ref', field_key: 'shirts' }, { type: 'literal', value: 200 },
  ] } };
  const rule = await h.api(`/admin/services/${serviceId}/pricing-rules`, {
    method: 'PUT', token: admin.token, body: { rule_key: 'final_price', rule_type: 'formula', payload: formula },
  });
  assert.equal(rule.status, 200, JSON.stringify(rule.body));
  async function evaluate(input, cents) {
    const response = await h.api(`/services/${serviceId}/evaluate-price`, { method: 'POST', body: { field_values: input } });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.price_cents, cents);
  }
  await evaluate({}, 0);
  await evaluate({ shirts: 5 }, 1000);
  await edit('shirts');
  await page.locator('#pf_default').fill('3');
  await save('حفظ التعديل', 'PATCH');
  await evaluate({}, 600);
  await evaluate({ shirts: 5 }, 1000);
  console.log('PASS: public pricing API uses min=0, then saved default=3, explicit value=5 always wins');

  const rejected = await h.api(`/admin/services/pricing-fields/${slider.id}`, {
    method: 'PATCH', token: admin.token, body: { default_value: '11' },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error.message, /القيمة الافتراضية/);
  await evaluate({}, 600);
  console.log('PASS: direct API rejects an invalid default without changing the saved value');
  await edit('shirts');
  await page.locator('#pf_default').scrollIntoViewIfNeeded();
  const desktopBounds = await page.locator('#pf_default').boundingBox();
  assert.ok(desktopBounds.width >= 200, 'Default input must remain usable in the desktop builder');
  await page.screenshot({ path: join(shots, 'desktop.png') });
  // لقطة تشخيصية فقط: الشريط الجانبي الحالي للوحة يضغط كل الصفحة عند 390px، خارج نطاق التعديل.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#pf_default').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(shots, 'mobile-admin.png') });
  assert.deepEqual(errors, []);
  stored = await h.api(`/admin/services/${serviceId}/pricing-fields`, { token: admin.token });
  assert.equal(stored.body.data.find((field) => field.id === number.id).default_value, '0');
  console.log(`PASS: desktop input layout; no browser page errors. Screenshots: ${shots}`);
} finally {
  await browser?.close();
  await h.cleanup();
  await h.close();
}
