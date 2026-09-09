#!/usr/bin/env node
/**
 * **ج-٤ — المطابقة والجدولة**: مين **ما ينفعش** يتبعتله طلب، وإيه اللي بيحصل لما محدش يصلح.
 *
 * سؤال المالك: «الفني اللي offline أو مشغول أو مش مؤهّل مايتبعتلوش. فشل المطابقة التلقائية
 * مايسيبش الطلب معلّق. لازم يكون في retry/fallback واضح».
 *
 * المنهج: **فني مؤهّل واحد سليم لكل حالة، وفني تاني مكسور بطريقة واحدة بس.** لو الطلب راح
 * للمكسور، القاعدة اللي بتمنعه مش شغالة. ولو الاتنين مكسورين ومحدش صالح، بنتأكد إن الطلب
 * **مايتلغيش ولا يتنسي** — بيفضل `searching_technician` بموعد إعادة محاولة، والـsweep بترجع له.
 *
 * كل حالة بتتعمل بفني **منفصل بالكامل** (كتالوج معزول لكل حالة) عشان مايبقاش فيه تسرّب بين
 * الحالات — «الطلب راح لفني تاني» ما ينفعش يبان كأنه نجاح.
 *
 *   node scripts/matching-eligibility-audit.js [--keep]
 */
'use strict';

const { LiveHarness, sleep } = require('./lib/live-harness');

const KEEP = process.argv.includes('--keep');
const h = new LiveHarness('mx');
let admin;

async function orderRow(orderId) {
  const [row] = await h.q(
    `SELECT order_status, technician_id, matching_attempt_count, next_matching_attempt_at, cancelled_at
       FROM orders WHERE id = $1`,
    [orderId],
  );
  return row ?? null;
}

async function createOrder(customer, extra = {}) {
  const res = await h.api('/orders', {
    method: 'POST',
    token: customer.token,
    body: {
      service_id: h.catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: h.nextDay(),
      problem_description: 'تدقيق المطابقة',
      ...extra,
    },
  });
  return res;
}

/** بننتظر التوزيع يقرر: يا يعيّن فني، يا يفضل بيدور بموعد إعادة محاولة. */
async function settle(orderId, maxSeconds = 25) {
  for (let i = 0; i < maxSeconds * 2; i++) {
    const row = await orderRow(orderId);
    if (row?.technician_id) return row;
    await sleep(500);
  }
  return orderRow(orderId);
}

/**
 * حالة «فني مكسور بطريقة واحدة»: بنبني كتالوج معزول، فني واحد بس، نكسره بالطريقة المطلوبة،
 * وننشئ طلب. المتوقع: **مايتعيّنش**، والطلب يفضل بيدور.
 */
async function ineligibleCase(label, breakIt, { expectAssigned = false } = {}) {
  const saveCatalog = h.catalog;
  await h.seedCatalog();
  const tech = await h.makeTechnician(label.slice(0, 3));
  const customer = await h.makeCustomer(label.slice(0, 3));
  await breakIt(tech, customer);

  const res = await createOrder(customer);
  if (res.status !== 201) {
    // رفض وقت الإنشاء نتيجة مقبولة كمان — المهم إن مفيش تعيين لفني مش مؤهّل، ومفيش 5xx.
    h.record(
      `${label} — اترفض وقت الإنشاء`,
      res.status >= 400 && res.status < 500,
      `HTTP=${res.status} «${String(res.body?.error?.message ?? '').slice(0, 100)}»`,
    );
    h.catalog = saveCatalog;
    return;
  }

  const row = await settle(res.body.data.id);
  const assigned = !!row?.technician_id;
  const ok = expectAssigned ? assigned : !assigned;
  h.record(
    label,
    ok,
    `الحالة=${row?.order_status} الفني=${assigned ? (expectAssigned ? 'اتعيّن ✔' : 'اتعيّن ❗') : 'ما اتعيّنش'} ` +
      `محاولات=${row?.matching_attempt_count ?? 0} إعادة محاولة=${row?.next_matching_attempt_at ? 'مجدولة' : 'مفيش'}`,
  );

  // ثابت حاكم مستقل عن السبب: طلب ما لقاش فني **مايتلغيش تلقائيًا ولا يُنسى**.
  if (!assigned) {
    h.record(
      `${label} — الطلب مش ضايع (لسه بيدور، مش ملغي)`,
      row?.order_status === 'searching_technician' && !row?.cancelled_at,
      `الحالة=${row?.order_status} ملغي=${row?.cancelled_at ? 'أيوه ❗' : 'لأ'}`,
    );
  }
  h.catalog = saveCatalog;
  return res.body.data;
}

// ===================== الحالات =====================

