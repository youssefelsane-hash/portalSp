/**
 * **تحقّق حي: الويب والموبايل بيوصلوا لنفس فضاء الأهلية ونفس الوضع المشتقّ** (ADR-0106).
 *
 * بلاغ مالك 2026-09-17: «بعد التعديل أريد Web وMobile، عند إعطائهما نفس service/address/job
 * details/date/time، أن يصلا إلى نفس server-derived booking mode ونفس eligibility universe.
 * الاختلاف المقبول فقط هو تغير availability الحقيقي بين اللحظتين، وليس اختلاف business rule
 * بين الواجهتين».
 *
 * ### الانحراف اللي السكربت ده بيقيسه
 *
 * `GET /services/:id/technicians` كان بيثق في `booking_mode` في قرارين، وأخطرهم
 * `=== 'team'` اللي بيغيّر **فضاء الأهلية** (`isTeamBooking` بيفلتر على
 * `eligible_for_team_booking`: `professional` فأعلى بس).
 *
 * و`apps/customer-web` بيشتقّ محليًا `emergency` أو `individual` **وبس** — مستحيل يطلّع `team`.
 * بينما `apps/customer-app` بيبعت `team` لخدمة `allows_team && !allows_individual`.
 * فخدمة فريق-بحت كانت بترجّع للواجهتين **قايمتين منفّذين مختلفتين**.
 *
 * الاختبار بيحاكي **الاتنين حرفيًا**: نفس الخدمة، نفس العنوان، نفس التاريخ — والفرق الوحيد
 * `booking_mode` اللي كل واجهة بتبعته. المفروض النتيجة تبقى واحدة بعد الإصلاح.
 *
 *   node scripts/verify-web-mobile-booking-parity.js   # محتاج API شغّال
 */
'use strict';

const { LiveHarness } = require('./lib/live-harness');

const ok = (pass, label, extra = '') => console.log(`${pass ? '✅' : '❌'} ${label}${extra ? `\n     ${extra}` : ''}`);

