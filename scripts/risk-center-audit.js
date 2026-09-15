#!/usr/bin/env node
/**
 * **تدقيق حي لمركز المخاطر والتلاعب** (ADR-0085، docs/08 §140).
 *
 * بيبني **فني متلاعب حقيقي** وسط أقران طبيعيين، وبيثبت السلسلة كاملة:
 *
 *   بيانات حقيقية → كاشف → إشارة بدليل → درجة مفسَّرة → طابور → حكم مراجع → الدرجة اتغيّرت
 *
 * **أهم فحصين هنا** مش «الشاشة بتشتغل»:
 *   ١. **الفني الطبيعي مابيتفتحش عليه إشارة.** شاشة بتتهم الكل مالهاش قيمة — بالعكس، بتخلّي
 *      الموظفين يتعلّموا يتجاهلوها، وساعتها المتلاعب الحقيقي بيعدّي وسط الضوضاء.
 *   ٢. **حكم «مشروعة» بينزّل الدرجة فورًا.** ده اللي بيخلّي المراجعة تعني حاجة.
 *
 * التشغيل: الـAPI لازم يكون شغّال. لو الـthrottle وقفه: `THROTTLE_LIMIT=100000 npm run start:dev`.
 */
'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');
const { LiveHarness } = require('./lib/live-harness');

const VERBOSE = process.argv.includes('--verbose');
const checks = [];
const failures = [];

