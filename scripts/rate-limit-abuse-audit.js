#!/usr/bin/env node
/**
 * **ج-٩ — تحديد المعدّل وإساءة الاستخدام**: «OTP، تسجيل، كوبونات، دفع، رفع، إنشاء طلب».
 *
 * السؤال مش «فيه throttle؟» — `ThrottlerModule` مسجّل عالميًا فالإجابة «أيوه» بلا معنى. السؤال
 * الحقيقي تلات أسئلة:
 *   1. **بيتعدّ على مين؟** حد بالـIP في بلد نصّها على CGNAT بيقفل على الأبرياء ويسيب المهاجم.
 *   2. **بيصمد قد إيه؟** المسار الحسّاس (OTP) لازم سقفه أضيق بكتير من الافتراضي.
 *   3. **وبعد ما يقف، النظام سليم؟** الرفض لازم يبقى `429` برسالة مفهومة — مش `500` ولا تعليق.
 *
 * كل فحص هنا **بيقصف فعلاً** ويقرا الرد. تشغيل السكريبت بيستهلك حصص حقيقية، فبيستنى نافذة
 * الـTTL تعدّي بين المجموعات بدل ما يخلط نتيجة مجموعة بتالية.
 *
 * ⚠️ لازم API شغّال بإعدادات الـthrottle الافتراضية. لو شغّلته بـ`THROTTLE_LIMIT=100000`
 * (زي ما بعض التدقيقات التانية بتحتاج) الفحوصات دي هتفشل صح — شغّله عادي.
 *
 *   node scripts/rate-limit-abuse-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep, API } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('rl');

/**
 * قصف مسار بعدد نداءات **متتابعة** (مش متوازية) ويرجّع توزيع الأكواد.
 *
 * **التتابع مقصود**: التوازي بيقيس السباق على العدّاد مش السقف نفسه — الـ٥ نداءات ممكن
 * يعدّوا كلهم قبل ما أول واحد يكتب. القصف المتتابع بيقيس السقف كما هو معلن.
 */
async function hammer(pathname, { method = 'GET', token, body, headers, times = 12 } = {}) {
  const codes = [];
  for (let i = 0; i < times; i++) {
    const res = await h.api(pathname, {
      method,
      token,
      headers,
      body: typeof body === 'function' ? body(i) : body,
      timeoutMs: 20_000,
    });
    codes.push(res.status);
    if (res.status === 429) return { codes, firstBlockedAt: i + 1, lastBody: res.body };
  }
  return { codes, firstBlockedAt: null, lastBody: null };
}

/** نافذة الـthrottle الافتراضية ٦٠ ثانية — الانتظار ده بيمنع مجموعة تسمّم اللي بعدها. */
async function coolDown(seconds = 62) {
  process.stdout.write(`   (انتظار ${seconds}s عشان نافذة الـthrottle تتصفّر)\n`);
  await sleep(seconds * 1000);
}