async function main() {
  const h = new LiveHarness('wmp');
  await h.connect();
  let failures = 0;
  try {
    await h.seedCatalog({ priceCents: 50_000, durationMinutes: 240 });
    const serviceId = h.catalog.service.id;
    // **خدمة فريق-بحت**: دي الحالة اللي الانحراف بيبان فيها — الويب بيبعت `individual`
    // (مستحيل يطلّع `team`) والموبايل بيبعت `team`.
    await h.q(
      `UPDATE services SET allows_individual = false, allows_team = true, allows_emergency = true WHERE id = $1`,
      [serviceId],
    );

    const customer = await h.makeCustomer('c');

    // فني مستواه مؤهّل لحجز الفريق، وفني مستواه **غير** مؤهّل — عشان الفلتر يبان أثره.
    const eligible = await h.makeTechnician('elig', { level: 'professional' });
    const notEligible = await h.makeTechnician('nelig', { level: 'new' });
    const [cfg] = await h.q(
      `SELECT level, eligible_for_team_booking FROM technician_level_config WHERE level = 'new'`,
    );
    ok(
      cfg && cfg.eligible_for_team_booking === false,
      'الإعداد الحاكم: مستوى `new` **مش** مؤهّل لحجز الفريق (ضابط الاختبار)',
      `technician_level_config.new.eligible_for_team_booking=${cfg?.eligible_for_team_booking}`,
    );

    const tomorrow = new Date(Date.now() + 86_400_000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const scheduledAt = tomorrow.toISOString();

    /** نفس النداء بالظبط اللي كل واجهة بتعمله — الفرق `booking_mode` بس. */
    const listFor = async (bookingMode) => {
      const qs = new URLSearchParams({ address_id: customer.addressId, scheduled_at: scheduledAt });
      if (bookingMode) qs.set('booking_mode', bookingMode);
      const res = await h.api(`/services/${serviceId}/technicians?${qs.toString()}`, { token: customer.token });
      const ids = (res.body.data ?? []).map((t) => t.id).sort();
      return { status: res.status, ids };
    };

    const web = await listFor('individual'); // اللي `apps/customer-web` كان بيبعته
    const mobile = await listFor('team'); // اللي `apps/customer-app` بيبعته
    const factsOnly = await listFor(null); // بلا أي وضع — حقائق بس

    const same = JSON.stringify(web.ids) === JSON.stringify(mobile.ids);
    ok(
      same,
      '**الويب والموبايل بيرجّعوا نفس فضاء الأهلية بالظبط** لنفس الخدمة/العنوان/التاريخ',
      `ويب(individual)=${JSON.stringify(web.ids)}\n     موبايل(team)=${JSON.stringify(mobile.ids)}`,
    );
    if (!same) failures += 1;

    const sameAsFacts = JSON.stringify(web.ids) === JSON.stringify(factsOnly.ids);
    ok(
      sameAsFacts,
      'وبلا `booking_mode` خالص (حقائق بس) نفس النتيجة — الوضع مشتقّ من السيرفر',
      `حقائق بس=${JSON.stringify(factsOnly.ids)}`,
    );
    if (!sameAsFacts) failures += 1;

    // والفلتر **شغّال فعلاً** — مش إننا لغيناه: الفني غير المؤهّل مستبعد من الاتنين.
    const excludedFromBoth = !web.ids.includes(notEligible.id) && !mobile.ids.includes(notEligible.id);
    ok(
      excludedFromBoth,
      'فلتر حجز الفريق لسه شغّال: الفني غير المؤهّل مستبعد من **الاتنين** (مش إننا فتحنا الفضاء)',
      `غير المؤهّل=${notEligible.id} · موجود في الويب=${web.ids.includes(notEligible.id)} · في الموبايل=${mobile.ids.includes(notEligible.id)}`,
    );
    if (!excludedFromBoth) failures += 1;

    // ═══ ضابط النفي: خدمة فردية بتفتح الفضاء للاتنين ═══
    await h.q(`UPDATE services SET allows_individual = true, allows_team = false WHERE id = $1`, [serviceId]);
    const webIndividual = await listFor('individual');
    const mobileIndividual = await listFor('team'); // موبايل قديم بيبعت team غلط
    const bothOpen =
      webIndividual.ids.includes(notEligible.id) &&
      JSON.stringify(webIndividual.ids) === JSON.stringify(mobileIndividual.ids);
    ok(
      bothOpen,
      'ضابط النفي: خدمة فردية → الفضاء مفتوح للاتنين، و`booking_mode=team` من عميل قديم مابيضيّقهوش',
      `ويب=${JSON.stringify(webIndividual.ids)}\n     موبايل(بعت team غلط)=${JSON.stringify(mobileIndividual.ids)}`,
    );
    if (!bothOpen) failures += 1;

    // ═══ نفس الوضع المشتقّ على الطلب الفعلي ═══
    // الويب مابقاش بيبعت `booking_mode` خالص، والتطبيق بيبعته. المفروض الطلبين يتسجّلوا بنفس
    // الوضع بالظبط لأن `OrderCreationService` بيتجاهل الحقل ويشتقّ بنفسه (ADR-0048/§0106).
    await h.q(`UPDATE services SET allows_individual = false, allows_team = true WHERE id = $1`, [serviceId]);
    const createFor = async (label, extraBody) => {
      const res = await h.api('/orders', {
        method: 'POST',
        token: customer.token,
        body: {
          service_id: serviceId,
          address_id: customer.addressId,
          scheduled_at: scheduledAt,
          problem_description: `بارتي ${label}`,
          ...extraBody,
        },
      });
      const orderId = res.body.data?.id ?? null;
      if (!orderId) return { status: res.status, mode: null, error: res.body.error?.message };
      const [row] = await h.q(`SELECT booking_mode FROM orders WHERE id = $1`, [orderId]);
      return { status: res.status, mode: row?.booking_mode ?? null };
    };
    const webOrder = await createFor('web', {}); // بلا `booking_mode` — زي الويب بعد الإصلاح
    const mobileOrder = await createFor('mobile', { booking_mode: 'team' }); // زي التطبيق
    const legacyOrder = await createFor('legacy', { booking_mode: 'individual' }); // زي الويب القديم
    const allSame =
      webOrder.mode !== null && webOrder.mode === mobileOrder.mode && webOrder.mode === legacyOrder.mode;
    ok(
      allSame,
      '**الطلب بيتسجّل بنفس الوضع المشتقّ** مهما بعت العميل إيه في `booking_mode`',
      `ويب(بلا وضع)=${webOrder.mode} · موبايل(team)=${mobileOrder.mode} · ويب قديم(individual)=${legacyOrder.mode}` +
        `\n     (الحالات: ${webOrder.status}/${mobileOrder.status}/${legacyOrder.status})`,
    );
    if (!allSame) failures += 1;

    // ═══ الاستعجال بيتشتقّ من التاريخ، مش من الوضع ═══
    await h.q(`UPDATE services SET allows_individual = true, allows_team = true WHERE id = $1`, [serviceId]);
    const today = new Date();
    today.setUTCHours(23, 30, 0, 0);
    const qsToday = new URLSearchParams({ address_id: customer.addressId, scheduled_at: today.toISOString() });
    const urgentByDate = await h.api(`/services/${serviceId}/technicians?${qsToday.toString()}`, {
      token: customer.token,
    });
    // في الطوارئ الشركات مستبعدة (ADR-0080) — فمفيش كيان شركة في الرد.
    const noCompanies = (urgentByDate.body.data ?? []).every((t) => t.entity_type !== 'company');
    ok(
      urgentByDate.status === 200 && noCompanies,
      'طلب نفس اليوم بلا `booking_mode`: السيرفر شافه استعجال لوحده (الشركات مستبعدة)',
      `status=${urgentByDate.status} · فيه كيان شركة=${!noCompanies}`,
    );
    if (!(urgentByDate.status === 200 && noCompanies)) failures += 1;
  } finally {
    await h.deleteOrders(`problem_description LIKE $1`, ['بارتي %']);
    await h.cleanup();
    await h.close();
  }

  if (failures > 0) {
    console.log(`\n❌ ${failures} تحقّق فشل.`);
    process.exit(1);
  }
  console.log('\n✅ الوضع مشتقّ من السيرفر، وفضاء الأهلية واحد للواجهتين.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
