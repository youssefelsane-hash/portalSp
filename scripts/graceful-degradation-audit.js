#!/usr/bin/env node
/**
 * **ج-١٧ — التدهور الرشيق: مين مسموح يوقف الحجز ومين لأ**.
 *
 * السؤال في البند مش «هل نقدر نوقف الحجز؟» — ده الجزء السهل. السؤال هو **إيه اللي بيفضل
 * شغّال لما نوقفه**. إيقاف شامل بيحوّل مشكلة في الحجز لأزمة في كل مكان:
 *
 * - فني واقف عند باب العميل ومش قادر يقفل الشغل.
 * - عميل خلص شغله ومش قادر يدفع.
 * - عميل عايز يلغي طلب بكرة ومش لاقي طريقة.
 *
 * الحالات دي **ضرر أكبر** من الحادثة اللي بنحاول نحتويها أصلاً. فالتدقيق ده مابيقيسش إن
 * المفتاح بيقفل — بيقيس إنه بيقفل **الحاجة الصح وبس**.
 *
 * ## المصفوفة اللي بيتحقق منها
 *
 * | العملية | المتوقع والحجز موقوف |
 * |---|---|
 * | طلب **جديد** | `503` برسالة عربية مفهومة (مش `500`، مش إنجليزي) |
 * | فني رايح/واصل/بادئ/قافل | **يكمّل عادي** |
 * | عميل بيدفع لشغل خلص | **يكمّل عادي** |
 * | إلغاء طلب قائم | **يكمّل عادي** |
 * | القراءات (تفاصيل الطلب/القايمة) | **تكمّل عادي** |
 *
 * وكمان المفتاح الأضيق: الطوارئ موقوفة والحجز بموعد شغّال.
 *
 * ## ليه بيعدّي على مسار الأدمن الحقيقي مش SQL
 *
 * الكتابة المباشرة بـSQL بتعدّي على `SettingsService` فالقيمة القديمة بتفضل في الكاش المحلي
 * وRedis — يعني الفحص كان هيقيس «المفتاح مااشتغلش» وهو شغّال، أو أسوأ: يعدّي وهو مش شغّال.
 * `PATCH /admin/settings/:key` هو اللي المالك هيستخدمه وقت الحادثة، فهو اللي بيتقاس.
 *
 * **كل الإعدادات بترجع لقيمتها الأصلية في `finish()` مهما حصل** — حتى لو التدقيق نفسه انهار.
 *
 *   node scripts/graceful-degradation-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('gd');

const NEW_BOOKINGS_KEY = 'orders.new_bookings_enabled';
const EMERGENCY_KEY = 'orders.emergency_bookings_enabled';

/** القيم الأصلية عشان `finish()` يرجّعها مهما حصل. */
const original = new Map();
let admin = null;

/**
 * تغيير مفتاح من **مسار الأدمن المدعوم**. بيرجّع استجابة الـPATCH نفسها عشان التدقيق يقدر
 * يتحقق إن العملية دي نفسها نجحت (مش بس إن أثرها ظهر).
 */
async function flip(key, value) {
  if (!original.has(key)) {
    const [row] = await h.q(`SELECT value FROM settings WHERE key = $1`, [key]);
    original.set(key, row?.value);
  }
  return h.api(`/admin/settings/${key}`, {
    method: 'PATCH',
    token: admin.token,
    headers: { 'X-Step-Up-Token': await h.stepUpToken(admin.userId) },
    body: { value },
  });
}

async function restoreSettings() {
  for (const [key, value] of original) {
    if (value === undefined) continue;
    try {
      await flip(key, value === true || value === 'true');
    } catch {
      // آخر خط دفاع: لو مسار الأدمن نفسه واقع، رجّع بـSQL + امسح الكاش يدويًا.
      await h.setSetting(key, value).catch(() => {});
    }
  }
  original.clear();
}

async function statusOf(orderId) {
  const [row] = await h.q(`SELECT order_status, payment_status, technician_id FROM orders WHERE id = $1`, [orderId]);
  return row;
}

async function waitAssigned(orderId) {
  for (let i = 0; i < 60; i++) {
    const row = await statusOf(orderId);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return statusOf(orderId);
}

async function createOrder(customer, description, extra = {}) {
  return h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: description,
      ...extra,
    },
  });
}

const PLATFORM_TIMEZONE = 'Africa/Cairo';
const cairoDayOf = (d) => d.toLocaleDateString('en-CA', { timeZone: PLATFORM_TIMEZONE });

