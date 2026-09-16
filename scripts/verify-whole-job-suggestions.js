/**
 * **تحقق حي: الاقتراح بيقيس الشغل كامل، مش يوم بدايته** (طلب مالك 2026-09-16، docs/08 §155، ADR-0100).
 *
 * > «لو الشغل بدأ في يوم X، كام Provider مؤهّل يقدر يشيل الشغل كاملًا حسب مدته ومتطلباته؟
 * >  ماينفعش يوم البداية يكون فاضي وبعد يومين يبقى متعارض.»
 *
 * كل فحص هنا بيتقرا **مرتين على نفس البيانات بالظبط**: مرة من غير مدة (السلوك القديم = الضابط)
 * ومرة بالمدة الحقيقية. الضابط جزء أصيل من الاختبار مش زيادة: من غيره «المنفّذ اتشال» ممكن يبقى
 * صح لأي سبب تاني (بيانات ناقصة، نطاق غلط، فني مش مؤهّل أصلاً) — والفرق بين القراءتين هو الدليل
 * الوحيد إن **المدة** هي اللي عملت الفرق.
 *
 *   node scripts/verify-whole-job-suggestions.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const DAY_MINUTES = 720; // matching.daily_capacity_minutes الافتراضي

/** YYYY-MM-DD بتوقيت مصر لليوم الحالي + offset. نفس تقويم الاقتراح بالظبط. */
function cairoDay(offsetDays) {
  const now = new Date();
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  cairo.setDate(cairo.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${cairo.getFullYear()}-${pad(cairo.getMonth() + 1)}-${pad(cairo.getDate())}`;
}

/**
 * إعدادات الاقتراح المضبوطة للقياس — **مش تغيير سلوك، فتح نافذة القياس**.
 *
 * الاقتراح الافتراضي بيرجّع **٣ أيام مفرودة** من أفق ٢١ يوم، فالسؤال «اليوم ده اتشال ولا لأ؟»
 * مالوش إجابة: اليوم ممكن يكون غايب لأنه مستبعد فعلاً، أو لأن `pickSpread` اختار غيره. رفع
 * العدد والأفق وتصفير التقارب بيخلّي الرد **كل** الأيام اللي فيها طاقة، فالغياب بقى معناه
 * الاستبعاد وبس. والكاش بيتصفّر عشان قراءتين بنفس المفتاح ما تتخبّطش.
 */
const MEASUREMENT_SETTINGS = {
  'booking.suggestion_count': 60,
  'booking.suggestion_horizon_days': 40,
  'booking.suggestion_min_day_spacing': 1,
  'booking.suggestion_min_hour_spacing': 1,
  'booking.suggestion_cache_ttl_seconds': 0,
};

/**
 * **الرجوع لقيم السجل، مش للقيمة اللي كانت في القاعدة** — إصلاح تلويث بيئة حقيقي اتلقط.
 *
 * النسخة الأولى كانت بتقرا القيمة الحالية وترجّعها في `finally`. المشكلة إن السكربت لو اتقتل
 * في نصّه (حصل فعلاً — تشغيل في الخلفية اتوقف)، `finally` مايخلصش والإعدادات تفضل ملوّثة.
 * وبعد كده **كل** تشغيل بياخد القيم الملوّثة كأنها «الأصل» وبيرجّعها بإخلاص — فالتلويث بيبقى
 * دائم. واكتشفناه لما قياس الأداء طلع p50 = 453ms بدل 7ms: الكاش كان لسه متعطّل من تشغيل قديم.
 *
 * القيم دي **لازم تطابق `apps/api/src/modules/settings/settings-registry.ts`**. لو الأدمن مغيّر
 * إعداد عن قصد، السكربت بيرجّعه للافتراضي — مقبول لسكربت تحقق بيجري على بيئة تطوير، والبديل
 * (الرجوع لقيمة ممكن تكون ملوّثة) أسوأ بكتير.
 */
const REGISTRY_DEFAULTS = {
  'booking.suggestion_count': 3,
  'booking.suggestion_horizon_days': 21,
  'booking.suggestion_min_day_spacing': 2,
  'booking.suggestion_min_hour_spacing': 3,
  'booking.suggestion_cache_ttl_seconds': 90,
};

async function main() {
  const h = new LiveHarness('wjs');
  await h.connect();
  const checks = [];
  const record = (label, ok, detail) => {
    checks.push([label, ok, detail]);
  };
  try {
    for (const [key, value] of Object.entries(MEASUREMENT_SETTINGS)) {
      await h.setSetting(key, value);
    }

    // مهلة الحجز الافتراضية ٤٨ ساعة، فأول يوم مقترح هو يومين من النهارده. بنشتغل بعدها بأمان.
    await h.seedCatalog({ priceCents: 25_000, durationMinutes: 60 });
    const customer = await h.makeCustomer('c');
    const busyTech = await h.makeTechnician('busy');
    const freeTech = await h.makeTechnician('free');

    /** بيحجز شغل حقيقي للفني في يوم معيّن بعدد دقايق معيّن. */
    const bookLoad = async (technicianId, day, minutes) => {
      await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,'accepted','individual',
                 ($6::text || ' 09:00')::timestamp AT TIME ZONE 'Africa/Cairo',$7,$8,25000,'cash',20.00)`,
        [
          customer.profileId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `WJS-${h.nextTag()}`,
          day,
          minutes,
          technicianId,
        ],
      );
    };

    /** بيقرا الأيام المقترحة. `duration`/`days` = null معناها السلوك القديم بالحرف. */
    const readDays = async ({ addressId = customer.addressId, durationMinutes = null, estimatedDays = null } = {}) => {
      const query = [`service_id=${h.catalog.service.id}`, `address_id=${addressId}`];
      if (durationMinutes !== null) query.push(`duration_minutes=${durationMinutes}`);
      if (estimatedDays !== null) query.push(`estimated_duration_days=${estimatedDays}`);
      const res = await h.api(`/booking-slots/days?${query.join('&')}`, { token: customer.token });
      if (res.status >= 400) return { status: res.status, days: null, body: res.body };
      // الرد ملفوف في مغلّف `{success, data, meta}` — القراءة من `body.days` مباشرةً كانت
      // بترجّع `undefined` وتخلّي كل فحص يفشل بنفس الشكل بلا أي إشارة للسبب.
      return { status: res.status, days: (res.body?.data ?? res.body)?.days ?? [] };
    };

    const dayOf = (result, day) => (result.days ?? []).find((row) => row.day === day) ?? null;

    // **الانتظار لحد ما إعدادات القياس تسري فعلاً** — مش تحسينًا، إصلاح تقلّب حقيقي اتلقط.
    //
    // `setSetting` بتمسح مفتاح الإعداد من Redis، بس نسخة الـAPI ممكن تكون لسه شايلة القيمة
    // القديمة لحظة النداء الأول. أول تشغيل بعد تغيير الإعدادات رجّع **٣ أيام مفرودة** (الافتراضي)
    // بدل الأفق كله، فأول فحص فشل بـ`undefined` — واليوم اللي بندوّر عليه مكانش مستبعد، كان بره
    // اختيار `pickSpread`. الاستطلاع ده بيخلّي الفحوص تبدأ بعد ما الإعداد يبان في الرد فعلاً.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const probe = await readDays();
      if ((probe.days?.length ?? 0) > 3) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // ════ فحص ١: شغلانة ٣ ساعات تستبعد اللي مالوش ٣ ساعات فاضية ════
    //
    // الفني عنده ٦٠٠ دقيقة محجوزة من ٧٢٠. شغلانة ٣ ساعات (١٨٠) ⇒ ٧٨٠ > ٧٢٠ ⇒ لازم يتشال.
    // بمدة الخدمة الافتراضية (٦٠) ⇒ ٦٦٠ ≤ ٧٢٠ ⇒ كان بيتعدّ متاح. ده الفرق بالظبط.
    const d3h = cairoDay(3);
    await bookLoad(busyTech.id, d3h, 600);

    const before3h = await readDays();
    const after3h = await readDays({ durationMinutes: 180 });
    const row3hBefore = dayOf(before3h, d3h);
    const row3hAfter = dayOf(after3h, d3h);

    record(
      'الضابط: من غير مدة، الفني المحمّل ٦٠٠/٧٢٠ بيتعدّ متاح لشغلانة ٣ ساعات',
      row3hBefore?.available_technicians === 2,
      `available=${row3hBefore?.available_technicians} status=${before3h.status} ` +
        `أيام=${before3h.days?.length} بندور على=${d3h} أول=${before3h.days?.[0]?.day} آخر=${before3h.days?.at(-1)?.day}`,
    );
    record(
      'بالمدة الحقيقية (١٨٠ د) الفني اللي مالوش ٣ ساعات فاضية بيتشال',
      row3hAfter?.available_technicians === 1,
      `available=${row3hAfter?.available_technicians}`,
    );

    // ════ فحص ٢: شغلانة ٥ أيام تستبعد اللي فاضي ٤ أيام ومشغول في الخامس ════
    //
    // ده جوهر البلاغ بالحرف. الفني مشغول **بس** في يوم البداية + ٤، وشغلانة ٥ أيام
    // (٥ × ٧٢٠ = ٣٦٠٠ دقيقة) بتاخد اليوم ده كامل ⇒ لازم يتشال من اقتراح **يوم البداية**.
    const start5d = cairoDay(10);
    const fifthDay = cairoDay(14);
    await bookLoad(busyTech.id, fifthDay, 120);

    const before5d = await readDays();
    const after5d = await readDays({ durationMinutes: 5 * DAY_MINUTES });
    const row5dBefore = dayOf(before5d, start5d);
    const row5dAfter = dayOf(after5d, start5d);

    record(
      'الضابط: يوم البداية فاضي فعلاً للاتنين لما المدى بيوم واحد',
      row5dBefore?.available_technicians === 2,
      `available=${row5dBefore?.available_technicians}`,
    );
    record(
      '**شغل ٥ أيام**: الفني المشغول في اليوم الخامس بيتشال من اقتراح يوم البداية',
      row5dAfter?.available_technicians === 1,
      `available=${row5dAfter?.available_technicians}`,
    );
    record(
      'الفني الفاضي بيفضل متاح — الاستبعاد مش شامل للكل',
      (row5dAfter?.available_technicians ?? 0) >= 1,
      `available=${row5dAfter?.available_technicians}`,
    );

    // ════ فحص ٣: `estimated_duration_days` لوحدها بتعمل نفس الشغل ════
    //
    // خدمات بتتقاس بالأيام (مفيش دقايق) لازم تتفحص بنفس المدى. لو ده فشل، يبقى كل خدمة
    // بتتسعّر باليوم لسه بتتقاس بيوم واحد.
    const after5dByDays = await readDays({ estimatedDays: 5 });
    const row5dByDays = dayOf(after5dByDays, start5d);
    record(
      'المدة بالأيام (بلا دقايق) بتفحص المدى كامل برضه',
      row5dByDays?.available_technicians === 1,
      `available=${row5dByDays?.available_technicians}`,
    );

    // ════ فحص ٤: الترتيب بيرجّح يوم البداية اللي وراه عرض أكبر ════
    //
    // بنحمّل الفني المشغول في نافذة شغلانة ١٠ أيام لو بدأت من يوم ٢٠، ونسيب نافذة يوم ٤٠ نضيفة.
    // الاقتراح المفروض يفضّل الأبعد **رغم غرامة التأخير** لأن العرض فيه ضعف.
    const congested = cairoDay(22);
    await bookLoad(busyTech.id, congested, DAY_MINUTES);
    const tenDay = await readDays({ durationMinutes: 10 * DAY_MINUTES });
    // بداية يوم ٢٠ نافذتها (٢٠..٢٩) فيها اليوم المزنوق ⇒ عرضها واحد.
    const congestedStart = dayOf(tenDay, cairoDay(20));
    // بداية يوم ٢٥ نافذتها (٢٥..٣٤) برّه اليوم المزنوق ⇒ عرضها اتنين.
    const clearStart = dayOf(tenDay, cairoDay(25));
    record(
      'شغل ١٠ أيام: يوم بداية نافذته فيها تعارض عرضه أقل',
      congestedStart?.available_technicians === 1,
      `available=${congestedStart?.available_technicians ?? 'مش مقترح'}`,
    );
    record(
      'شغل ١٠ أيام: يوم بداية نافذته نضيفة عرضه أكبر — الترتيب بقى ليه أساس حقيقي',
      clearStart?.available_technicians === 2,
      `available=${clearStart?.available_technicians ?? 'مش مقترح'}`,
    );

    // ════ فحص ٥: العنوان هو اللي بيحدد النتيجة فعلاً ════
    //
    // عنوان تاني في مدينة تانية (نطاقها مفيهوش أي فني). لو الاقتراح رجّع نفس الأيام، يبقى
    // `address_id` مالوش أثر — وده كان بيخلّي العميل اللي عنده عنوانين ياخد اقتراح نطاق غير نطاقه.
    const [otherCountry] = await h.q(`SELECT id FROM countries ORDER BY created_at ASC LIMIT 1`);
    const otherTag = h.nextTag();
    const [otherCity] = await h.q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, is_active) VALUES ($1,$2,$3,$4,true) RETURNING id`,
      [otherCountry.id, `مدينة تانية ${otherTag}`, `Other City ${otherTag}`, `wjs-other-${otherTag}`],
    );
    h.created.cityIds.push(otherCity.id);
    const [otherZone] = await h.q(
      `INSERT INTO service_zones (city_id, name_ar, name_en) VALUES ($1,$2,$3) RETURNING id`,
      [otherCity.id, `نطاق تاني ${otherTag}`, `Other Zone ${otherTag}`],
    );
    h.created.zoneIds.push(otherZone.id);
    const [secondAddressRow] = await h.q(
      `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
       VALUES ($1,$2,$3,'2',ST_SetSRID(ST_MakePoint(31.30,30.10),4326)::geography,false) RETURNING id`,
      [customer.userId, otherCity.id, 'شارع العنوان التاني'],
    );
    const secondAddressId = secondAddressRow.id;

    const onDefaultAddress = await readDays();
    const onSecondAddress = await readDays({ addressId: secondAddressId });
    record(
      'العنوان الافتراضي فيه أيام مقترحة (ضابط)',
      (onDefaultAddress.days?.length ?? 0) > 0,
      `عدد الأيام=${onDefaultAddress.days?.length}`,
    );
    record(
      'العنوان التاني (نطاق بلا فنيين) بيدّي نتيجة **مختلفة** — فالعنوان مؤثّر فعلاً',
      (onSecondAddress.days?.length ?? 0) === 0 || onSecondAddress.status >= 400,
      `status=${onSecondAddress.status} عدد الأيام=${onSecondAddress.days?.length ?? 'رفض'}`,
    );

    // ════ فحص ٦: الشغل القصير مابيتأثرش — مفيش انحدار ════
    //
    // شغلانة ساعة على يوم نضيف: نفس الناتج بالظبط قبل وبعد. لو ده فشل يبقى التغيير مس حالات
    // مكانش المفروض يمسها.
    const cleanDay = cairoDay(30);
    const shortBefore = dayOf(await readDays(), cleanDay);
    const shortAfter = dayOf(await readDays({ durationMinutes: 60 }), cleanDay);
    record(
      'شغلانة ساعة: نفس الناتج قبل وبعد — الشغل القصير مالمسوش',
      shortBefore?.available_technicians === shortAfter?.available_technicians,
      `قبل=${shortBefore?.available_technicians} بعد=${shortAfter?.available_technicians}`,
    );

    // ════ فحص ٧: اقتراح الساعات بياخد المدى كامل هو كمان (ADR-0100 §5) ════
    //
    // كان بيحقن `NULL::numeric` نصًا، فمداه كان يوم واحد مهما كانت المدة. بنسأله عن يوم بداية
    // شغلانة ٥ أيام والفني مشغول في يومها الخامس: المفروض عدد الفاضيين يقل.
    const readTimes = async (day, durationMinutes, estimatedDays) => {
      const query = [`service_id=${h.catalog.service.id}`, `address_id=${customer.addressId}`, `day=${day}`];
      if (durationMinutes !== null) query.push(`duration_minutes=${durationMinutes}`);
      if (estimatedDays != null) query.push(`estimated_duration_days=${estimatedDays}`);
      const res = await h.api(`/booking-slots/times?${query.join('&')}`, { token: customer.token });
      return { status: res.status, times: (res.body?.data ?? res.body)?.times ?? [] };
    };
    const timesShort = await readTimes(start5d, 60, null);
    const timesLong = await readTimes(start5d, 5 * DAY_MINUTES, 5);
    const maxFree = (result) => Math.max(0, ...result.times.map((slot) => slot.free_technicians));
    record(
      'اقتراح الساعات: شغلانة قصيرة فيها فاضيين (ضابط)',
      timesShort.status === 200 && maxFree(timesShort) === 2,
      `status=${timesShort.status} أقصى فاضيين=${maxFree(timesShort)}`,
    );
    record(
      'اقتراح الساعات: شغل ٥ أيام بيقل فيه العرض — المدى بقى متفحّص',
      timesLong.status === 200 && maxFree(timesLong) < maxFree(timesShort),
      `status=${timesLong.status} أقصى فاضيين=${maxFree(timesLong)}`,
    );
    record(
      'الحد الجديد بيقبل مدة أطول من يوم (كان بيترفض بـ400)',
      timesLong.status === 200,
      `status=${timesLong.status}`,
    );

    // **الفحص اللي بيعزل إصلاح `suggestTimes` بالظبط**: أيام بلا دقايق.
    //
    // الكود القديم كان بيحقن `estimatedDurationDaysExpr: 'NULL::numeric'` **نصًا**، فمدة بالأيام
    // ماكانش لها أي أثر: المدى بيتحسب من `$7` (اللي بيرجع لـ٦٠ دقيقة لما مفيش دقايق) ⇒ يوم واحد.
    // فالحالة دي كانت بتمرّ **بالغلط** حتى لما الفني مشغول في نص المدى. لو الفحص ده بقى ناجح
    // من غير الإصلاح، يبقى مابيقيسش حاجة.
    const timesDaysOnly = await readTimes(start5d, null, 5);
    record(
      'اقتراح الساعات: مدة بالأيام **بلا دقايق** بتفحص المدى — الحالة اللي `NULL::numeric` كانت بتخفيها',
      timesDaysOnly.status === 200 && maxFree(timesDaysOnly) === 1,
      `status=${timesDaysOnly.status} أقصى فاضيين=${maxFree(timesDaysOnly)}`,
    );

    await h.q(`DELETE FROM addresses WHERE id = $1`, [secondAddressId]);
    await h.deleteOrders(`order_number LIKE $1`, ['WJS-%']);
  } finally {
    for (const [key, value] of Object.entries(REGISTRY_DEFAULTS)) {
      await h.setSetting(key, value);
    }
    await h.cleanup();
    await h.close();
  }

  console.log('\n— الفحوص —');
  let allOk = true;
  for (const [label, ok, detail] of checks) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  (${detail})` : ''}`);
  }
  console.log(
    allOk
      ? '\n✅ الاقتراح بيقيس الشغل كامل، والعنوان مؤثّر، والشغل القصير مالمسوش.'
      : '\n❌ فيه فحص فشل.',
  );
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
