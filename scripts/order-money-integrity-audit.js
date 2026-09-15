#!/usr/bin/env node
/**
 * **تدقيق سلامة فلوس الطلب من لحظة الإنشاء** (بلاغ مالك 2026-09-13، docs/08 §145).
 *
 * البلاغ: طلب بـ١٢٠ ج.م راحت **كلها** عمولة للمنصة ومستحق الفني صفر.
 *
 * ## ليه ملف جديد جنب `money-paths-audit.js` مش توسعة ليه
 *
 * `money-paths-audit.js` بيزرع الطلب في القاعدة بـ`commissionable_base_cents = total_amount_cents`
 * (السطر 63-71 فيه بالحرف)، يعني بيفترض إن **وعاء العمولة متحسب صح** وبيتأكد من التوزيع بعده.
 * التدقيق ده بيغطي الحتة اللي فاتت بالظبط: **إنشاء الطلب من الـAPI الحقيقي**، واللي فيه
 * `computeCommissionableBase()` بيتنفّذ لأول مرة. البقّة اللي المالك بلّغ عنها عايشة هناك،
 * وعشان كده عدّت من التدقيق القايم.
 *
 * كل طلب هنا بيتعمل بنداء `POST /orders` حقيقي، وبتتفحص الأعمدة المخزّنة زي ما هي.
 *
 * التشغيل: `node scripts/order-money-integrity-audit.js [--verbose]`
 * محتاج API شغّال. لو الـthrottle وقفه: THROTTLE_LIMIT=100000 npm run start:dev
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const h = new LiveHarness('omi');
const VERBOSE = process.argv.includes('--verbose');
const findings = [];
let pass = 0;

const egp = (c) => `${(Number(c) / 100).toFixed(2)} ج.م`;

function check(group, name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    findings.push({ group, name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function eq(group, name, actual, expected) {
  check(group, name, actual === expected, `طلع ${JSON.stringify(actual)} المفروض ${JSON.stringify(expected)}`);
}

/** بيعمل خدمة بإعدادات تسعير محددة عشان نقيس أثرها على وعاء العمولة. */
async function makeService(label, { priceCents, commissionPct, inspectionFeeCents = 0, minPriceCents = null, maxPriceCents = null }) {
  const runId = h.nextTag();
  const [service] = await h.q(
    `INSERT INTO services (category_id, name_ar, slug, pricing_model, base_price_cents,
        estimated_duration_minutes, is_active, allows_individual, allows_team, allows_emergency,
        allows_scheduling, commission_percentage, inspection_fee_cents, min_price_cents, max_price_cents)
     VALUES ($1,$2,$3,'formula',$4,60,true,true,false,true,true,$5,$6,$7,$8) RETURNING id`,
    [h.catalog.category.id, `خدمة ${label} ${runId}`, `omi-${label}-${runId}`.toLowerCase(),
     priceCents, commissionPct, inspectionFeeCents, minPriceCents, maxPriceCents],
  );
  h.created.serviceIds.push(service.id);
  return service.id;
}

async function linkTechnician(serviceId, techId) {
  await h.q(
    `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
     VALUES ($1,$2,true,'approved') ON CONFLICT DO NOTHING`,
    [techId, serviceId],
  );
}

async function moneyRow(orderId) {
  const [row] = await h.q(
    `SELECT total_amount_cents, subtotal_cents, commissionable_base_cents, commission_rate_applied,
            platform_commission_cents, technician_earning_cents, inspection_fee_cents,
            discount_amount_cents, order_status, payment_status, settlement_policy_version
       FROM orders WHERE id = $1`,
    [orderId],
  );
  return row;
}

