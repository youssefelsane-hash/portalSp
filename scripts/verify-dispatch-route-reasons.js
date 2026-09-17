/**
 * **تحقق حي: ليه الطلب راح Request بدل التأكيد التلقائي؟** (بلاغ مالك 2026-09-17، docs/08 §156).
 *
 * > «بعض الطلبات تذهب كـRequest رغم أن الموعد ليس قريبًا، والفني يبدو متاحًا… المهم معرفة سبب كل
 * >  transition فعليًا: هل بسبب `near_term`؟ `existing_requests`؟ `same_day_workload`؟»
 *
 * بيبني الحالات الأربعة الحقيقية على **بيانات واحدة** وبيقرا `matching-funnel` للأدمن، اللي
 * بيرجّع نفس قرار `scheduledDispatchDecision()` المستخدم في التنفيذ (مش إعادة حساب في الواجهة).
 *
 *   node scripts/verify-dispatch-route-reasons.js
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('drr');
  await h.connect();
  const rows = [];

  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 120 });
    await h.q(`UPDATE services SET allows_emergency = true WHERE id = $1`, [h.catalog.service.id]);
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeAdmin();

    const [{ value: nearTermHours }] = await h.q(
      `SELECT value FROM settings WHERE key = 'matching.near_term_request_hours'`,
    );

    /** بينشئ طلب بيدوّر على فني بموعد محدد. */
    const makeOrder = async (hoursFromNow, extra = {}) => {
      const scheduledAt = new Date(Date.now() + hoursFromNow * 3_600_000);
      const [order] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,'searching_technician','individual',$6,120,30000,'cash',20.00)
         RETURNING id`,
        [
          customer.profileId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `DRR-${h.nextTag()}`,
          scheduledAt.toISOString(),
        ],
      );
      if (extra.priorAssignment) {
        // «طلب اتبعت قبل كده» — سجل تاريخي، الطلب نفسه لسه بيدوّر.
        await h.q(
          `INSERT INTO order_assignments (order_id, technician_id, assignment_round, assignment_status,
             sent_at, expires_at, responded_at)
           VALUES ($1,$2,1,'timeout', now() - interval '3 hours', now() - interval '2 hours',
                   now() - interval '2 hours')`,
          [order.id, tech.id],
        );
      }
      return order.id;
    };

    /** بيقرا قرار التوزيع من نفس المصدر اللي التنفيذ بيستخدمه. */
    const readRoute = async (orderId) => {
      const res = await h.api(`/admin/orders/${orderId}/matching-funnel`, { token: admin.token });
      const body = res.body?.data ?? res.body;
      const d = body?.dispatch_route ?? body?.dispatchRoute ?? null;
      return d
        ? { route: d.route, reason: d.reason, nearTermHours: d.near_term_hours ?? d.nearTermHours }
        : { route: `status ${res.status}`, reason: JSON.stringify(body).slice(0, 200) };
    };

    /** بيدّي الفني شغل تاني في نفس يوم الطلب — من غير تقاطع وقت حقيقي. */
    const addSameDayWork = async (hoursFromNow, minutes) => {
      const at = new Date(Date.now() + hoursFromNow * 3_600_000);
      await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           total_amount_cents, payment_method, commission_rate_applied)
         VALUES ($1,$2,$3,$4,$5,'accepted','individual',$6,$7,$8,30000,'cash',20.00)`,
        [
          customer.profileId,
          h.catalog.service.id,
          customer.addressId,
          h.catalog.zone.id,
          `DRR-${h.nextTag()}`,
          at.toISOString(),
          minutes,
          tech.id,
        ],
      );
    };

    const expect = async (label, orderId, wantRoute, wantReason) => {
      const d = await readRoute(orderId);
      rows.push([label, d, d.route === wantRoute && d.reason === wantReason, `${wantRoute}/${wantReason}`]);
    };

    // ١) موعد بعيد، الفني فاضي بالكامل — الضابط.
    await expect('موعد بعيد (٧ أيام) + فني فاضي تمامًا', await makeOrder(24 * 7), 'auto_confirm', 'scheduled_far');

    // ٢) موعد قريب (داخل العتبة) — الجولات هنا **مقصودة**: العميل مستني حد قريب.
    await expect(
      `موعد قريب (${Math.round(nearTermHours / 2)}س، داخل العتبة)`,
      await makeOrder(nearTermHours / 2), 'rounds', 'near_term',
    );

    // ٣) حدود العتبة — قبلها بلحظة وبعدها بساعة.
    await expect(`عند العتبة بالظبط (${nearTermHours}س)`, await makeOrder(nearTermHours - 0.01), 'rounds', 'near_term');
    await expect(`بعد العتبة بساعة (${nearTermHours + 1}س)`, await makeOrder(nearTermHours + 1), 'auto_confirm', 'scheduled_far');

    // ٤) **موعد بعيد + عرض قديم منتهي**: تاريخ ميت مالوش أي أثر على قرار الحاضر.
    //    كان `rounds/existing_requests` قبل الإصلاح — العد كان بلا أي فلتر حالة.
    await expect(
      'موعد بعيد (٧ أيام) + عرض قديم منتهي (timeout) — تاريخ ميت',
      await makeOrder(24 * 7, { priorAssignment: true }), 'auto_confirm', 'scheduled_far',
    );

    // ٥) **موعد بعيد + شغل تاني بلا تقاطع وتحت السقف**: MEANINGFUL مش تعارض.
    //    كان `rounds/same_day_workload` قبل الإصلاح — ساعتين من ٧٢٠ دقيقة.
    const farOrderId = await makeOrder(24 * 7);
    await addSameDayWork(24 * 7 + 6, 120);
    await expect(
      'موعد بعيد + ساعتين شغل تاني نفس اليوم (تحت السقف، بلا تقاطع)',
      farOrderId, 'auto_confirm', 'scheduled_far',
    );

    // ٦) **الضابط المضاد**: من غيره «كله auto_confirm» ممكن يبقى صح لأن الحارس اتشال بالكامل.
    //
    // بنرجّع السلوك القديم بالإعداد على **نفس الطلب ونفس البيانات** بالظبط، والمفروض يرجع
    // `rounds/same_day_workload`. لو ما رجعش، يبقى الإصلاح شال الحارس بدل ما ضيّقه.
    // `SettingsService` عنده كاش محلي عمره `LOCAL_CACHE_TTL_MS` (ثانيتين افتراضيًا) فوق Redis،
    // فالقراءة بعد التغيير على طول ممكن ترجّع القيمة القديمة. الانتظار هنا **حتمي** مش استطلاع.
    const awaitSettingPropagation = () => new Promise((resolve) => setTimeout(resolve, 2500));

    // **الضابط المضاد للإعداد `auto_confirm_requires_idle_technician` مش هنا عن قصد.**
    //
    // تبديل الإعداد وسط التشغيل بيتعارض مع كاش `SettingsService` (كاش محلي ثانيتين فوق كاش
    // Redis بـ٦٠ ثانية)، فالقراءة بعد التبديل بترجّع لقطة قديمة والنتيجة بتتأخّر خطوة —
    // اتلقط فعليًا هنا: القراءة بعد `true` رجّعت القيمة القديمة، واللي بعد `false` رجّعت `true`.
    //
    // الفرع ده متغطّى في `dispatch-route-workload-gate.spec.ts` بحقن الإعدادات مباشرةً، وهو
    // المكان الصح لاختبار **فرع سياسة** بلا أي تعلّق بتوقيت كاش.

    // ٧) **الفني اللي عدّى سقفه مابيوصلش للتصنيف أصلاً**.
    //
    // ملاحظة مهمة اتكشفت بالقياس: `HEAVY`/`BLOCKED` مستبعدين من `technicianAvailabilityCondition`
    // نفسها، فـ`firstScheduledCandidate` مابترجعهمش خالص. يعني بعد الإصلاح فرع
    // `same_day_workload` مابيوصلّهوش إلا عبر الإعداد فوق — وده **مقصود**: الحارس كان بيكرّر
    // بوابة الإتاحة، ولما اتشال التكرار مافضلش غير اللي البوابة بتعمله أصلاً.
    const loadedOrderId = await makeOrder(24 * 9);
    await addSameDayWork(24 * 9 + 2, 700);
    await expect(
      'موعد بعيد + الفني يومه اتملى (٧٠٠ من ٧٢٠) — مفيش مرشّح، فمفيش تعيين تلقائي',
      loadedOrderId, 'auto_confirm', 'scheduled_far',
    );

    await h.deleteOrders(`order_number LIKE $1`, ['DRR-%']);
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log('\n— قرار التوزيع الفعلي لكل حالة —\n');
  let allOk = true;
  for (const [label, d, ok, want] of rows) {
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} ${label}`);
    console.log(`     → ${d.route}/${d.reason}   (المتوقع ${want}، عتبة=${d.nearTermHours ?? '—'}س)\n`);
  }
  console.log(allOk ? '✅ كل قرار توزيع له سبب حقيقي.' : '❌ فيه قرار توزيع مش مطابق للمتوقع.');
  if (!allOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