async function run() {
  await h.connect();
  console.log(`\n=== ج-٤: المطابقة والجدولة — تشغيلة ${h.runId} ===\n`);

  // ---- خط الأساس: فني سليم تمامًا لازم **يتعيّن** — وإلا كل الحالات التحت بلا معنى ----
  await h.seedCatalog();
  admin = await h.makeAdmin();
  const baseTech = await h.makeTechnician('ok');
  const baseCustomer = await h.makeCustomer('ok');
  const baseRes = await createOrder(baseCustomer);
  const baseRow = baseRes.status === 201 ? await settle(baseRes.body.data.id) : null;
  h.record(
    'خط الأساس: فني مؤهّل بالكامل بياخد الطلب',
    baseRow?.technician_id === baseTech.id,
    `HTTP=${baseRes.status} الحالة=${baseRow?.order_status} الفني=${baseRow?.technician_id === baseTech.id ? 'صح' : baseRow?.technician_id ?? 'مفيش'}`,
  );

  // ---- حالات «ما ينفعش يتبعتله» ----

  await ineligibleCase('ح-١ فني مش معتمد (verification_status=pending)', async (tech) => {
    await h.q(`UPDATE technician_profiles SET verification_status = 'pending' WHERE id = $1`, [tech.id]);
  });

  await ineligibleCase('ح-٢ فني مش مسجّل على الخدمة ولا فئتها', async (tech) => {
    await h.q(`DELETE FROM technician_services WHERE technician_id = $1`, [tech.id]);
    await h.q(`DELETE FROM technician_categories WHERE technician_id = $1`, [tech.id]);
  });

  await ineligibleCase('ح-٣ فني برّه نطاق/مدينة الطلب', async (tech) => {
    await h.q(`DELETE FROM technician_zones WHERE technician_id = $1`, [tech.id]);
  });

  await ineligibleCase('ح-٤ فني متحذف (soft delete)', async (tech) => {
    await h.q(`UPDATE technician_profiles SET deleted_at = now() WHERE id = $1`, [tech.id]);
  });

  await ineligibleCase('ح-٥ الأدمن حاجب الخدمة دي عن الفني (ADR-0049)', async (tech) => {
    await h.q(
      `INSERT INTO technician_excluded_services (technician_id, service_id, reason, excluded_by_user_id)
       VALUES ($1,$2,'حجب تدقيقي',$3) ON CONFLICT DO NOTHING`,
      [tech.id, h.catalog.service.id, admin.userId],
    );
  });

  await ineligibleCase('ح-٦ خدمة الفني نفسها متوقفة (is_active=false)', async (tech) => {
    await h.q(`UPDATE technician_services SET is_active = false WHERE technician_id = $1`, [tech.id]);
    await h.q(`DELETE FROM technician_categories WHERE technician_id = $1`, [tech.id]);
  });

  await ineligibleCase('ح-٧ اعتماد خدمة الفني لسه مش موافَق عليه', async (tech) => {
    await h.q(
      `UPDATE technician_services SET verification_status = 'pending_verification' WHERE technician_id = $1`,
      [tech.id],
    );
    await h.q(`DELETE FROM technician_categories WHERE technician_id = $1`, [tech.id]);
  });

  // **ح-٨ مقلوبة عن قصد**: المساعد المؤهّل على الخدمة **لازم** ياخد الطلب. الاختبار ده كان
  // متكتب أول مرة على أساس ADR-0050 («المساعد مايشيلش طلب لوحده»)، وADR-0055 ألغى القاعدة دي
  // صراحةً بطلب مالك مباشر: «طالما أنا ما منعتش عنهم الشغل، يبقى زيهم زي الفنيين بالضبط».
  // فالنتيجة اللي التدقيق شافها (المساعد اتعيّن) **هي الصح**، والمرجع المضلّل كان تعليق قديم
  // في `technicianKindCondition` — اتصلّح مع التدقيق ده.
  await ineligibleCase(
    'ح-٨ مساعد مؤهّل على الخدمة بياخد الطلب زيّه زي الفني (ADR-0055)',
    async (tech) => {
      await h.q(`UPDATE technician_profiles SET technician_kind = 'assistant' WHERE id = $1`, [tech.id]);
    },
    { expectAssigned: true },
  );

  // ---- الطلب اللي محدش صالح ليه: مايضيعش، وبيتلقط لما يظهر فني ----
  await recoveryPath();

  // ---- قفل الفني المطلوب: مفيش استبدال صامت ----
  await requestedTechnicianPreferenceVsLock();

  const errors = await h.serverErrorsSince();
  h.record(
    'صفر 5xx في كل التشغيلة',
    errors.length === 0,
    errors.length ? errors.map((e) => `${e.url} :: ${e.message}`).slice(0, 4).join(' | ') : 'مفيش',
  );

  console.log(`\n--- الخلاصة ---`);
  console.log(`${h.results.length - h.failures.length}/${h.results.length} نجحوا`);
  if (h.failures.length) {
    console.log(`\n❌ محتاج تدخّل:`);
    for (const f of h.failures) console.log(`   • ${f.name}: ${f.detail}`);
  }

  if (!KEEP) {
    console.log(`\nتنظيف...`);
    await h.cleanup();
  } else {
    console.log(`\n--keep: البيانات سايبها`);
  }
  await h.close();
  process.exit(h.failures.length ? 1 : 0);
}

