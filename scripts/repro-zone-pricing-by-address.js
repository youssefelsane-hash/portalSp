'use strict';
/**
 * **بلاغ المالك ١٠ (§141)**: «لو غيّرت العنوان لعنوان تاني سعره أعلى شوية، السعر بيفضل زي ما
 * هو ما بيتغيّرش. عايز الموضوع ده يبقى ماشي باحترافية وهندلة مظبوطة.»
 *
 * الفرضية اللي السكربت بيختبرها: `GeoService.findZoneForPoint()` بيرجع لـ`findZoneForCity()`
 * (**أقدم نطاق نشط في المدينة**) لما مفيش أي نطاق في المدينة عنده `boundary` مرسوم — وده
 * الوضع الافتراضي لأن النطاق بيتنشئ بلا مضلّع. يعني كل العناوين في المدينة بترسّى على نفس
 * النطاق، وبالتالي **نفس السعر**، مهما كان العنوان.
 *
 * السكربت بيقيس الحالتين على نفس الخدمة بالظبط:
 *   أ) مدينة بنطاقين **بلا حدود مرسومة** + سعرين مختلفين.
 *   ب) نفس الشيء بس **بحدود مرسومة** — لازم السعر يتغيّر مع العنوان.
 */
const { LiveHarness } = require('./lib/live-harness');

async function main() {
  const h = new LiveHarness('zoneprice');
  await h.connect();
  let failures = 0;
  const check = (name, ok, detail) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  try {
    const catalog = await h.seedCatalog({ priceCents: 50_000, durationMinutes: 120 });
    const customer = await h.makeCustomer('c');

    // نطاق تاني في **نفس المدينة**، وسعره أعلى للخدمة دي
    const [zoneB] = await h.q(
      `INSERT INTO service_zones (city_id, name_ar, name_en, is_active)
       VALUES ($1,'نطاق غالي','Expensive Zone',true) RETURNING id`,
      [catalog.city.id],
    );
    h.created.zoneIds.push(zoneB.id);

    // التسعير بالمنطقة **نسبة مئوية** مش سعر مطلق (الاستبدال المطلق مرفوض صراحةً من الباك-إند).
    await h.q(
      `INSERT INTO service_zone_pricing (service_id, service_zone_id, pricing_mode, modifier_percentage, is_active)
       VALUES ($1,$2,'percentage',0,true), ($1,$3,'percentage',80,true)`,
      [catalog.service.id, catalog.zone.id, zoneB.id],
    );

    // عنوانين بعيدين عن بعض في نفس المدينة
    const mkAddress = async (label, lng, lat) => {
      const [a] = await h.q(
        `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
         VALUES ($1,$2,$3,'1',ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,false) RETURNING id`,
        [customer.userId, catalog.city.id, `شارع ${label}`, lng, lat],
      );
      return a.id;
    };
    const addrA = await mkAddress('أ', 31.20, 30.00);
    const addrB = await mkAddress('ب', 31.50, 30.40);

    const priceFor = async (addressId) => {
      const res = await h.api('/orders/preview', {
        method: 'POST',
        token: customer.token,
        body: { service_id: catalog.service.id, address_id: addressId, booking_mode: 'individual' },
      });
      return { status: res.status, total: res.body?.data?.total_amount_cents, error: res.body?.error?.message };
    };

    // ── أ) بلا حدود مرسومة — الوضع الافتراضي ────────────────────────────────
    const noBoundaryA = await priceFor(addrA);
    const noBoundaryB = await priceFor(addrB);
    console.log(
      `ℹ️  بلا حدود مرسومة: عنوان أ = ${noBoundaryA.total} | عنوان ب = ${noBoundaryB.total}`,
    );
    check(
      'المعاينة بترجع سعر للعنوانين',
      noBoundaryA.status < 400 && noBoundaryB.status < 400,
      `${noBoundaryA.status}/${noBoundaryB.status} — ${noBoundaryA.error ?? noBoundaryB.error}`,
    );
    // ده **البلاغ نفسه**: نفس السعر رغم اختلاف العنوان والنطاق المفروض.
    const sameWithoutBoundary = noBoundaryA.total === noBoundaryB.total;
    console.log(
      sameWithoutBoundary
        ? '⚠️  نفس السعر للعنوانين — ده بلاغ المالك: تسعير المناطق **مش شغّال** بلا حدود مرسومة'
        : 'ℹ️  السعر اختلف حتى بلا حدود (مش متوقع)',
    );

    // ── أ-٢) والتشخيص الإداري لازم يقول الحقيقة دي صراحةً ────────────────────
    const admin = await h.makeAdmin();
    const diagBefore = await h.api(
      `/admin/service-zones/coverage-diagnostics?city_id=${catalog.city.id}`,
      { token: admin.token },
    );
    const rowBefore = (diagBefore.body?.data ?? [])[0];
    check(
      'التشخيص الإداري بيقول إن تسعير المناطق في المدينة دي **بلا أثر**',
      rowBefore?.zone_pricing_inert === true,
      JSON.stringify(rowBefore ?? diagBefore.body),
    );
    check(
      'وبيقول كام نطاق نشط وكام منهم مرسوم',
      Number(rowBefore?.active_zone_count) === 2 && Number(rowBefore?.zones_with_boundary_count) === 0,
      JSON.stringify(rowBefore),
    );

    // ── ب) بعد رسم الحدود — لازم يشتغل ──────────────────────────────────────
    // مربّعان منفصلان تمامًا، كل واحد شامل عنوانه.
    await h.q(
      `UPDATE service_zones SET boundary = ST_SetSRID(ST_MakeEnvelope(31.10, 29.90, 31.30, 30.10), 4326)::geography
        WHERE id = $1`,
      [catalog.zone.id],
    );
    await h.q(
      `UPDATE service_zones SET boundary = ST_SetSRID(ST_MakeEnvelope(31.40, 30.30, 31.60, 30.50), 4326)::geography
        WHERE id = $1`,
      [zoneB.id],
    );

    const withBoundaryA = await priceFor(addrA);
    const withBoundaryB = await priceFor(addrB);
    console.log(
      `ℹ️  بعد رسم الحدود: عنوان أ = ${withBoundaryA.total} | عنوان ب = ${withBoundaryB.total}`,
    );
    check(
      'بعد رسم الحدود: العنوان الغالي بيدّي سعر أعلى فعلاً',
      withBoundaryA.total !== withBoundaryB.total,
      `الاتنين ${withBoundaryA.total} — تسعير المناطق لسه مش شغّال`,
    );
    check(
      'والسعر الأعلى هو بتاع النطاق الغالي',
      Number(withBoundaryB.total) > Number(withBoundaryA.total),
      `${withBoundaryB.total} مش أكبر من ${withBoundaryA.total}`,
    );

    const diagAfter = await h.api(
      `/admin/service-zones/coverage-diagnostics?city_id=${catalog.city.id}`,
      { token: admin.token },
    );
    const rowAfter = (diagAfter.body?.data ?? [])[0];
    check(
      'وبعد الرسم التشخيص بيرجع سليم (التحذير بيختفي)',
      rowAfter?.zone_pricing_inert === false && Number(rowAfter?.zones_with_boundary_count) === 2,
      JSON.stringify(rowAfter),
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