async function main() {
  await h.connect();
  if (!(await h.isApiUp())) {
    console.error('الـAPI مش شغّال — cd apps/api && THROTTLE_LIMIT=100000 npm run start:dev');
    process.exit(2);
  }

  try {
    await h.seedCatalog({ priceCents: 20_000 });
    const tech = await h.makeTechnician('t1');
    const customer = await h.makeCustomer('c1');

    // ═══ كل سيناريو: خدمة بإعدادات مختلفة → طلب حقيقي → فحص وعاء العمولة ═══
    const scenarios = [
      { label: 'plain', title: 'أ — خدمة عادية، عمولة ٢٠٪', priceCents: 12_000, commissionPct: 20 },
      { label: 'insp', title: 'ب — خدمة برسم كشف', priceCents: 12_000, commissionPct: 20, inspectionFeeCents: 3_000 },
      { label: 'zerocm', title: 'ج — عمولة صفر (الفني ياخد الكل)', priceCents: 12_000, commissionPct: 0 },
      { label: 'minclamp', title: 'د — السعر مقصوص عند الحد الأدنى', priceCents: 5_000, commissionPct: 20, minPriceCents: 15_000 },
      { label: 'maxclamp', title: 'هـ — السعر مقصوص عند الحد الأقصى', priceCents: 50_000, commissionPct: 20, maxPriceCents: 20_000 },
      // **عرض بلاغ المالك بالظبط**: سعر الخدمة صفر والسعر كله جاي من الحد الأدنى.
      // المتوقع لو البقّة موجودة: وعاء صفر ⇒ الفني صفر ⇒ المنصة تاخد الطلب كله.
      { label: 'allmin', title: 'و — السعر كله جاي من الحد الأدنى (بلاغ المالك)', priceCents: 0, commissionPct: 20, minPriceCents: 12_000 },
    ];

    for (const spec of scenarios) {
      console.log(`\n═══ ${spec.title} ═══`);
      const serviceId = await makeService(spec.label, spec);
      await linkTechnician(serviceId, tech.id);

      const created = await h.api('/orders', {
        method: 'POST',
        token: customer.token,
        headers: { 'Idempotency-Key': `omi-${spec.label}-${h.runId}` },
        body: {
          service_id: serviceId,
          address_id: customer.addressId,
          scheduled_at: h.nextDay(),
          problem_description: `تدقيق سلامة الفلوس — ${spec.label}`,
        },
      });
      if (created.status !== 201) {
        check(spec.title, 'الطلب اتعمل', false, `HTTP ${created.status} ${JSON.stringify(created.body?.error?.message)}`);
        continue;
      }
      const orderId = (created.body.data ?? created.body).id;
      h.created.orderIds?.push?.(orderId);
      const row = await moneyRow(orderId);
      if (VERBOSE) console.log('   ', JSON.stringify(row));

      const total = Number(row.total_amount_cents);
      const base = Number(row.commissionable_base_cents);
      const rate = Number(row.commission_rate_applied);

      eq(spec.title, 'نسبة العمولة اتخزّنت زي الخدمة', rate, spec.commissionPct);
      check(spec.title, `وعاء العمولة أكبر من صفر (${egp(base)} من إجمالي ${egp(total)})`, base > 0,
        'وعاء صفر معناه الفني هياخد صفر والمنصة تاخد الطلب كله');

      // الوعاء المفروض يغطي سعر الشغل. رسم الكشف داخل بالسياسة الافتراضية.
      const expectedFloor = total - Number(row.discount_amount_cents);
      check(spec.title, 'وعاء العمولة بيغطي سعر الشغل كله', base >= expectedFloor,
        `الوعاء ${egp(base)} أقل من المفروض ${egp(expectedFloor)} — الفرق بيروح للمنصة بالكامل`);

      // التسوية الحقيقية: نخلّص الشغل ونحصّل كاش.
      await h.q(`UPDATE orders SET order_status='work_completed', technician_id=$2 WHERE id=$1`, [orderId, tech.id]);
      const settle = await h.api(`/technician/orders/${orderId}/collect-cash`, { method: 'POST', token: tech.token });
      if (settle.status !== 201) {
        check(spec.title, 'التسوية عدّت', false, `HTTP ${settle.status} ${JSON.stringify(settle.body?.error?.message)}`);
        continue;
      }
      const after = await moneyRow(orderId);
      const earning = Number(after.technician_earning_cents);
      const commission = Number(after.platform_commission_cents);

      eq(spec.title, 'الثابت: مستحق الفني + عمولة المنصة = الإجمالي', earning + commission, Number(after.total_amount_cents));

      const expectedEarning = base - Math.round((base * rate) / 100);
      eq(spec.title, `مستحق الفني = الوعاء − العمولة (${egp(expectedEarning)})`, earning, expectedEarning);

      if (rate < 100 && total > 0) {
        check(spec.title, '⚠️ الفني مااخدش صفر من طلب مدفوع', earning > 0,
          `مستحق الفني ${egp(earning)} والعمولة ${egp(commission)} من إجمالي ${egp(total)}`);
      }

      const shares = await h.q(
        `SELECT share_cents FROM order_earning_shares WHERE order_id = $1`, [orderId],
      );
      const sharesTotal = shares.reduce((s, r) => s + Number(r.share_cents), 0);
      eq(spec.title, 'مجموع حصص الطاقم = مستحق الفني', sharesTotal, earning);
    }

    // ═══ ثوابت على مستوى الدفتر كله ═══
    console.log('\n═══ و — ثوابت الدفتر ═══');
    const imbalance = await h.ledgerImbalance();
    check('ز', 'الدفتر متوازن (مدين = دائن على التشغيلة)', imbalance.net === 0,
      `صافي ${imbalance.net} على ${imbalance.rows} حركة`);
    // **مفيش فحص «رصيد سالب» هنا عمدًا**: التدقيق ده بيسوّي بالكاش، والفني بيبقى ماسك فلوس
    // العميل في إيده فمحفظته بتبقى سالبة بقيمة عمولة المنصة — ده تصميم مش خلل
    // (`money-paths-audit.js` بيقيسه صراحةً كـ«الكاش اللي في إيد القائد»). الفحص ده مكانه
    // مسارات الدفع الإلكتروني، وهو موجود هناك بالفعل.
    const errors = await h.serverErrorsSince();
    check('و', 'مفيش أي خطأ ٥xx في اللوج', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  } finally {
    await h.cleanup();
    await h.close();
  }

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`نجح: ${pass} — فشل: ${findings.length}`);
  if (findings.length) {
    console.log('\nالنتائج:');
    for (const f of findings) console.log(`  • [${f.group}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exit(1);
  }
  console.log('كل الثوابت المالية عدّت ✅');
}

main().catch((err) => { console.error(err); process.exit(1); });