/**
 * **الاختبار الأهم في ج-٤**: طلب اتعمل ومحدش مؤهّل ليه خالص.
 *
 * المطلوب تلاتة: (أ) مايتلغيش تلقائيًا، (ب) يفضل `searching_technician` بموعد إعادة محاولة
 * مسجّل، (ج) أول ما فني مؤهّل يظهر، الـ**recovery sweep** تلقطه وتعيّنه — من غير أي تدخل يدوي.
 */
async function recoveryPath() {
  await h.seedCatalog();
  const customer = await h.makeCustomer('rec');
  const res = await createOrder(customer);
  if (res.status !== 201) {
    h.record('ح-٩ طلب بلا أي فني مؤهّل', false, `الإنشاء فشل: HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  const stranded = await settle(orderId, 15);

  h.record(
    'ح-٩/أ محدش مؤهّل → الطلب لسه بيدور، مش ملغي',
    stranded?.order_status === 'searching_technician' && !stranded?.technician_id && !stranded?.cancelled_at,
    `الحالة=${stranded?.order_status} فني=${stranded?.technician_id ?? 'مفيش'} ملغي=${stranded?.cancelled_at ? 'أيوه ❗' : 'لأ'}`,
  );
  // **مش بنفحص `next_matching_attempt_at` لوحده**: العمود ده بيفضل `NULL` لحد أول محاولة
  // استرداد، والـsweep بتقرا `COALESCE(next_matching_attempt_at, placed_at, created_at)` —
  // يعني `NULL` معناها «مستحق دلوقتي» مش «متنسي». السؤال الحقيقي هو: **هل الطلب داخل فعلاً في
  // الاستعلام اللي الـsweep بتختار بيه؟** فبنشغّل نفس الشرط بالحرف بدل ما نخمّن من عمود واحد.
  //
  // كمان مابنطلبش «مستحق **دلوقتي**»: الـsweep بتأجّل بـbackoff أُسّي بعد كل محاولة، فطلب
  // اتحاوِل عليه للتو موعده الجاي في المستقبل — وده الصح مش عطل. الشرط اللي بيفرّق بين «في
  // الطابور» و«اتنسي» هو الشروط **البنيوية** (حالة/نطاق/محذوف/مفيش عرض حي قافل عليه) + وجود
  // موعد معروف (أو `NULL` = مستحق فورًا).
  const [pipeline] = await h.q(
    `SELECT COALESCE(o.next_matching_attempt_at, o.placed_at, o.created_at) AS due_at
       FROM orders o
      WHERE o.id = $1
        AND o.order_status = 'searching_technician'
        AND o.service_zone_id IS NOT NULL
        AND o.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM order_assignments a
           WHERE a.order_id = o.id AND a.assignment_status IN ('sent','viewed') AND a.expires_at > now()
        )`,
    [orderId],
  );
  h.record(
    'ح-٩/ب الطلب في طابور الـsweep بموعد معروف (مش نسيان صامت)',
    !!pipeline?.due_at,
    `في الطابور=${pipeline ? 'أيوه' : 'لأ ❗'} موعد المحاولة الجاية=${pipeline?.due_at ?? 'مفيش ❗'} ` +
      `محاولات=${stranded?.matching_attempt_count}`,
  );

  // دلوقتي بنوفّر فني مؤهّل، وبنقدّم موعد إعادة المحاولة عشان الدورة الجاية تلقطه فورًا بدل
  // ما نستنى الـbackoff الطبيعي (اللي بيوصل ساعة). ده بيسرّع القياس، مش بيغيّر المنطق.
  const rescuer = await h.makeTechnician('rsc');
  await h.q(`UPDATE orders SET next_matching_attempt_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);

  let recovered = null;
  for (let i = 0; i < 150; i++) {
    recovered = await orderRow(orderId);
    if (recovered?.technician_id) break;
    await sleep(1000);
  }
  h.record(
    'ح-٩/ج أول ما فني مؤهّل ظهر، الـsweep لقطت الطلب وعيّنته',
    recovered?.technician_id === rescuer.id,
    `الحالة=${recovered?.order_status} الفني=${recovered?.technician_id === rescuer.id ? 'المنقذ' : recovered?.technician_id ?? 'لسه مفيش'} ` +
      `محاولات=${recovered?.matching_attempt_count}`,
  );
}

