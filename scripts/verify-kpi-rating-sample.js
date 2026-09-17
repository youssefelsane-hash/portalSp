/**
 * **تحقيق حي: ليه «تقييم العملاء» بيطلع بلا عينة في تقرير الإنتاجية والبروفايل فيه ١٩ تقييم؟**
 *
 * بلاغ مالك 2026-09-17 بلقطة: بروفايل الفني بيقول «متوسط التقييم: 4.26 (19 تقييم)»، وتقرير
 * الإنتاجية في نفس الصفحة بيقول «تقييم العملاء — عينة غير كافية (0 من 1 شهر مطلوبين)».
 *
 * السكربت ده **مايصلّحش حاجة** — بيفرّق بين الأسباب المحتملة بالتجربة على بيانات حقيقية:
 *
 *   أ) التقييمات بره شهر الـsnapshot
 *   ب) التقييمات `is_published = false`
 *   ج) نوع التقييم مش `customer_to_technician`
 *   د) الـsnapshot اتحسب **قبل** ما التقييمات توصل (تقادم)
 *   هـ) اختلاف في الـID/الفلتر بين البروفايل والـKPI
 *
 * والنتيجة بتتقاس مش بتتخمّن: كل سيناريو بيتزرع لوحده، والـAPI بيتنادى فعلاً.
 *
 *   node scripts/verify-kpi-rating-sample.js   # محتاج API شغّال + Postgres
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const ok = (pass, label, extra = '') =>
  console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);

async function main() {
  const h = new LiveHarness('kpir');
  await h.connect();
  let failures = 0;
  try {
    await h.seedCatalog({ priceCents: 30_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');
    const tech = await h.makeTechnician('t');
    const admin = await h.makeEmployee(
      ['technicians.view', 'technician_kpi.view', 'technician_kpi.calculate', 'technician_productivity.view'],
      'ops',
    );

    const now = new Date();
    const thisYear = now.getUTCFullYear();
    const thisMonth = now.getUTCMonth() + 1;

    /** طلب مكتمل + تقييم عليه، بتاريخ إنشاء تقييم محدّد. */
    const seedRatedOrder = async (tag, ratingCreatedAt, { published = true, type = 'customer_to_technician', stars = 4 } = {}) => {
      const at = new Date(ratingCreatedAt);
      const [o] = await h.q(
        `INSERT INTO orders (customer_id, service_id, address_id, service_zone_id, order_number,
           order_status, booking_mode, scheduled_at, duration_minutes, technician_id,
           required_technicians, required_assistants, placed_at, work_started_at, work_completed_at,
           total_amount_cents, payment_method, payment_status, commission_rate_applied, problem_description)
         VALUES ($1,$2,$3,$4,$5,'completed','individual',$6,120,$7,1,0,$6,$6,$6,30000,'cash','paid',20.00,'x')
         RETURNING id`,
        [customer.profileId, h.catalog.service.id, customer.addressId, h.catalog.zone.id, `KPIR-${tag}`, at.toISOString(), tech.id],
      );
      await h.q(
        `INSERT INTO ratings (order_id, rated_by_user_id, rated_user_id, rating_type, overall_rating, is_published, created_at)
         VALUES ($1,$2,$3,$4::rating_type,$5,$6,$7)`,
        [o.id, customer.userId, tech.userId, type, stars, published, at.toISOString()],
      );
      return o.id;
    };

    /** يقرا رقمي البروفايل الحيّين بنفس استعلام الـprocessor بالحرف. */
    const lifetime = async () => {
      const [row] = await h.q(
        `SELECT COALESCE(AVG(r.overall_rating), 0)::numeric(4,2) AS avg, COUNT(*)::int AS n
           FROM ratings r JOIN technician_profiles tp ON tp.user_id = r.rated_user_id
          WHERE tp.id = $1 AND r.rating_type = 'customer_to_technician' AND r.is_published = true`,
        [tech.id],
      );
      return { avg: Number(row.avg), n: row.n };
    };

    const productivity = async (months = 1) => {
      const res = await h.api(`/admin/technician-productivity/${tech.id}?months=${months}`, { token: admin.token });
      const body = res.body.data ?? res.body;
      const rating = (body.breakdown ?? []).find((b) => b.key === 'customer_rating');
      return { status: res.status, body, rating };
    };

    const calcKpi = async (year, month) =>
      h.api('/admin/technician-kpi/calculate', {
        method: 'POST',
        token: admin.token,
        body: { period_year: year, period_month: month, technician_id: tech.id },
      });

    const snapshotRow = async (year, month) => {
      const [row] = await h.q(
        `SELECT average_rating, ratings_count, calculated_at FROM technician_kpi_snapshots
          WHERE technician_id = $1 AND period_year = $2 AND period_month = $3`,
        [tech.id, year, month],
      );
      return row ?? null;
    };

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━ السبب (د): الـsnapshot اتحسب قبل ما التقييمات توصل ━━━');
    // شهر فيه طلب مكتمل بلا تقييم → snapshot ratings_count = 0
    await seedRatedOrder('pre', new Date(Date.UTC(thisYear, thisMonth - 1, 2)), { published: false });
    await h.q(`DELETE FROM ratings WHERE rated_user_id = $1`, [tech.userId]); // الطلب بس، بلا تقييم
    await calcKpi(thisYear, thisMonth);
    const snapBefore = await snapshotRow(thisYear, thisMonth);
    ok(
      snapBefore !== null && Number(snapBefore.ratings_count) === 0,
      'snapshot اتحسب والشهر مافيهوش تقييمات → ratings_count = 0 (ضابط)',
      `ratings_count=${snapBefore?.ratings_count} avg=${snapBefore?.average_rating}`,
    );

    // دلوقتي التقييمات بتوصل **بعد** الحساب، جوّه نفس الشهر
    for (let i = 0; i < 3; i += 1) {
      await seedRatedOrder(`late${i}`, new Date(Date.UTC(thisYear, thisMonth - 1, 10 + i)), { stars: 5 });
    }
    const live = await lifetime();
    const snapAfter = await snapshotRow(thisYear, thisMonth);
    const prodAfter = await productivity(1);

    const reproduced =
      live.n === 3 && Number(snapAfter.ratings_count) === 0 && prodAfter.rating && prodAfter.rating.included === false;
    ok(
      reproduced,
      '**البَقّة اتكرّرت**: البروفايل فيه تقييمات حيّة والـsnapshot لسه صفر، فالإنتاجية بتستبعد المقياس',
      `البروفايل=${live.n} تقييم (متوسط ${live.avg}) · snapshot.ratings_count=${snapAfter.ratings_count} · ` +
        `الإنتاجية: included=${prodAfter.rating?.included} sample_size=${prodAfter.rating?.sample_size}\n     ` +
        `الرسالة للأدمن: «${prodAfter.rating?.exclusion_reason}»`,
    );
    if (!reproduced) failures += 1;

    // وإعادة الحساب بتحل المشكلة → يعني مش فلتر غلط، تقادم
    await calcKpi(thisYear, thisMonth);
    const snapRecalc = await snapshotRow(thisYear, thisMonth);
    const prodRecalc = await productivity(1);
    const fixedByRecalc = Number(snapRecalc.ratings_count) === 3 && prodRecalc.rating?.included === true;
    ok(
      fixedByRecalc,
      'إعادة حساب نفس الشهر بتخلي المقياس يدخل → السبب **تقادم** مش فلتر/ID غلط',
      `snapshot.ratings_count=${snapRecalc.ratings_count} avg=${snapRecalc.average_rating} · ` +
        `الإنتاجية: included=${prodRecalc.rating?.included} raw=${prodRecalc.rating?.raw_value} sample=${prodRecalc.rating?.sample_size}`,
    );
    if (!fixedByRecalc) failures += 1;

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━ السبب (ب): تقييم غير منشور ━━━');
    await seedRatedOrder('unpub', new Date(Date.UTC(thisYear, thisMonth - 1, 15)), { published: false, stars: 1 });
    const liveUnpub = await lifetime();
    await calcKpi(thisYear, thisMonth);
    const snapUnpub = await snapshotRow(thisYear, thisMonth);
    ok(
      liveUnpub.n === 3 && Number(snapUnpub.ratings_count) === 3,
      'التقييم غير المنشور **مابيدخلش** لا البروفايل ولا الـKPI — نفس الفلتر بالظبط',
      `البروفايل=${liveUnpub.n} · snapshot=${snapUnpub.ratings_count} (الاتنين استبعدوه)`,
    );
    if (!(liveUnpub.n === 3 && Number(snapUnpub.ratings_count) === 3)) failures += 1;

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━ السبب (ج): نوع تقييم تاني ━━━');
    await seedRatedOrder('t2c', new Date(Date.UTC(thisYear, thisMonth - 1, 16)), { type: 'technician_to_customer', stars: 1 });
    const liveT2c = await lifetime();
    await calcKpi(thisYear, thisMonth);
    const snapT2c = await snapshotRow(thisYear, thisMonth);
    ok(
      liveT2c.n === 3 && Number(snapT2c.ratings_count) === 3,
      'تقييم `technician_to_customer` مابيدخلش الاتنين — برضه نفس الفلتر',
      `البروفايل=${liveT2c.n} · snapshot=${snapT2c.ratings_count}`,
    );
    if (!(liveT2c.n === 3 && Number(snapT2c.ratings_count) === 3)) failures += 1;

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━ السبب (أ): تقييم قديم بره فترة الـsnapshot ━━━');
    const oldAt = new Date(Date.UTC(thisYear, thisMonth - 4, 5)); // ٣ شهور ورا
    await seedRatedOrder('old', oldAt, { stars: 5 });
    const liveOld = await lifetime();
    const prodOneMonth = await productivity(1);
    ok(
      liveOld.n === 4 && prodOneMonth.rating?.sample_size === 1,
      'تقييم بره الفترة بيزوّد رقم البروفايل بس — الإنتاجية بفترة شهر مابتشوفهوش',
      `البروفايل=${liveOld.n} · الإنتاجية(شهر واحد).sample_size=${prodOneMonth.rating?.sample_size}`,
    );
    if (!(liveOld.n === 4 && prodOneMonth.rating?.sample_size === 1)) failures += 1;

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n━━━ `sample_size` بيعدّ إيه فعلاً؟ ━━━');
    await calcKpi(oldAt.getUTCFullYear(), oldAt.getUTCMonth() + 1);
    const prodFour = await productivity(4);
    const snapOld = await snapshotRow(oldAt.getUTCFullYear(), oldAt.getUTCMonth() + 1);
    const monthsWithRatings = 2;
    const actualRatings = 3 + 1;
    ok(
      prodFour.rating?.sample_size === monthsWithRatings,
      '**`sample_size` = عدد الشهور** اللي فيها تقييم، **مش عدد تقييمات العملاء** — ده أصل اللبس',
      `شهور فيها تقييم=${monthsWithRatings} · تقييمات فعلية=${actualRatings} · ` +
        `اللي الـAPI بيرجّعه sample_size=${prodFour.rating?.sample_size}\n     ` +
        `(snapshot الشهر القديم: ratings_count=${snapOld?.ratings_count})`,
    );
    if (prodFour.rating?.sample_size !== monthsWithRatings) failures += 1;

    console.log(
      `\nℹ️  رسالة الاستبعاد الحالية وقت الصفر: «عينة غير كافية (0 من 1 شهر مطلوبين على الأقل)»\n` +
        `    وهي بتقيس الشهور مش التقييمات — فالأدمن بيقراها كإنكار لوجود تقييمات أصلاً.`,
    );
  } finally {
    await h.deleteOrders(`order_number LIKE $1`, ['KPIR-%']);
    await h.cleanup();
    await h.close();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ السبب الجذري محدَّد: الـsnapshot مجمّد + `sample_size` بيعدّ شهور مش تقييمات.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