function arabic(text) {
  return /[؀-ۿ]/.test(String(text ?? ''));
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-٩: تحديد المعدّل وإساءة الاستخدام — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();

  // ---- ص-٠: الفحص له معنى أصلاً؟ ----
  //
  // لو السيرفر شغّال بـ`THROTTLE_LIMIT` عالي (بيحصل في تدقيقات تانية)، كل فحص تحت هيفشل ويقول
  // «مفيش حد» وهو أصلاً معطّل بالإعداد مش بالكود. لازم نعرف الفرق.
  const otpPhone = h.nextPhone();
  const probe = await hammer('/auth/otp/request', {
    method: 'POST',
    body: { phone_number: otpPhone, user_type: 'customer' },
    times: 12,
  });
  h.record(
    'ص-٠ الـthrottle مفعّل فعلاً في السيرفر اللي بنقيسه (مش معطّل بمتغيّر بيئة)',
    probe.firstBlockedAt !== null,
    probe.firstBlockedAt
      ? `أول رفض عند النداء رقم ${probe.firstBlockedAt}`
      : `١٢ نداء عدّوا كلهم — شغّل السيرفر بلا THROTTLE_LIMIT عالي ❗`,
  );
  if (probe.firstBlockedAt === null) return finish();

  // ---- ص-١: OTP — أضيق مسار في النظام ----
  //
  // OTP بيكلّف فلوس حقيقية (SMS) وبيقصف تليفون شخص حقيقي. السقف المعلن ٥/دقيقة
  // (`docs/01-master-plan.md §7.3`).
  h.record(
    'ص-١/أ OTP بيقف عند سقف ضيّق (≤٦ نداءات) مش عند الافتراضي العام (٦٠)',
    probe.firstBlockedAt <= 6,
    `اتقفل بعد ${probe.firstBlockedAt} نداء`,
  );
  h.record(
    'ص-١/ب الرفض 429 برسالة عربية مفهومة (مش 500 ولا نص إنجليزي تقني)',
    arabic(probe.lastBody?.error?.message ?? probe.lastBody?.message),
    `«${String(probe.lastBody?.error?.message ?? probe.lastBody?.message ?? '').slice(0, 90)}»`,
  );

  // **أهم فحص في البند كله**: الحد بيتعدّ على **الرقم** مش على الـIP. في مصر، شركات المحمول
  // بتشارك آلاف المشتركين على IPs معدودة (CGNAT) — لو العدّ بالـIP، خمس عملاء في دقيقة
  // بيقفلوا التسجيل على كل اللي على نفس الـIP، والمهاجم اللي بيغيّر IP بيعدّي. عكس المطلوب
  // تمامًا في الاتجاهين.
  const otherPhone = h.nextPhone();
  const otherPhoneRes = await h.api('/auth/otp/request', {
    method: 'POST',
    body: { phone_number: otherPhone, user_type: 'customer' },
  });
  h.record(
    'ص-١/ج رقم تاني من نفس الـIP لسه شغّال — الحد على الرقم مش على الـIP (CGNAT)',
    otherPhoneRes.status !== 429,
    `HTTP=${otherPhoneRes.status}`,
  );

  // والعكس: نفس الرقم المقفول يفضل مقفول (مش بيتصفّر بتغيير أي حاجة تانية في الحمولة).
  const sameBlocked = await h.api('/auth/otp/request', {
    method: 'POST',
    body: { phone_number: otpPhone, user_type: 'technician' },
  });
  h.record(
    'ص-١/د الرقم المقفول يفضل مقفول حتى لو باقي الحمولة اتغيّرت',
    sameBlocked.status === 429,
    `HTTP=${sameBlocked.status}`,
  );

  await coolDown();

  // ---- ص-٢: التسجيل ----
  const regPhone = h.nextPhone();
  const reg = await hammer('/auth/register', {
    method: 'POST',
    body: { phone_number: regPhone, full_name: 'تدقيق المعدّل', user_type: 'customer' },
    times: 12,
  });
  h.record(
    'ص-٢ التسجيل له سقف ضيّق كمان (إنشاء حسابات بالجملة مقفول)',
    reg.firstBlockedAt !== null && reg.firstBlockedAt <= 7,
    reg.firstBlockedAt ? `اتقفل بعد ${reg.firstBlockedAt} نداء` : '١٢ نداء عدّوا ❗',
  );

  await coolDown();

  // ---- ص-٣: مسارات المستخدم المسجّل — كوبون/دفع/رفع/إنشاء طلب ----
  const customer = await h.makeCustomer('rl');
  await h.fundWallet(customer.userId, 1_000_000);

  // **كوبون**: تخمين الكوبونات بالقوة الغاشمة له قيمة مالية مباشرة — كل محاولة مجانية بتقرّب
  // المهاجم من خصم حقيقي. فحص وجود سقف أهم من قيمته بالظبط.
  const coupon = await hammer(`/promo-codes/GUESS${h.nextTag()}/validate?service_id=${h.catalog.service.id}&address_id=${customer.addressId}`, {
    token: customer.token,
    times: 70,
  });
  // السقف المطلوب **أضيق من الافتراضي العام**: ٦٠/دقيقة معناها ٨٦٬٤٠٠ تخمينة/يوم من جهاز
  // واحد — كفاية لفضاء أكواد قصير. السقف المخصّص ١٠/دقيقة.
  h.record(
    'ص-٣/أ تخمين الكوبونات بيتقفل عند سقف مخصّص ضيّق (≤١٢) مش عند الافتراضي العام',
    coupon.firstBlockedAt !== null && coupon.firstBlockedAt <= 12,
    coupon.firstBlockedAt ? `اتقفل بعد ${coupon.firstBlockedAt} محاولة` : '٧٠ محاولة عدّت كلها ❗',
  );

  await coolDown();

  // **إنشاء الطلب**: الخطر هنا مش السقف لوحده — هو **الدوسة المزدوجة**. `Idempotency-Key`
  // (P0-4) هو الحارس الحقيقي: نفس المفتاح مرتين = طلب واحد، حتى لو الاتنين عدّوا الـthrottle.
  const idemKey = `rl-${h.nextTag()}`;
  const orderBody = {
    service_id: h.catalog.service.id,
    address_id: customer.addressId,
    scheduled_at: h.nextDay(),
    problem_description: 'تدقيق المعدّل',
  };
  const first = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': idemKey },
    body: orderBody,
  });
  const second = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': idemKey },
    body: orderBody,
  });
  const createdCount = (
    await h.q(`SELECT count(*)::int AS n FROM orders WHERE service_id = $1 AND customer_id = $2`, [
      h.catalog.service.id,
      customer.profileId,
    ])
  )[0].n;
  h.record(
    'ص-٣/ب دوسة مزدوجة على «اطلب» بنفس المفتاح = طلب واحد في القاعدة',
    first.status === 201 && second.status < 400 && createdCount === 1,
    `HTTP ${first.status}/${second.status}، طلبات في القاعدة=${createdCount}`,
  );

  // سقف إنشاء الطلبات نفسه: عميل واحد مايقدرش يغرق النظام بطلبات حقيقية. الحد الافتراضي العام
  // (٦٠/دقيقة) هو اللي بيحكم هنا — الفحص بيقيسه صراحةً بدل ما يفترضه.
  const flood = await hammer('/orders', {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': undefined },
    body: (i) => ({ ...orderBody, problem_description: `إغراق ${i}` }),
    times: 70,
  });
  h.record(
    'ص-٣/ج إغراق بطلبات مختلفة بيتقفل (مش مفتوح على البحري)',
    flood.firstBlockedAt !== null,
    flood.firstBlockedAt ? `اتقفل بعد ${flood.firstBlockedAt} طلب` : '٧٠ طلب عدّوا كلهم ❗',
  );

  await coolDown();

  // **بدء الدفع**: `Idempotency-Key` بيمنع الدفع المزدوج بنفس المفتاح، بس مابيمنعش سيل
  // بمفاتيح مختلفة — وكل محاولة بطاقة بتفتح جلسة عند البوابة الخارجية (فلوس + حصّة + نسبة
  // فشل بترفعنا كتاجر مشبوه). لازم سقف مخصّص أضيق من الافتراضي، **مشترك بين كل طرق الدفع**
  // عشان المهاجم مايدوّرش بينهم ويضاعف حصّته.
  //
  // النداءات هنا بترجع `400` (بلا `Idempotency-Key`) مش دفعات حقيقية — **وده مقصود**:
  // الـthrottle حارس عام بيتنفّذ **قبل** الكنترولر، فهو بيعدّ النداء أيًا كانت نتيجته. الفحص
  // بيقيس السقف من غير ما يعمل دفعات فعلية ولا يلخبط الدفتر.
  const payFlood = await hammer(`/orders/${first.body?.data?.id}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    times: 30,
  });
  h.record(
    'ص-٣/د بدء الدفع له سقف مخصّص ضيّق (≤٢٢) مش الافتراضي العام',
    payFlood.firstBlockedAt !== null && payFlood.firstBlockedAt <= 22,
    payFlood.firstBlockedAt ? `اتقفل بعد ${payFlood.firstBlockedAt} محاولة` : '٣٠ محاولة عدّت كلها ❗',
  );

  await coolDown();

  // ---- ص-٤: الرفع — الحد بالحجم مش بالعدد بس ----
  //
  // رفع الملفات خطره مختلف: مش عدد النداءات، هو **حجم القرص**. ملف واحد ضخم أخطر من ألف نداء.
  const tech = await h.makeTechnician('rl');
  const bigBuffer = Buffer.alloc(15 * 1024 * 1024, 0x41); // ١٥ ميجا — فوق أي سقف معقول
  const form = new FormData();
  form.append('media_type', 'after_photo');
  form.append('file', new Blob([bigBuffer], { type: 'image/png' }), 'huge.png');
  let bigStatus = 0;
  try {
    const res = await fetch(`${API}/technician/orders/${first.body?.data?.id ?? 'x'}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tech.token}` },
      body: form,
    });
    bigStatus = res.status;
  } catch (err) {
    // قطع الاتصال قبل ما الملف يخلص = الحد اشتغل على مستوى أدنى، وده رفض كمان.
    bigStatus = -1;
  }
  h.record(
    'ص-٤/أ ملف ١٥ ميجا بيترفض (سقف حجم مفروض قبل ما يوصل للقرص)',
    bigStatus !== 200 && bigStatus !== 201,
    bigStatus === -1 ? 'الاتصال اتقطع أثناء الرفع (رفض على مستوى أدنى)' : `HTTP=${bigStatus}`,
  );

  // ---- ص-٥: الحالة بعد كل ده ----
  //
  // القاعدة الحاكمة للمالك: «ضعيف بطيء ماشي، بس ما يقعش». بعد قصف مئات النداءات، النظام لازم
  // يفضل بيخدم الاستخدام العادي فورًا.
  const health = await h.api('/health', { timeoutMs: 10_000 });
  h.record('ص-٥/أ النظام لسه بيرد بعد القصف كله', health.status === 200, `HTTP=${health.status}`);

  const { net, rows } = await h.ledgerImbalance();
  h.record(
    'ص-٥/ب الدفتر متوازن (القصف ماسابش أثر مالي نص-مكتمل)',
    net === 0,
    `صافي القيود=${net} على ${rows} صف`,
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
