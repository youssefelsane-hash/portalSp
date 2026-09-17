/**
 * **تحقّق حي: كل معاملات المية متاحة فعلاً** (طلب مالك 2026-09-17).
 *
 * «عادي لو أنا عايز أزود 4% بس… يعني واحد من واحد من المية لحد 100%… بس يكون إيه كل معاملات
 * المية موجودة».
 *
 * كانت خانات المضاعف في اللوحة `step="0.05"` و`step="0.1"` — يعني الأدمن **مش قادر** يكتب 1.04
 * (زيادة ٤٪)، لازم 1.05 أو 1.10. والقاعدة `numeric(4,2)` والـAPI `@IsPositive()` بلا أي قيد
 * خطوة، يعني القيد كان **واجهة بس** ومتعارض مع السكيما والـAPI.
 *
 * السكربت بيثبت الدورة الكاملة: حفظ 1.04 و1.01 و1.99 عبر الـAPI، وقراءتها، وإنها بتوصل
 * للسعر النهائي بالظبط. ولو حد رجّع قيد الخطوة في الواجهة تاني، السكربت ده مش هيمسكه (هو
 * بيختبر الـAPI) — بس الاختبار الوحدي `admin-multiplier-precision.spec.ts` بيمسكه.
 *
 *   node scripts/verify-multiplier-precision.js   # محتاج API شغّال
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `  ${extra}` : ''}`);

async function main() {
  const h = new LiveHarness('mulp');
  await h.connect();
  let failures = 0;
  try {
    await h.seedCatalog({ priceCents: 100_000, durationMinutes: 120 });
    const admin = await h.makeEmployee(['catalog.view', 'catalog.manage', 'geo.view', 'geo.manage'], 'ops');
    const serviceId = h.catalog.service.id;

    // كل معاملات المية اللي المالك ذكرها بالاسم + الحدود
    const cases = [1.01, 1.04, 1.05, 1.1, 1.37, 1.99, 2.0, 0.96];
    for (const multiplier of cases) {
      const res = await h.api(`/admin/services/${serviceId}/pricing-tier-pricing`, {
        method: 'PUT',
        token: admin.token,
        body: { pricing_tier: 'expert', price_multiplier: multiplier },
      });
      const [row] = await h.q(
        `SELECT price_multiplier FROM service_pricing_tier_pricing
          WHERE service_id = $1 AND pricing_tier = 'expert' AND is_active = true`,
        [serviceId],
      );
      const stored = row ? Number(row.price_multiplier) : null;
      const pass = res.status < 300 && stored === multiplier;
      ok(pass, `مضاعف ${multiplier} (${Math.round((multiplier - 1) * 100)}%)`, `status=${res.status} المحفوظ=${stored}`);
      if (!pass) failures += 1;
    }

    // والمضاعف بيوصل للسعر النهائي بالظبط — مش بيتقرّب لمضاعفات ٥٪
    await h.api(`/admin/services/${serviceId}/pricing-tier-pricing`, {
      method: 'PUT',
      token: admin.token,
      body: { pricing_tier: 'expert', price_multiplier: 1.04 },
    });
    // الـendpoint ده `POST` بلا body (كل حاجة query) — والبراميتر اسمه `pricing_tier`.
    const est = await h.api(
      `/services/${serviceId}/estimate?pricing_tier=expert&zone_id=${h.catalog.zone.id}`,
      { method: 'POST', token: admin.token },
    );
    const total = est.body.data?.estimated_total_cents ?? null;
    const base = est.body.data?.base_price_cents ?? null;
    const appliedMultiplier = est.body.data?.level_price_multiplier ?? null;
    const expected = base === null ? null : Math.round(base * 1.04);
    ok(
      appliedMultiplier === 1.04 && total === expected,
      'زيادة ٤٪ بتوصل للسعر النهائي بالظبط (مش متقرّبة)',
      `base=${base} × ${appliedMultiplier} = ${total} (المتوقع ${expected})`,
    );
    if (!(appliedMultiplier === 1.04 && total === expected)) failures += 1;
  } finally {
    await h.cleanup();
    await h.close();
  }
  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ كل معاملات المية مقبولة ومحفوظة وبتوصل للسعر — القيد كان في الواجهة بس.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