/**
 * **تفضيل ≠ قفل** (ADR-0065 §1، ADR-0066 §1). الفرق تجاري مش تقني، والتدقيق لازم يفصل بينهم
 * وإلا بيتّهم النظام بغلط مالوش:
 *
 *  - `requested_technician_id` **لوحده** = تفضيل. العميل مشافش سعر الفني ده بالذات، فلو الفني
 *    مابقاش صالح، البديل **مقصود** — الطلب يُخدَم بدل ما يقف.
 *  - `requested_technician_id` **+ `provider_lock_source`** = قفل. العميل شاف اسم الفني وسعره
 *    ودفع عليه، فالاستبدال الصامت = زيادة سعر صامتة. هنا **ممنوع** أي بديل.
 *
 * الحالتين بيتقاسوا بنفس السيناريو بالظبط عشان الفرق يبان: فني مختار بيتسحب اعتماده بعد
 * الاختيار، وفني تاني مؤهّل بالكامل موجود ومستني.
 */
async function requestedTechnicianPreferenceVsLock() {
  // ---- ح-١٠/أ: تفضيل — البديل مسموح ومقصود ----
  await h.seedCatalog();
  let chosen = await h.makeTechnician('prf');
  const backup = await h.makeTechnician('bkp');
  let customer = await h.makeCustomer('prf');
  await h.q(`UPDATE technician_profiles SET verification_status = 'suspended' WHERE id = $1`, [chosen.id]);

  let res = await createOrder(customer, { requested_technician_id: chosen.id });
  if (res.status !== 201) {
    h.record(
      'ح-١٠/أ تفضيل لفني مابقاش صالح — رفض واضح وقت الإنشاء',
      res.status >= 400 && res.status < 500,
      `HTTP=${res.status} «${String(res.body?.error?.message ?? '').slice(0, 110)}»`,
    );
  } else {
    const row = await settle(res.body.data.id, 20);
    h.record(
      'ح-١٠/أ تفضيل (بلا قفل): الطلب اتخدم ببديل مؤهّل بدل ما يقف — سلوك مقصود (ADR-0065)',
      row?.technician_id === backup.id,
      `الفني=${row?.technician_id === backup.id ? 'البديل المؤهّل' : row?.technician_id ?? 'مفيش'} الحالة=${row?.order_status}`,
    );
  }

  // ---- ح-١٠/ب: قفل حقيقي — ممنوع أي بديل ----
  await h.seedCatalog();
  chosen = await h.makeTechnician('lck');
  const other = await h.makeTechnician('oth');
  customer = await h.makeCustomer('lck');

  res = await createOrder(customer, { requested_technician_id: chosen.id });
  if (res.status !== 201) {
    h.record('ح-١٠/ب إنشاء طلب بفني مختار', false, `الإنشاء فشل: HTTP=${res.status}`);
    return;
  }
  const orderId = res.body.data.id;
  // القفل بيتولّد عادةً من تذكرة معاينة مستهلكة؛ هنا بنكتب نفس حالة الصف مباشرةً لأن محرك
  // التوزيع بيقرا `provider_lock_source` من الطلب مش من التذكرة — فده تمثيل أمين للحالة.
  await h.q(`UPDATE orders SET provider_lock_source = 'match_preview' WHERE id = $1`, [orderId]);
  // الفني المقفول بيضيع **بعد** القفل — نفس شكل «الفني قفل حسابه فجأة».
  await h.q(`UPDATE technician_profiles SET verification_status = 'suspended' WHERE id = $1`, [chosen.id]);
  await h.q(`UPDATE orders SET next_matching_attempt_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);

  const row = await settle(orderId, 25);
  h.record(
    'ح-١٠/ب قفل منفّذ: مفيش استبدال صامت بفني تاني',
    row?.technician_id !== other.id,
    `الفني=${row?.technician_id === other.id ? 'اتبدل بفني تاني ❗' : row?.technician_id ?? 'مفيش'} الحالة=${row?.order_status}`,
  );
  h.record(
    'ح-١٠/ب الطلب المقفول مايتلغيش تلقائيًا — بيستنى قرار العميل',
    !row?.cancelled_at,
    `الحالة=${row?.order_status} ملغي=${row?.cancelled_at ? 'أيوه ❗' : 'لأ'}`,
  );
}

run().catch(async (err) => {
  console.error('فشل:', err);
  await h.close();
  process.exit(2);
});