/**
 * لحظة مستقبلية **لسه في نفس يوم القاهرة** — ده اللي بيخلّي الطلب طوارئ (ADR-0048: الوضع
 * مشتق من اليوم بتوقيت المنصة).
 *
 * **بَقّة حقيقية في التدقيق نفسه اتلقطت هنا**: أول نسخة كتبت `T21:00:00Z` وافترضت إنها
 * «النهارده». القاهرة UTC+3 صيفًا، فـ21:00Z = 00:00 بكرة بتوقيت القاهرة — الطلب كان بيتحسب
 * **عادي مش طوارئ**، فالحارس ماوصلوش أصلاً والتدقيق قال «الطوارئ عدّت رغم الإيقاف ❗» عن كود
 * سليم تمامًا. الفحص اللي بيقيس افتراض بدل الحالة الحقيقية بيكدب في الاتجاهين.
 *
 * بيرجّع `null` قرب منتصف الليل بتوقيت القاهرة — وقتها **مفيش** لحظة مستقبلية في نفس اليوم،
 * فالسيناريو غير قابل للقياس أصلاً والتدقيق بيقول كده صراحةً بدل ما يفشل كذبًا.
 */
function sameDayCairoIso(minutesAhead = 120) {
  const now = new Date();
  const candidate = new Date(now.getTime() + minutesAhead * 60_000);
  return cairoDayOf(candidate) === cairoDayOf(now) ? candidate.toISOString() : null;
}

/** رسالة عربية مفهومة = فيها حروف عربية فعلاً ومش نص خام إنجليزي/تقني. */
function isArabicMessage(body) {
  const msg = body?.message ?? body?.error?.message ?? '';
  return typeof msg === 'string' && /[؀-ۿ]/.test(msg) && msg.length > 15;
}

function messageOf(body) {
  return String(body?.message ?? body?.error?.message ?? '').slice(0, 140);
}