function check(scenario, name, actual, expected, note) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push(ok);
  if (!ok) failures.push({ scenario, name, actual, expected, note });
  if (VERBOSE || !ok) {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` — طلع ${JSON.stringify(actual)}، المفروض ${JSON.stringify(expected)}${note ? ` (${note})` : ''}`}`);
  }
}

function assert(scenario, name, condition, note) {
  check(scenario, name, Boolean(condition), true, note);
}

async function main() {
  const h = new LiveHarness('rsk');
  await h.connect();
  const orderIds = [];
  const userIds = [];

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: 50000 });
    const admin = await h.makeAdmin();
    const freshStepUp = () => h.stepUpToken(admin.userId);

    // ═══ بناء المشهد: متلاعب + ٥ أقران طبيعيين ═══
    //
    // الأقران ضروريون: من غيرهم مفيش وسيط، ومن غير وسيط مفيش «شاذ». خمسة عشان يعدّوا
    // حارس `MIN_PEER_SAMPLE` (٤).
    console.log('\n═══ بناء المشهد: فني متلاعب وسط ٥ أقران طبيعيين ═══');

    const customers = [];
    for (let i = 0; i < 6; i += 1) customers.push(await h.makeCustomer(`c${i}`));
    userIds.push(...customers.map((c) => c.userId));

    const makeOrdersFor = async (tech, count, raisePriceOn) => {
      for (let i = 0; i < count; i += 1) {
        const customer = customers[i % customers.length];
        const [order] = await h.q(
          `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
             service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
             technician_id, technician_earning_cents, booking_mode, settlement_policy_version, created_at)
           VALUES (20,$1,$2,$3,$4,$5,'completed','paid',50000,50000,$6,0,'individual',2, now() - ($7 || ' days')::interval)
           RETURNING id`,
          [`${tech.label}${i}-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id,
           customer.addressId, catalog.zone.id, tech.id, String(i * 2 + 1)],
        );
        orderIds.push(order.id);
        if (i < raisePriceOn) {
          // **البند اللي الفني ضافه بنفسه** — ده اللي الكاشف بيقيسه، مش أي بند.
          await h.q(
            `INSERT INTO order_items (order_id, item_type, name_ar, description, quantity, unit_price_cents,
               total_price_cents, added_by_user_id, is_customer_approved, proposal_status)
             VALUES ($1,'spare_part','قطعة غيار','بديل تالف',1,30000,30000,$2,true,'approved')`,
            [order.id, tech.userId],
          );
        }
      }
    };

    const peers = [];
    for (let i = 0; i < 5; i += 1) {
      const peer = await h.makeTechnician(`p${i}`);
      peer.label = `RSKP${i}`;
      peers.push(peer);
      userIds.push(peer.userId);
      // الأقران: زيادة سعر في ١ من ٨ طلبات (≈١٢٪) — سلوك طبيعي تمامًا.
      await makeOrdersFor(peer, 8, 1);
    }

    const cheater = await h.makeTechnician('bad');
    cheater.label = 'RSKBAD';
    userIds.push(cheater.userId);
    // المتلاعب: زيادة سعر في ٧ من ٨ (≈٨٨٪) — أضعاف وسيط أقرانه.
    await makeOrdersFor(cheater, 8, 7);

    console.log('  الأقران: ٥ فنيين × ٨ طلبات، زيادة سعر في ١٢٪ منها');
    console.log('  المتلاعب: ٨ طلبات، زيادة سعر في ٨٨٪ منها');

    // ═══ ١ — تشغيل الكاشفات ═══
    console.log('\n═══ ١ — الكاشفات بتلقط المتلاعب وبتسيب الطبيعي ═══');
    const run = await h.api('/admin/risk-center/run-detectors', {
      method: 'POST', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() },
      body: { window_days: 90 },
    });
    check('كاشفات', 'تشغيل الكاشفات عدّى', run.status, 201,
      run.status !== 201 ? JSON.stringify(run.body?.error ?? '').slice(0, 200) : undefined);
    if (run.status === 201) {
      const failed = (run.body.data ?? []).filter((r) => r.error);
      check('كاشفات', 'مفيش كاشف وقع', failed.map((f) => f.detector), [],
        failed.length ? JSON.stringify(failed[0].error).slice(0, 160) : undefined);
    }

    const [cheaterSignals] = await h.q(
      `SELECT COUNT(*)::int AS n FROM risk_signals WHERE actor_user_id = $1`, [cheater.userId]);
    assert('كاشفات', '**المتلاعب اتفتحت عليه إشارة**', cheaterSignals.n >= 1,
      `عدد الإشارات = ${cheaterSignals.n}`);

    const [peerSignals] = await h.q(
      `SELECT COUNT(*)::int AS n FROM risk_signals WHERE actor_user_id = ANY($1::uuid[])`,
      [peers.map((p) => p.userId)]);
    check('كاشفات', '**الأقران الطبيعيون مالهمش أي إشارة**', peerSignals.n, 0,
      'شاشة بتتهم الكل بتتعوّد الناس تتجاهلها');

    // ═══ ٢ — الدليل مفسَّر ═══
    console.log('\n═══ ٢ — الإشارة بتيجي بدليلها الرقمي ═══');
    const signals = await h.api(`/admin/risk-center/actors/${cheater.userId}/signals`, { token: admin.token });
    check('دليل', 'قراءة إشارات الشخص عدّت', signals.status, 200);
    const priceSignal = (signals.body?.data ?? []).find((s) => s.signal_type_code === 'price_increase_rate_vs_peers');
    assert('دليل', 'إشارة زيادة السعر موجودة', Boolean(priceSignal));
    if (priceSignal) {
      const ev = priceSignal.evidence ?? {};
      assert('دليل', 'الدليل فيه النسبة المقاسة', typeof ev.measured_pct === 'number');
      assert('دليل', 'الدليل فيه وسيط الأقران', typeof ev.peer_median_pct === 'number');
      assert('دليل', 'الدليل فيه حجم عيّنة الأقران', Number(ev.peer_count) >= 4);
      assert('دليل', '**المقاس أعلى من وسيط الأقران فعلاً**',
        Number(ev.measured_pct) > Number(ev.peer_median_pct),
        `${ev.measured_pct}% مقابل ${ev.peer_median_pct}%`);
      if (VERBOSE) console.log(`    المقاس ${ev.measured_pct}% · وسيط الأقران ${ev.peer_median_pct}% · ${ev.peer_count} قرين`);
    }

    // ═══ ٣ — الدرجة والتفسير ═══
    console.log('\n═══ ٣ — الدرجة بتيجي مفسَّرة سطر بسطر ═══');
    const profile = await h.api(`/admin/risk-center/actors/${cheater.userId}`, { token: admin.token });
    check('درجة', 'ملف المخاطر عدّى', profile.status, 200,
      profile.status !== 200 ? JSON.stringify(profile.body?.error ?? '').slice(0, 200) : undefined);
    const scoreBefore = profile.body?.data?.score ?? 0;
    assert('درجة', 'الدرجة أكبر من صفر', scoreBefore > 0, `الدرجة = ${scoreBefore}`);
    assert('درجة', '**التفسير مبعوت مع الدرجة**',
      Array.isArray(profile.body?.data?.score_breakdown) && profile.body.data.score_breakdown.length > 0);
    assert('درجة', 'كل سطر فيه مساهمته وعامل اضمحلاله',
      (profile.body?.data?.score_breakdown ?? []).every(
        (l) => typeof l.contribution === 'number' && typeof l.decayFactor === 'number'));
    assert('درجة', 'الاقتراح مبعوت ومعلَّم إنه **مش آلي**',
      profile.body?.data?.suggested_action?.automatic === false);
    if (VERBOSE) {
      const totals = profile.body?.data?.bucket_totals ?? {};
      console.log(`    الدرجة ${scoreBefore} · ${JSON.stringify(
        Object.fromEntries(Object.entries(totals).filter(([, v]) => Number(v) > 0)))}`);
    }
    assert('درجة', 'إساءة التسعير ليها مساهمة موجبة',
      Number(profile.body?.data?.bucket_totals?.pricing_abuse ?? 0) > 0);

    // ═══ ٤ — الطابور: صف لكل شخص ═══
    console.log('\n═══ ٤ — الطابور: ناس مش أحداث ═══');
    const queue = await h.api('/admin/risk-center/queue?limit=200', { token: admin.token });
    check('طابور', 'الطابور عدّى', queue.status, 200);
    const row = (queue.body?.data ?? []).find((r) => r.actorUserId === cheater.userId);
    assert('طابور', 'المتلاعب في الطابور', Boolean(row));
    if (row) {
      // **المتلاعب المزروع بيتلاعب في الاتنين**: بيزوّد السعر ببنود قطع غيار غالية بلا إيصال،
      // فبيتفتح عليه إشارات في `pricing_abuse` و`parts_manipulation` مع بعض. تثبيت «الغالب»
      // على واحد بعينه كان هيبقى اختبار هش بيقيس ترتيب أوزان بدل ما يقيس سلوك — فبنتأكد إن
      // الغالب واحد من الاتنين اللي بيتلاعب فيهم فعلاً، وإن الاتنين ليهم مساهمة موجبة.
      assert('طابور', 'الـbucket الغالب من اللي بيتلاعب فيه فعلاً',
        ['pricing_abuse', 'parts_manipulation'].includes(row.topBucket), `طلع ${row.topBucket}`);
      assert('طابور', 'الأسباب الأساسية مكتوبة بالعربي', (row.topReasons ?? []).length > 0);
      // «الفلوس المعرّضة» لازم تكون رقم حقيقي من الطلبات اللي عليها إشارة — مش صفر ولا undefined.
      assert('طابور', '**الفلوس المعرّضة محسوبة من طلبات فعلية**',
        typeof row.moneyAtRiskCents === 'number' && row.moneyAtRiskCents > 0,
        `طلع ${row.moneyAtRiskCents}`);
      assert('طابور', 'عدّاد الشكاوى مبعوت', typeof row.complaintsAgainst === 'number');
    }
    const peerInQueue = (queue.body?.data ?? []).filter((r) => peers.some((p) => p.userId === r.actorUserId));
    check('طابور', 'مفيش قرين طبيعي في الطابور', peerInQueue.length, 0);

    // الترتيبات الخمسة اللي المالك طلبها بالاسم — كلها لازم ترد ٢٠٠ وتفضل بتشمل المتلاعب.
    for (const sort of ['score', 'money', 'complaints', 'frequency', 'recent']) {
      const sorted = await h.api(`/admin/risk-center/queue?limit=200&sort=${sort}`, { token: admin.token });
      assert('طابور', `ترتيب «${sort}» شغّال والمتلاعب لسه فيه`,
        sorted.status === 200 && (sorted.body?.data ?? []).some((r) => r.actorUserId === cheater.userId),
        `status=${sorted.status}`);
    }
    const badSort = await h.api('/admin/risk-center/queue?sort=whatever', { token: admin.token });
    check('طابور', 'ترتيب مش معروف بيترفض', badSort.status, 400);

    // ═══ ٥ — حكم المراجع بيغيّر الدرجة فورًا ═══
    console.log('\n═══ ٥ — حكم المراجع بيغيّر الدرجة في نفس اللحظة ═══');
    if (priceSignal) {
      const verdict = await h.api(`/admin/risk-center/signals/${priceSignal.id}/verdict`, {
        method: 'POST', token: admin.token,
        body: { verdict: 'legitimate', notes: 'راجعنا الطلبات: كلها أعطال كبيرة موثّقة بصور وإيصالات.' },
      });
      check('حكم', 'تسجيل الحكم عدّى', verdict.status, 201,
        verdict.status !== 201 ? JSON.stringify(verdict.body?.error ?? '').slice(0, 200) : undefined);

      const after = await h.api(`/admin/risk-center/actors/${cheater.userId}`, { token: admin.token });
      const scoreAfter = after.body?.data?.score ?? 0;
      assert('حكم', '**الدرجة نزلت بعد «مشروعة» فورًا**', scoreAfter < scoreBefore,
        `${scoreBefore} → ${scoreAfter}`);
      check('حكم', 'الإشارة المرفوضة اتعدّت في العدّاد', after.body?.data?.dismissed_count, 1);
      if (VERBOSE) console.log(`    الدرجة ${scoreBefore} → ${scoreAfter}`);

      // حكم بلا سبب مكتوب لازم يترفض — حكم بيغيّر درجة إنسان محتاج سطر يفسّره.
      const noNotes = await h.api(`/admin/risk-center/signals/${priceSignal.id}/verdict`, {
        method: 'POST', token: admin.token, body: { verdict: 'suspicious', notes: 'ok' },
      });
      check('حكم', 'حكم بسبب أقل من ١٠ حروف بيترفض', noNotes.status, 400);
    }

    // ═══ ٦ — الحالة والإجراء ═══
    console.log('\n═══ ٦ — الحالة والإجراء المتدرّج ═══');
    const openCase = await h.api(`/admin/risk-center/actors/${cheater.userId}/case`, {
      method: 'POST', token: admin.token,
      body: { status: 'investigating', notes: 'فتح تحقيق بعد مراجعة إشارات التسعير' },
    });
    check('حالة', 'فتح الحالة عدّى', openCase.status, 201,
      openCase.status !== 201 ? JSON.stringify(openCase.body?.error ?? '').slice(0, 200) : undefined);

    const noStepUp = await h.api(`/admin/risk-center/actors/${cheater.userId}/actions`, {
      method: 'POST', token: admin.token,
      body: { action_type: 'manual_review', reason: 'مراجعة يدوية بعد إشارات متكررة' },
    });
    check('إجراء', '**الإجراء بلا step-up بيترفض**', noStepUp.status, 403,
      'ده أقوى فعل في الشاشة وممكن يوقف رزق إنسان');

    const action = await h.api(`/admin/risk-center/actors/${cheater.userId}/actions`, {
      method: 'POST', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() },
      body: { action_type: 'manual_review', reason: 'مراجعة يدوية بعد إشارات تسعير متكررة' },
    });
    check('إجراء', 'الإجراء بـstep-up عدّى', action.status, 201,
      action.status !== 201 ? JSON.stringify(action.body?.error ?? '').slice(0, 200) : undefined);

    const [actionRow] = await h.q(
      `SELECT evidence_snapshot, previous_state, new_state, score_at_action
         FROM risk_actions WHERE actor_user_id = $1 ORDER BY created_at DESC LIMIT 1`, [cheater.userId]);
    assert('إجراء', '**لقطة الدليل اتخزنت مع القرار**',
      actionRow && actionRow.evidence_snapshot && Array.isArray(actionRow.evidence_snapshot.lines),
      'المراجعة بعد شهور لازم تشوف اللي المنفّذ شافه');
    assert('إجراء', 'الحالة قبل وبعد مسجّلة',
      Boolean(actionRow && actionRow.previous_state && actionRow.new_state));

    // ═══ ٧ — إعادة التشغيل مابتكررش ومابتمسحش حكم ═══
    console.log('\n═══ ٧ — إعادة تشغيل الكاشفات آمنة ═══');
    const [beforeRerun] = await h.q(`SELECT COUNT(*)::int AS n FROM risk_signals WHERE actor_user_id = $1`,
      [cheater.userId]);
    await h.api('/admin/risk-center/run-detectors', {
      method: 'POST', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() }, body: { window_days: 90 },
    });
    const [afterRerun] = await h.q(`SELECT COUNT(*)::int AS n FROM risk_signals WHERE actor_user_id = $1`,
      [cheater.userId]);
    check('تكرار', 'عدد الإشارات ماتغيّرش بعد إعادة التشغيل', afterRerun.n, beforeRerun.n);

    if (priceSignal) {
      const [stillJudged] = await h.q(`SELECT verdict FROM risk_signals WHERE id = $1`, [priceSignal.id]);
      check('تكرار', '**حكم المراجع مااتمسحش بإعادة التشغيل**', stillJudged?.verdict, 'legitimate',
        'كاشف بيمسح شغل الموظفين كل ٦ ساعات بيخلّيهم يبطّلوا يراجعوا');
    }

    // ═══ ٨ — الصلاحيات ═══
    console.log('\n═══ ٨ — الصلاحيات ═══');
    const asCustomer = await h.api('/admin/risk-center/queue', { token: customers[0].token });
    assert('صلاحيات', 'عميل مايقدرش يفتح الطابور', asCustomer.status === 403 || asCustomer.status === 401,
      `status=${asCustomer.status}`);
  } finally {
    for (const orderId of orderIds.filter(Boolean)) {
      try {
        execFileSync(process.execPath, [join(__dirname, 'clean-test-data.js'), '--order', orderId], { stdio: 'ignore' });
      } catch { /* التنظيف أفضل جهد */ }
    }
    try {
      await h.q(`DELETE FROM risk_actions WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
      await h.q(`DELETE FROM risk_cases WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
      await h.q(`DELETE FROM risk_signals WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
    } catch { /* ignore */ }
    await h.cleanup();

    const passed = checks.filter(Boolean).length;
    console.log(`\n═══ النتيجة ═══\n${passed}/${checks.length} فحص نضيف`);
    if (failures.length) {
      console.log('\n🔴 الفحوص اللي فشلت:');
      for (const f of failures) console.log(`  [${f.scenario}] ${f.name}: طلع ${JSON.stringify(f.actual)} المفروض ${JSON.stringify(f.expected)}${f.note ? ` — ${f.note}` : ''}`);
    } else {
      console.log('🟢 مركز المخاطر شغّال من البيانات للقرار.');
    }
    process.exit(failures.length ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('❌ التدقيق وقع:', err && err.message);
  process.exit(1);
});
