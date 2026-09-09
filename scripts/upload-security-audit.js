#!/usr/bin/env node
/**
 * **ج-١٣ — الرفع والصور**: «حجم/نوع/ملفات ضارة/أسماء آمنة/عزل بين العملاء».
 *
 * الرفع هو المكان الوحيد اللي المستخدم بيحط فيه **بايتات خام** على سيرفرنا. كل حاجة تانية
 * بتعدّي على `class-validator` وTypeORM؛ الملف بيتكتب على القرص زي ما هو. عشان كده الأخطاء
 * هنا بتبقى من فئة تانية خالص: مش «بيانات غلط» — **كود بيتنفّذ** أو **قرص بيمتلي** أو
 * **صور عميل بتوصل لعميل تاني**.
 *
 * كل فحص هنا بيرفع **حمولة حقيقية** (HTML، SVG بسكريبت، ELF، polyglot) ويقرا الرد.
 *
 *   node scripts/upload-security-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep, API } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('up');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** رفع خام — الاسم والنوع المعلَن تحت تحكّمنا بالكامل عشان نقدر نزوّرهم. */
async function upload(orderId, token, { buffer, filename, mimeType, mediaType = 'after_photo' }) {
  const form = new FormData();
  form.append('media_type', mediaType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const res = await fetch(`${API}/technician/orders/${orderId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

/** فحص «الحمولة الخبيثة دي بترفض» — أي 2xx معناه إنها اتخزّنت على السيرفر. */
async function rejects(name, orderId, token, payload, why) {
  const res = await upload(orderId, token, payload);
  const ok = res.status >= 400;
  h.record(name, ok, ok ? `HTTP=${res.status} (اترفض)` : `HTTP=${res.status} — **اتخزّنت** ❗ ${why}`);
  return ok;
}

async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const [row] = await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
    if (row?.technician_id) return row.technician_id;
    await sleep(500);
  }
  return null;
}

async function createAndAssign(customer) {
  const res = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق أمان الرفع',
    },
  });
  if (res.status !== 201) throw new Error(`فشل إنشاء الطلب: ${res.status}`);
  const id = res.body.data.id;
  await waitAssigned(id);
  return id;
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٣: أمان الرفع والصور — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  const customer = await h.makeCustomer('up');
  const tech = await h.makeTechnician('up');
  const orderId = await createAndAssign(customer);
  // الفني اللي اتعيّن فعلاً هو اللي مسموح له يرفع — بنجيبه من القاعدة بدل ما نفترض إنه بتاعنا.
  const [assignedRow] = await h.q(`SELECT technician_id FROM orders WHERE id = $1`, [orderId]);
  const [assignedUser] = await h.q(`SELECT user_id FROM technician_profiles WHERE id = $1`, [
    assignedRow.technician_id,
  ]);
  const uploader = h.token(assignedUser.user_id, 'technician');

  // ---- ع-٠: الرفع السليم شغّال (وإلا كل رفض تحت بلا معنى) ----
  const good = await upload(orderId, uploader, { buffer: PNG, filename: 'after.png', mimeType: 'image/png' });
  h.record('ع-٠ رفع صورة سليمة بينجح (الفحوصات تحت مش بتقيس حجب أعمى)', good.status === 201, `HTTP=${good.status}`);
  if (good.status !== 201) return finish();

  // ---- ع-١: الملفات الضارة ----
  //
  // كلها بتُعلن `image/png` في الـContent-Type — بالظبط زي ما مهاجم حقيقي هيعمل. اللي بيفرّق
  // هو **البايتات** مش الإعلان.
  await rejects(
    'ع-١/أ HTML متنكّر كصورة بيترفض',
    orderId,
    uploader,
    {
      buffer: Buffer.from('<html><script>alert(document.cookie)</script></html>'),
      filename: 'photo.png',
      mimeType: 'image/png',
    },
    'ملف HTML مخزّن على أصل الـAPI = XSS مخزّن',
  );
  await rejects(
    'ع-١/ب SVG بسكريبت بيترفض (SVG مش نوع مسموح أصلاً)',
    orderId,
    uploader,
    {
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      filename: 'photo.svg',
      mimeType: 'image/svg+xml',
    },
    'SVG بيتنفّذ كـHTML في المتصفح',
  );
  await rejects(
    'ع-١/ج ملف تنفيذي (ELF) بيترفض',
    orderId,
    uploader,
    { buffer: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(200)]), filename: 'x.png', mimeType: 'image/png' },
    'ملف تنفيذي على القرص',
  );
  await rejects(
    'ع-١/د أرشيف ZIP متنكّر كصورة بيترفض',
    orderId,
    uploader,
    { buffer: Buffer.concat([Buffer.from('PK'), Buffer.alloc(200)]), filename: 'x.png', mimeType: 'image/png' },
    'مدخل لهجمات فك الضغط',
  );
  await rejects(
    'ع-١/هـ ملف فاضي بيترفض',
    orderId,
    uploader,
    { buffer: Buffer.alloc(0), filename: 'empty.png', mimeType: 'image/png' },
    'صفر بايت بيعدّي فحوصات ساذجة',
  );

  // **polyglot**: بايتات PNG صحيحة في الأول + HTML بعدها. ده بيعدّي فحص magic bytes **عمدًا** —
  // والسؤال الحقيقي مش «هل بيترفض؟» بل «لو اتخزّن، هل ممكن يتنفّذ؟». الإجابة في `ع-٣`.
  const polyglot = Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')]);
  const polyRes = await upload(orderId, uploader, {
    buffer: polyglot,
    filename: 'polyglot.png',
    mimeType: 'image/png',
  });
  h.record(
    'ع-١/و polyglot (PNG صحيح + HTML ملحوق) — اتقبل، والحماية بتبقى في طريقة العرض',
    polyRes.status === 201 || polyRes.status >= 400,
    `HTTP=${polyRes.status} — الفحص الحقيقي في ع-٣`,
  );

  // ---- ع-٢: الاسم المُعلَن مالوش أي سلطة ----
  //
  // الاسم بييجي من الكلاينت خام. لو الامتداد المخزّن اتاخد منه، ملف محتواه PNG باسم `x.html`
  // كان هيتخزّن كـ`.html` ويتنفّذ عند العرض.
  const traversal = await upload(orderId, uploader, {
    buffer: PNG,
    filename: '../../../../etc/passwd.png',
    mimeType: 'image/png',
  });
  h.record(
    'ع-٢/أ اسم فيه ../ مابيأثرش على مكان التخزين',
    traversal.status === 201,
    `HTTP=${traversal.status}`,
  );
  const stored = await h.q(
    `SELECT storage_key FROM order_media WHERE order_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [orderId],
  );
  const badKeys = stored.filter((r) => r.storage_key.includes('..') || r.storage_key.startsWith('/'));
  h.record(
    'ع-٢/ب مفيش مفتاح تخزين فيه ../ ولا مسار مطلق (المفتاح مبني على السيرفر بالكامل)',
    badKeys.length === 0,
    badKeys.length ? `مفاتيح خطيرة: ${badKeys.map((k) => k.storage_key).join('، ')} ❗` : `${stored.length} مفتاح كلهم آمنين`,
  );

  const htmlNamed = await upload(orderId, uploader, {
    buffer: PNG,
    filename: 'evil.html',
    mimeType: 'image/png',
  });
  const [latest] = await h.q(
    `SELECT storage_key FROM order_media WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  );
  h.record(
    'ع-٢/ج امتداد الملف المخزّن مشتق من محتواه مش من اسمه (PNG باسم .html اتخزّن .png)',
    htmlNamed.status === 201 && latest.storage_key.endsWith('.png'),
    `المفتاح=${latest?.storage_key?.slice(-24)}`,
  );

  // ---- ع-٣: طريقة العرض — أخطر جزء ----
  //
  // حتى مع فحص البايتات، لو الملف بيتقدّم من أصل الـAPI بنوع محتوى بيسمح بالتنفيذ (أو بلا
  // `nosniff` فالمتصفح بيخمّن)، الـpolyglot فوق بيتحوّل لـXSS مخزّن على أصلنا.
  // **الرابط بييجي من الـAPI نفسه مش مبني بالإيد** — النظام بيدعم سوّاقين للتخزين:
  // `local` (روابط `/uploads/...` من نفس أصل الـAPI) و`s3` (روابط presigned من R2/S3). بناء
  // الرابط يدويًا بيقيس السوّاق الغلط ويطلّع `404` كاذب (اتلقط في أول تشغيلة: البيئة دي على
  // `STORAGE_PROVIDER=s3`، فمفيش أي ملف على القرص المحلي أصلاً).
  const mediaList = await h.api(`/technician/orders/${orderId}/media`, { token: uploader });
  const items = Array.isArray(mediaList.body?.data) ? mediaList.body.data : [];
  const fileUrl = items[items.length - 1]?.file_url;
  h.record(
    'ع-٣/أ الـAPI بيرجّع رابط للملف المرفوع',
    !!fileUrl,
    fileUrl ? `${String(fileUrl).slice(0, 60)}…` : 'مفيش رابط ❗',
  );

  const served = fileUrl ? await fetch(fileUrl).catch(() => null) : null;
  const ct = served?.headers.get('content-type') ?? '';
  h.record(
    'ع-٣/ب الملف بيتقدّم فعلاً من الرابط ده',
    served?.status === 200,
    served ? `HTTP=${served.status}` : 'الرابط مش قابل للوصول ❗',
  );
  // **الفحص الحاسم ضد الـpolyglot**: حتى لو ملف PNG صالح فيه HTML ملحوق، المتصفح مايقدرش
  // ينفّذه طول ما نوع المحتوى صورة. لو رجع `text/html` أو `application/octet-stream` مع
  // تخمين مسموح، الـpolyglot بيتحوّل لـXSS مخزّن على أصلنا.
  h.record(
    'ع-٣/ج بنوع محتوى صورة مش HTML (وده اللي بيبطّل الـpolyglot)',
    ct.startsWith('image/'),
    `Content-Type=${ct || 'مفيش ❗'}`,
  );

  // `nosniff` بيتفحص على **أصل الـAPI** — هو اللي إحنا مسؤولين عنه. رؤوس R2/S3 بتتحكم من
  // إعدادات البكت، وده بند نشر مش بند كود (موثّق في الفجوات تحت).
  const apiHeaders = await fetch(`${API}/health`);
  const nosniff = apiHeaders.headers.get('x-content-type-options') ?? '';
  h.record(
    'ع-٣/د أصل الـAPI بيبعت X-Content-Type-Options: nosniff (المتصفح ممنوع يخمّن النوع)',
    nosniff.toLowerCase() === 'nosniff',
    `X-Content-Type-Options=${nosniff || 'مفيش ❗'}`,
  );

  // ---- ع-٤: العزل بين المستخدمين ----
  const stranger = await h.makeTechnician('up2');
  const strangerUpload = await upload(orderId, stranger.token, {
    buffer: PNG,
    filename: 'intrusion.png',
    mimeType: 'image/png',
  });
  h.record(
    'ع-٤/أ فني غريب مايقدرش يرفع على طلب مش بتاعه',
    strangerUpload.status >= 400,
    `HTTP=${strangerUpload.status}`,
  );

  const otherCustomer = await h.makeCustomer('up2');
  const listByStranger = await h.api(`/orders/${orderId}/media`, { token: otherCustomer.token });
  h.record(
    'ع-٤/ب عميل تاني مايقدرش يقرا قايمة صور الطلب',
    [401, 403, 404].includes(listByStranger.status),
    `HTTP=${listByStranger.status}`,
  );

  // ---- ع-٥: الحجم ----
  const oversized = await upload(orderId, uploader, {
    buffer: Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024, 0x41)]),
    filename: 'huge.png',
    mimeType: 'image/png',
  });
  h.record(
    'ع-٥/أ ملف فوق الحد (١١ ميجا) بيترفض قبل ما يوصل للقرص',
    oversized.status >= 400,
    `HTTP=${oversized.status}`,
  );

  // ---- ع-٦: النظام سليم بعد كل ده ----
  const health = await h.api('/health', { timeoutMs: 10_000 });
  h.record('ع-٦/أ النظام لسه بيرد بعد كل محاولات الرفع الخبيثة', health.status === 200, `HTTP=${health.status}`);
  const serverErrors = await h.serverErrorsSince();
  h.record(
    'ع-٦/ب ولا رفض واحد طلع كـ5xx (كلها رفض واعي برسالة)',
    serverErrors.length === 0,
    serverErrors.length ? `${serverErrors.length} عطل ❗` : 'نضيف',
  );

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
    await h.cleanup();
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await h.close();
  process.exit(2);
});