async function run() {
  await h.connect();
  console.log(`\n=== ج-١٧: التدهور الرشيق — تشغيلة ${h.runId} ===\n`);
  await h.seedCatalog();
  admin = await h.makeAdmin();
  const customer = await h.makeCustomer('gd');
  const tech = await h.makeTechnician('gd');
  await h.fundWallet(customer.userId, 1_000_000);

  // ═══ ش-٠: خط الأساس ═══
  //
  // من غيره، «الحجز اترفض» مش دليل على إن المفتاح اشتغل — ممكن يكون الفلو نفسه مكسور
  // لأي سبب تاني (كتالوج، عنوان، فني). لازم نثبت الأول إن الحجز شغّال.
  const baseline = await createOrder(customer, 'خط أساس ج-١٧');
  h.record('ش-٠/أ الحجز شغّال والمفتاح مفتوح (خط الأساس)', baseline.status === 201, `HTTP=${baseline.status}`);
  if (baseline.status !== 201) return finish();

  // الطلبين دول **قائمين قبل الحادثة** — هما موضوع البند كله: إيه اللي بيحصلهم لما نوقف الحجز.
  const inflightId = baseline.body.data.id;
  const assigned = await waitAssigned(inflightId);
  h.record(
    'ش-٠/ب الطلب القائم اتعيّن لفني (فبقى عندنا شغل جاري حقيقي نختبر عليه)',
    !!assigned?.technician_id,
    assigned?.technician_id ? `اتعيّن (${assigned.order_status})` : `مااتعيّنش — ${assigned?.order_status} ❗`,
  );

  const toCancel = await createOrder(customer, 'طلب قائم هيتلغي والحجز موقوف');
  h.record('ش-٠/ج طلب قائم تاني اتعمل (للإلغاء تحت)', toCancel.status === 201, `HTTP=${toCancel.status}`);
  const toCancelId = toCancel.body?.data?.id;

  // ═══ ش-١: إيقاف الحجز من شاشة الأدمن ═══
  const patch = await flip(NEW_BOOKINGS_KEY, false);
  h.record(
    'ش-١/أ المالك قدر يوقف الحجز من شاشة الأدمن (بلا deploy ولا إعادة تشغيل)',
    patch.status === 200,
    `PATCH=${patch.status}${patch.status !== 200 ? ` — ${messageOf(patch.body)}` : ''}`,
  );
  if (patch.status !== 200) return finish();

  // العميل لازم يعرف **قبل** ما يملا الفورم كله. من غير ده هيدخل عنوان وصور وميعاد ودفع
  // وياكل رفض في آخر خطوة — أسوأ لحظة ممكنة للرفض.
  const policy = await h.api('/booking-policy');
  h.record(
    'ش-١/ب التطبيق يقدر يعرف بدري إن الحجز موقوف (إعلان مبكر مش رفض في آخر خطوة)',
    policy.status === 200 && policy.body?.data?.new_bookings_enabled === false,
    `HTTP=${policy.status} new_bookings_enabled=${policy.body?.data?.new_bookings_enabled}`,
  );

  // ═══ ش-٢: الطلب الجديد بيترفض — بس **صح** ═══
  const blocked = await createOrder(customer, 'محاولة حجز والحجز موقوف');
  h.record(
    'ش-٢/أ الطلب الجديد اترفض فعلاً (المفتاح اشتغل)',
    blocked.status === 503,
    `HTTP=${blocked.status}${blocked.status === 201 ? ' — الحجز عدّى رغم إن المفتاح مقفول ❗' : ''}`,
  );
  // `503` مش `500`: الفرق مش تجميلي — الكلاينت بيتعامل معاهم مختلف، والمراقبة كمان.
  h.record(
    'ش-٢/ب الرفض إيقاف مقصود مش عطل (503 مش 500)',
    blocked.status === 503,
    `HTTP=${blocked.status}`,
  );
  h.record(
    'ش-٢/ج العميل شايف رسالة عربية مفهومة مش «حصل خطأ غير متوقع»',
    isArabicMessage(blocked.body),
    `الرسالة: ${messageOf(blocked.body)}`,
  );
  // كود منفصل عن `SYS_001` (اللي بيتولّد لكل عطل غير متوقع) — وإلا الإيقاف المخطط له
  // بيبان في المراقبة كأنه حادثة، وحادثة حقيقية بتضيع وسطه.
  h.record(
    'ش-٢/د كود الخطأ بيميّز الإيقاف المتعمّد عن العطل (SYS_002 مش SYS_001)',
    blocked.body?.code === 'SYS_002' || blocked.body?.error?.code === 'SYS_002',
    `code=${blocked.body?.code ?? blocked.body?.error?.code}`,
  );

  // ═══ ش-٣: **قلب البند** — الشغل الجاري بيكمّل والحجز موقوف ═══
  const steps = [
    ['ش-٣/أ الفني قدر يقول «في الطريق» والحجز موقوف', `/technician/orders/${inflightId}/depart`],
    ['ش-٣/ب الفني قدر يسجّل وصوله والحجز موقوف', `/technician/orders/${inflightId}/arrive`],
    ['ش-٣/ج الفني قدر يبدأ الشغل والحجز موقوف', `/technician/orders/${inflightId}/start`],
  ];
  for (const [name, pathname] of steps) {
    const res = await h.api(pathname, { method: 'POST', token: tech.token });
    h.record(name, res.status === 200 || res.status === 201, `HTTP=${res.status} ${messageOf(res.body)}`);
  }

  const photo = await h.uploadAfterPhoto(inflightId, tech.token);
  const complete = await h.api(`/technician/orders/${inflightId}/complete`, { method: 'POST', token: tech.token });
  h.record(
    'ش-٣/د الفني قفل الشغل والحجز موقوف (ده اللي بيمنع «فني واقف عند الباب ومش قادر يخلص»)',
    complete.status === 200 || complete.status === 201,
    `رفع=${photo.status} إقفال=${complete.status} ${messageOf(complete.body)}`,
  );

  // أخطر خانة في المصفوفة: عميل خلص شغله ومش قادر يدفع = فني مش هياخد فلوسه وعميل غاضب،
  // كل ده بسبب حادثة في **الحجز** مالهاش علاقة بيه.
  const pay = await h.api(`/orders/${inflightId}/pay-with-wallet`, {
    method: 'POST',
    token: customer.token,
    headers: { 'Idempotency-Key': `gd-${h.nextTag()}` },
  });
  h.record(
    'ش-٣/هـ العميل قدر يدفع لشغل خلص والحجز موقوف',
    pay.status === 200 || pay.status === 201,
    `HTTP=${pay.status} ${messageOf(pay.body)}`,
  );

  const finalState = await statusOf(inflightId);
  h.record(
    'ش-٣/و الطلب القائم وصل لحالته النهائية الصحيحة رغم الإيقاف',
    finalState?.payment_status === 'succeeded' || finalState?.order_status === 'completed',
    `الحالة=${finalState?.order_status} الدفع=${finalState?.payment_status}`,
  );

  // الإلغاء لازم يفضل شغّال: عميل محبوس في طلب مش عايزه أسوأ من عميل مش قادر يحجز.
  if (toCancelId) {
    const reasons = await h.api('/cancellation-reasons?applies_to=customer');
    const list = Array.isArray(reasons.body?.data) ? reasons.body.data : reasons.body;
    const reasonId = Array.isArray(list) && list.length ? list[0].id : undefined;
    // اسم الحقل `cancellation_reason_id` مش `reason_id` — الـDTO بيرفض أي حقل مش في القايمة
    // (`forbidNonWhitelisted`)، فالاسم الغلط كان بيرجّع `400 الحقل غير مسموح` وبيبان كأن
    // الإلغاء اتقفل مع إيقاف الحجز، وهو ماوصلش للمنطق أصلاً.
    const cancel = await h.api(`/orders/${toCancelId}/cancel`, {
      method: 'POST',
      token: customer.token,
      body: reasonId ? { cancellation_reason_id: reasonId } : { reason: 'تدقيق ج-١٧' },
    });
    h.record(
      'ش-٣/ز العميل قدر يلغي طلب قائم والحجز موقوف',
      cancel.status === 200 || cancel.status === 201,
      `HTTP=${cancel.status} ${messageOf(cancel.body)}`,
    );
  }

  // القراءات: العميل لازم يفضل شايف طلباته. تطبيق بيفضي شاشاته وقت الحادثة بيولّد موجة
  // مكالمات دعم أكبر من الحادثة نفسها.
  const readList = await h.api('/orders?limit=10', { token: customer.token });
  const readOne = await h.api(`/orders/${inflightId}`, { token: customer.token });
  h.record(
    'ش-٣/ح العميل لسه شايف طلباته وتفاصيلها والحجز موقوف',
    readList.status === 200 && readOne.status === 200,
    `القايمة=${readList.status} التفاصيل=${readOne.status}`,
  );

  // ═══ ش-٤: الرجوع فوري ═══
  //
  // مفتاح بيوقف بسرعة وبيرجع ببطء مش مفتاح طوارئ — هو نصف deploy. الرجوع لازم يبقى فوري
  // بنفس السهولة، وإلا المالك هيتردد في استخدامه أصلاً وقت الحادثة.
  const reopen = await flip(NEW_BOOKINGS_KEY, true);
  const afterReopen = await createOrder(customer, 'حجز بعد رفع الإيقاف');
  h.record(
    'ش-٤/أ رفع الإيقاف رجّع الحجز فورًا (بلا إعادة تشغيل)',
    reopen.status === 200 && afterReopen.status === 201,
    `PATCH=${reopen.status} حجز=${afterReopen.status} ${messageOf(afterReopen.body)}`,
  );

  // ═══ ش-٥: المفتاح الأضيق — الطوارئ وحدها ═══
  //
  // ADR-0048: وضع الحجز **مشتق من التاريخ في الباك-إند** مش مختار من العميل. فطلب نفس اليوم
  // = طوارئ، وطلب بكرة = عادي. المفتاح ده بيفرّق بينهم من غير ما يعاقب الاتنين.
  // **ضابط قبل أي حكم**: نثبت الأول إن طلب نفس اليوم بيتحسب فعلاً `emergency` والمفتاح
  // **مفتوح**. من غير ده، رفض/قبول تحت مش دليل على المفتاح — ممكن يكون الطلب مش طوارئ أصلاً
  // (وده بالظبط اللي حصل في أول تشغيلة بسبب فرق التوقيت).
  const today = sameDayCairoIso();
  if (!today) {
    h.record(
      'ش-٥ سيناريو الطوارئ اتخطّى (قرب منتصف الليل بتوقيت القاهرة مفيش لحظة مستقبلية في نفس اليوم)',
      true,
      'غير قابل للقياس دلوقتي — شغّل التدقيق في أي وقت تاني من اليوم',
    );
  } else {
    const emergencyControl = await createOrder(customer, 'ضابط: طوارئ والمفتاح مفتوح', { scheduled_at: today });
    const controlMode = emergencyControl.body?.data?.id
      ? (await h.q(`SELECT booking_mode FROM orders WHERE id = $1`, [emergencyControl.body.data.id]))[0]?.booking_mode
      : null;
    h.record(
      'ش-٥/٠ طلب نفس اليوم بيتحسب فعلاً «طوارئ» (فالفحص تحت بيقيس المفتاح مش التوقيت)',
      emergencyControl.status === 201 && controlMode === 'emergency',
      `HTTP=${emergencyControl.status} booking_mode=${controlMode}`,
    );

    const emergencyOff = await flip(EMERGENCY_KEY, false);
    h.record('ش-٥/أ المالك قدر يوقف الطوارئ وحدها', emergencyOff.status === 200, `PATCH=${emergencyOff.status}`);

    const sameDay = await createOrder(customer, 'طوارئ والطوارئ موقوفة', { scheduled_at: today });
    h.record(
      'ش-٥/ب طلب نفس اليوم (طوارئ) اترفض',
      sameDay.status === 503,
      `HTTP=${sameDay.status}${sameDay.status === 201 ? ' — الطوارئ عدّت رغم الإيقاف ❗' : ''}`,
    );
    // الرسالة لازم تقول **البديل** مش ترفض وخلاص — العميل قدامه طريق فعلاً (الحجز بموعد شغّال).
    h.record(
      'ش-٥/ج والرسالة بتدلّه على البديل المتاح (الحجز بموعد) مش رفض جاف',
      isArabicMessage(sameDay.body) && /موعد|عادي/.test(messageOf(sameDay.body)),
      `الرسالة: ${messageOf(sameDay.body)}`,
    );
    // **دي النقطة**: الإيقاف انتقائي. لو الحجز العادي وقع كمان يبقى المفتاح الأضيق مالوش لازمة.
    const scheduledStillWorks = await createOrder(customer, 'حجز بموعد والطوارئ موقوفة');
    h.record(
      'ش-٥/د والحجز بموعد عادي فضل شغّال (الإيقاف انتقائي مش شامل)',
      scheduledStillWorks.status === 201,
      `HTTP=${scheduledStillWorks.status} ${messageOf(scheduledStillWorks.body)}`,
    );

    await flip(EMERGENCY_KEY, true);
    const emergencyBack = await createOrder(customer, 'طوارئ بعد رفع الإيقاف', { scheduled_at: today });
    h.record(
      'ش-٥/هـ رفع إيقاف الطوارئ رجّعها فورًا',
      emergencyBack.status === 201,
      `HTTP=${emergencyBack.status} ${messageOf(emergencyBack.body)}`,
    );
  }

  // ═══ ش-٦: مفيش ضرر جانبي ═══
  //
  // إيقاف الحجز رفض **متوقع**، فما ينفعش يظهر في اللوج كعطل ٥xx — وإلا كل إيقاف مخطط له
  // بيولّد ضجيج إنذارات بيغطّي على الأعطال الحقيقية.
  const errors = await h.serverErrorsSince();
  h.record(
    'ش-٦/أ الإيقاف ماولّدش أي عطل 5xx في اللوج (رفض متوقع مش استثناء)',
    errors.length === 0,
    errors.length ? `أعطال=${errors.length}: ${errors.map((e) => e.path).slice(0, 3).join(', ')}` : 'صفر أعطال',
  );
  const { net, rows } = await h.ledgerImbalance();
  h.record('ش-٦/ب الدفتر متوازن بعد كل ده', net === 0, `صافي=${net} على ${rows} صف`);
  const negatives = await h.negativeBalances();
  h.record('ش-٦/ج مفيش رصيد سالب', negatives.length === 0, `أرصدة سالبة=${negatives.length}`);

  await finish();
}

async function finish() {
  await restoreSettings();
  // تحقق نهائي إن الرجوع حصل فعلاً — تدقيق بيسيب الحجز مقفول وراه أسوأ من تدقيق مافيش.
  const [nb] = await h.q(`SELECT value FROM settings WHERE key = $1`, [NEW_BOOKINGS_KEY]);
  const [em] = await h.q(`SELECT value FROM settings WHERE key = $1`, [EMERGENCY_KEY]);
  console.log(`\nحالة المفاتيح بعد التنظيف: ${NEW_BOOKINGS_KEY}=${nb?.value} ${EMERGENCY_KEY}=${em?.value}`);

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
  // **الأهم**: المفاتيح لازم ترجع مفتوحة حتى لو التدقيق انهار — وإلا الحجز بيفضل موقوف.
  await restoreSettings().catch(() => {});
  await h.close();
  process.exit(2);
});
