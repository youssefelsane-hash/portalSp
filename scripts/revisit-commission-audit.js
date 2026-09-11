#!/usr/bin/env node
/**
 * **بلاغ المالك 2026-09-11**: «الطلب لما راح لحد بصفر فلوس… الفني هناك اكتشف إنه محتاج يزوّد
 * فلوس لأنه اشترى قطعة. الفلوس دي المنصة ما بتاخدش منها أي حاجة خالص… السعر كله بيدخل في
 * الحصالة بتاعته هو، المنصة زيرو».
 *
 * التدقيق ده بيمشي **مسار الكود الحقيقي** (الفني يقترح بند عبر الـAPI ← العميل يوافق عبر
 * الـAPI ← `OrderItemsService.approve` ← `OrderFinancialFinalizationService.increasePrice`)
 * وبعدين بيقرا الأرقام من القاعدة ويطبّق `splitOrderRevenue` بالحرف.
 *
 * ملحوظة مهمة لأي حد هيعدّل الملف ده: النسخة الأولى منه كانت بتحاكي الزيادة بـ`UPDATE` خام.
 * دي كانت كفاية لإثبات البَقّة، بس **مستحيل تتحقق من الإصلاح** لأنها مابتعديش على الكود
 * اللي بيصلّح. أي تدقيق مالي هنا لازم يعدّي من الـAPI.
 */
'use strict';

const { execFileSync } = require('child_process');
const { join } = require('path');
const { LiveHarness } = require('./lib/live-harness');

const egp = (c) => `${(c / 100).toFixed(2)} ج.م`;
const SERVICE_COMMISSION = 20;
const PART_CENTS = 30_000;

async function main() {
  const h = new LiveHarness('rvc');
  await h.connect();
  let exitCode = 0;

  try {
    if (!(await h.isApiUp())) {
      console.error('❌ الـAPI مش شغّال');
      process.exit(1);
    }

    const catalog = await h.seedCatalog({ priceCents: 50_000 });
    await h.q(`UPDATE services SET commission_percentage = $2 WHERE id = $1`, [
      catalog.service.id,
      SERVICE_COMMISSION,
    ]);
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');

    // ① الطلب الأصلي المكتمل — الأب اللي إعادة الزيارة بتتعلّق بيه.
    const [normal] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
         service_zone_id, technician_id, order_status, payment_status, total_amount_cents,
         commissionable_base_cents, technician_earning_cents, booking_mode, settlement_policy_version)
       VALUES ($7,$1,$2,$3,$4,$5,$6,'completed','paid',50000,50000,0,'individual',2) RETURNING id`,
      [`RVC-N-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
       catalog.zone.id, tech.id, SERVICE_COMMISSION],
    );

    // ② إعادة الزيارة تحت الضمان: بتتعمل بصفر فلوس ونسبة عمولة صفر مثبّتة — ده السلوك الصح
    //    للشغل المجاني نفسه، والمقصود اختباره هو الشغل **الجديد المدفوع** اللي بيتضاف بعد كده.
    //    بتتعمل هنا بـSQL عشان التدقيق يركّز على مسار الفلوس، مش على شروط أهلية الضمان.
    const [revisit] = await h.q(
      `INSERT INTO orders (commission_rate_applied, order_number, customer_id, service_id, address_id,
         service_zone_id, technician_id, parent_order_id, order_type, order_status, payment_status,
         total_amount_cents, commissionable_base_cents, technician_earning_cents, booking_mode,
         settlement_policy_version)
       VALUES (0,$1,$2,$3,$4,$5,$6,$7,'revisit','in_progress','pending',0,0,0,'individual',2)
       RETURNING id, commission_rate_applied`,
      [`RVC-R-${h.runId}`.slice(0, 24), customer.profileId, catalog.service.id, customer.addressId,
       catalog.zone.id, tech.id, normal.id],
    );

    console.log('════ طلب إعادة زيارة تحت الضمان ════');
    console.log(
      `نسبة العمولة المثبّتة على الطلب: ${revisit.commission_rate_applied}%   (الخدمة: ${SERVICE_COMMISSION}%)`,
    );

    // ③ الفني اشترى قطعة غيار والعميل وافق — **عبر الـAPI**، مسار الإنتاج بالحرف.
    const proposed = await h.api(`/technician/orders/${revisit.id}/quote-items`, {
      method: 'POST',
      token: tech.token,
      body: {
        items: [
          {
            item_type: 'spare_part',
            name_ar: 'قطعة غيار (تدقيق)',
            quantity: 1,
            unit_price_cents: PART_CENTS,
          },
        ],
      },
    });
    if (proposed.status !== 201 && proposed.status !== 200) {
      throw new Error(`اقتراح البند فشل (${proposed.status}): ${JSON.stringify(proposed.body)}`);
    }

    const approved = await h.api(`/orders/${revisit.id}/quote-items/approve`, {
      method: 'POST',
      token: customer.token,
      body: { payment_choice: 'cash' },
    });
    if (approved.status !== 201 && approved.status !== 200) {
      throw new Error(`موافقة العميل فشلت (${approved.status}): ${JSON.stringify(approved.body)}`);
    }

    const [after] = await h.q(
      `SELECT total_amount_cents, commissionable_base_cents, commission_rate_applied FROM orders WHERE id=$1`,
      [revisit.id],
    );

    // ④ نفس معادلة `splitOrderRevenue` بالحرف.
    const rate = Number(after.commission_rate_applied);
    const base = Number(after.commissionable_base_cents);
    const total = Number(after.total_amount_cents);
    const technicianEarning = base - Math.round((base * rate) / 100);
    const platformCommission = total - technicianEarning;

    const expectedTech = PART_CENTS - Math.round((PART_CENTS * SERVICE_COMMISSION) / 100);
    const expectedPlatform = PART_CENTS - expectedTech;

    console.log('');
    console.log(`بعد ما الفني ضاف قطعة غيار بـ${egp(PART_CENTS)} والعميل وافق (عبر الـAPI):`);
    console.log(`   إجمالي الطلب        : ${egp(total)}`);
    console.log(`   وعاء العمولة        : ${egp(base)}`);
    console.log(`   النسبة المطبّقة      : ${rate}%`);
    console.log(`   ← نصيب الفني        : ${egp(technicianEarning)}`);
    console.log(`   ← نصيب المنصة       : ${egp(platformCommission)}`);
    console.log('');
    console.log(`المتوقع: الفني ${egp(expectedTech)} / المنصة ${egp(expectedPlatform)}`);
    console.log('');

    if (technicianEarning === expectedTech && platformCommission === expectedPlatform) {
      console.log('🟢 المنصة بتاخد نصيبها من الشغل الجديد المدفوع، والزيارة نفسها فضلت مجانية.');
    } else {
      exitCode = 1;
      console.log('🔴 **المنصة مش بتاخد نصيبها من الشغل المدفوع المضاف على إعادة الزيارة.**');
    }

    // التنظيف عبر الأداة الموجودة — بتسأل `pg_constraint` عن الجداول المرتبطة فعلاً بدل
    // قايمة مكتوبة بالإيد (الحذف اليدوي هنا فشل فعلاً على `order_status_history`).
    for (const orderId of [revisit.id, normal.id]) {
      execFileSync(process.execPath, [join(__dirname, 'clean-test-data.js'), '--order', orderId], {
        stdio: 'ignore',
      });
    }
  } finally {
    await h.cleanup();
    await h.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
