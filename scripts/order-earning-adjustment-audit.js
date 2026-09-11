#!/usr/bin/env node
/**
 * **تدقيق حي لاستثناء مستحقات الطلب الواحد على الـAPI الحقيقي** (docs/08 §136).
 *
 * `order-earning-adjustment.spec.ts` بيغطّي الخدمة والحسبة بعمق، لكنه بينادي الخدمة مباشرة —
 * يعني بيعدّي من فوق **الحراسات اللي بتقف على الـHTTP**: الصلاحية الدقيقة، وstep-up،
 * والتحقق من المدخلات في الـDTO. السكربت ده بيقيس دول بالظبط:
 *
 *   ١. بلا `x-step-up-token` الطلب بيترفض (٤٠٣) — ده تعديل على فلوس، مش إعداد عادي.
 *   ٢. عميل عادي مايقدرش يلمس المسار أصلاً.
 *   ٣. الحفظ والقراءة والإلغاء بيشتغلوا من الأول للآخر.
 *   ٤. قيمة خارج حدود الـ`CHECK` بتترفض بـ٤٠٠ من الـDTO، مش بـ٥٠٠ من الداتابيز.
 *   ٥. الإلغاء **بيعطّل** الصف مش بيمسحه — السجل لازم يفضل شايل القرار.
 *
 * **توكن step-up بيُستهلك مرة واحدة** (سلوك صحيح ومقصود)، فكل عملية هنا بتاخد توكن جديد.
 * أول نسخة من السكربت ده أعادت استخدام توكن واحد وفشلت — وده أكّد إن الحارس شغّال فعلاً.
 *
 * التشغيل: الـAPI لازم يكون شغّال. لو الـthrottle وقفه: `THROTTLE_LIMIT=100000 npm run start:dev`.
 */
'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');
const { LiveHarness } = require('./lib/live-harness');
const checks = []; const fails = [];
function check(name, actual, expected, note) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push(ok); if (!ok) fails.push({ name, actual, expected, note });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : ` — طلع ${JSON.stringify(actual)} المفروض ${JSON.stringify(expected)}${note ? ` (${note})` : ''}`}`);
}
(async () => {
  const t = setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 90000);
  const h = new LiveHarness('oeh');
  await h.connect();
  const orderIds = [];
  try {
    if (!(await h.isApiUp())) { console.error('API مش شغّال'); process.exit(1); }
    const catalog = await h.seedCatalog({ priceCents: 100000 });
    const customer = await h.makeCustomer('c');
    const admin = await h.makeAdmin();
    const leader = await h.makeTechnician('l');
    const assistant = await h.makeTechnician('a');
    // توكن step-up **يُستهلك مرة واحدة** (سلوك صحيح) — فلكل عملية توكن جديد.
    const freshStepUp = () => h.stepUpToken(admin.userId);

    const [order] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
         service_zone_id, order_status, payment_status, total_amount_cents, commissionable_base_cents,
         technician_id, technician_earning_cents, booking_mode, settlement_policy_version)
       VALUES (20,$1,$2,$3,$4,$5,'work_completed','unpaid',100000,100000,$6,0,'team',2) RETURNING id`,
      [`OEH-${h.runId}`.slice(0,24), customer.profileId, catalog.service.id, customer.addressId, catalog.zone.id, leader.id]);
    orderIds.push(order.id);
    await h.q(`INSERT INTO order_team_members (order_id, technician_id, role_label, member_type, added_by_technician_id)
               VALUES ($1,$2,'مساعد','assistant',$3)`, [order.id, assistant.id, leader.id]);

    const base = `/admin/earnings-policy/orders/${order.id}/adjustments`;

    // ① الحارس الأمني: بلا step-up لازم يترفض
    const noStepUp = await h.api(base, { method: 'POST', token: admin.token,
      body: { technician_id: leader.id, adjustment_bps: 2000, reason: 'بلا تحقق إضافي' } });
    check('بلا step-up بيترفض', noStepUp.status, 403, JSON.stringify(noStepUp.body?.error ?? '').slice(0,120));

    // ② عميل عادي مايقدرش يلمسه
    const asCustomer = await h.api(base, { method: 'POST', token: customer.token,
      body: { technician_id: leader.id, adjustment_bps: 2000, reason: 'عميل' } });
    check('عميل بيترفض', asCustomer.status === 403 || asCustomer.status === 401, true, `status=${asCustomer.status}`);

    // ③ الحفظ الحقيقي
    const created = await h.api(base, { method: 'POST', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() },
      body: { technician_id: leader.id, adjustment_bps: 2000, reason: 'الشغلانة كانت أصعب' } });
    check('الحفظ عدّى', created.status, 201, JSON.stringify(created.body?.error ?? '').slice(0,200));

    // ④ القراءة بتعرض النشط
    const listed = await h.api(base, { token: admin.token });
    check('القراءة عدّت', listed.status, 200);
    check('عدد الاستثناءات النشطة', listed.body?.data?.items?.length, 1);
    check('التسوية لسه مفتوحة', listed.body?.data?.is_settled, false);

    // ⑤ التحقق من صحة المدخلات
    const bad = await h.api(base, { method: 'POST', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() },
      body: { technician_id: leader.id, adjustment_bps: 999999, reason: 'خارج الحد' } });
    check('قيمة خارج الحد بتترفض', bad.status, 400);

    // ⑥ الإلغاء
    const removed = await h.api(`${base}/${leader.id}`, { method: 'DELETE', token: admin.token,
      headers: { 'x-step-up-token': await freshStepUp() }, body: { reason: 'اتضح إنه مش مستحق' } });
    check('الإلغاء عدّى', removed.status, 200, JSON.stringify(removed.body?.error ?? '').slice(0,200));
    const after = await h.api(base, { token: admin.token });
    check('القايمة فضيت بعد الإلغاء', after.body?.data?.items?.length, 0);

    // ⑦ الصف فضل موجود معطّل — السجل مابيتمسحش
    const [row] = await h.q(`SELECT disabled_at IS NOT NULL AS off FROM order_earning_adjustments WHERE order_id=$1`, [order.id]);
    check('الصف اتعطّل مش اتمسح', row?.off, true);
  } catch (err) {
    console.error('❌ التدقيق وقع:', err && err.message);
    fails.push({ name: 'تشغيل التدقيق', actual: String(err && err.message), expected: 'بلا استثناءات' });
  } finally {
    for (const id of orderIds) {
      try { execFileSync(process.execPath, [join(__dirname, 'clean-test-data.js'), '--order', id], { stdio: 'ignore' }); } catch {}
    }
    await h.cleanup();
    console.log(`\n${checks.filter(Boolean).length}/${checks.length} فحص نضيف`);
    console.log(fails.length ? '🔴 فيه فحص فشل.' : '🟢 مسار استثناء الطلب سليم على الـAPI.');
    clearTimeout(t); process.exit(fails.length ? 1 : 0);
  }
})();
