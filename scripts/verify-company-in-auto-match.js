'use strict';
/**
 * **بلاغ المالك ٣ — الشق التاني (§141)**: «عايز الشركات تطلع في الـauto matching، عايز الشركة
 * تطلع زيها زي الفنيين بالضبط في الـauto matching اللي هو اختارلك شركة كذا.»
 *
 * القاعدة المنفّذة في جملة: الشركة بتكسب الترشيح التلقائي **لو وبس لو** هي على رأس نفس القايمة
 * اللي العميل كان هيشوفها في الاختيار اليدوي — نفس الترتيب البايزي اللي بيرتّب الأفراد
 * والشركات مع بعض أصلاً.
 *
 * السكربت بيقيس الاتجاهين، عشان يثبت إن القاعدة **فارقة** مش دايمًا بتختار شركة:
 *   أ) شركة بتقييم عالي ⇒ التلقائي لازم يرسي عليها.
 *   ب) فرد بتقييم أعلى منها ⇒ التلقائي لازم يرسي على الفرد.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('autoco');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');

    const rate = async (techId, rating, count) =>
      h.q(`UPDATE technician_profiles SET average_rating = $2, total_ratings_count = $3 WHERE id = $1`, [
        techId,
        rating,
        count,
      ]);

    // فرد مستقل بتقييم متوسط
    const solo = await h.makeTechnician('solo');
    await rate(solo.id, 4.2, 40);

    // شركة بعضو واحد بتقييم عالي
    const owner = await h.makeTechnician('owner');
    const [company] = await h.q(
      `INSERT INTO technician_companies (owner_user_id, name, is_active) VALUES ($1,$2,true) RETURNING id`,
      [owner.userId, `شركة تلقائي ${h.runNum}`],
    );
    // `company_exclusive = true` هو **التهيئة الحقيقية لشركة عايزة تتحجز كشركة**: عضوها
    // مابيظهرش كفرد منفصل (`technicianIndividualVisibilityCondition`)، فالشركة هي العرض
    // الوحيد منه. من غيرها العضو بيتنافس مرتين — كنفسه وكشركته — وبنفس التقييم بالظبط،
    // فالتعادل بيخلّي الشركة عمرها ما تسبق. ده سلوك مقصود في القايمة اليدوية (عرضين مختلفين
    // فعلاً: تستأجر الشخص، أو تستأجر الشركة) ومذكور هنا عشان يبقى واضح.
    await h.q(`UPDATE technician_profiles SET company_id = $2, company_exclusive = true WHERE id = $1`, [
      owner.id,
      company.id,
    ]);
    await rate(owner.id, 4.9, 120);

    const [{ at }] = await h.q(
      `SELECT ((now() AT TIME ZONE 'Africa/Cairo')::date + interval '2 day' + interval '10 hour')
              AT TIME ZONE 'Africa/Cairo' AS at`,
    );
    const previewBody = {
      service_id: catalog.service.id,
      address_id: customer.addressId,
      scheduled_at: new Date(at).toISOString(),
      selection_mode: 'auto',
    };

    const autoPick = async () => {
      const res = await h.api('/orders/match-preview', { method: 'POST', token: customer.token, body: previewBody });
      return {
        status: res.status,
        kind: res.body?.data?.provider_kind,
        id: res.body?.data?.provider?.id,
        name: res.body?.data?.provider?.full_name,
        error: res.body?.error?.message,
      };
    };

    // ── أ) الشركة أعلى تقييمًا ⇒ التلقائي يرسي عليها ────────────────────────
    const a = await autoPick();
    check('المعاينة التلقائية بترجع منفّذ', a.status < 400, `${a.status} — ${a.error}`);
    console.log(`ℹ️  الشركة 4.9/120 مقابل فرد 4.2/40 ⇒ التلقائي اختار: ${a.kind} «${a.name}»`);
    check(
      '**الشركة طلعت في الـauto matching واختيرت** (ده بلاغ المالك بالحرف)',
      a.kind === 'company' && a.id === company.id,
      JSON.stringify(a),
    );

    // ── ب) فرد أعلى من الشركة ⇒ التلقائي يرسي على الفرد ─────────────────────
    const star = await h.makeTechnician('star');
    await rate(star.id, 5.0, 300);
    const b = await autoPick();
    console.log(`ℹ️  بعد إضافة فرد 5.0/300 ⇒ التلقائي اختار: ${b.kind} «${b.name}»`);
    check(
      'ولما الفرد يبقى أحسن، التلقائي بيرسي عليه — القاعدة فارقة مش دايمًا شركة',
      b.kind !== 'company',
      JSON.stringify(b),
    );

    console.log('');
    console.log(failures === 0 ? '✅ كل الفحوص عدّت' : `❌ ${failures} فحص فشل`);
  } finally {
    await h.cleanup();
    await h.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
