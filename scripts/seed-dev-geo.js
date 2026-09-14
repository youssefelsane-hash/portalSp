#!/usr/bin/env node
// بذور جغرافيا حقيقية لبيئة التطوير (مدن + مناطق مُطلَقة).
//
// **ليه موجود (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: `infra/migrations` بتزرع الدول بس
// — المدن والمناطق بيانات إدارية بيدخّلها الأدمن. النتيجة إن قاعدة التطوير وصلت لحالة فيها
// ١١٩٤ مدينة (كلها بقايا تدقيقات قديمة) و**صفر منطقة**، و`area_id` إجباري في `CreateAddressDto`
// — يعني **مافيش ولا عنوان يتسجّل، يعني مافيش ولا طلب يتعمل** في بيئة التطوير كلها. ١٤ اختبار
// حي كانوا بيسقطوا على ده وسبب السقوط مكانش باين من رسالة الخطأ (`Expected: non-empty`).
//
// السكربت idempotent: بيتعرّف على المدينة/المنطقة بالـslug فتشغيله مرتين مابيكرّرش حاجة.
//
// الاستخدام:  node scripts/seed-dev-geo.js
const { Client } = require('pg');
const { resolveApiDatabaseUrl } = require('./lib/resolve-api-db');

const DATABASE_URL = resolveApiDatabaseUrl();

// مدن ومناطق حقيقية — بيانات تطوير معقولة، مش أسماء عشوائية، عشان اللقطات البصرية ومراجعات
// المالك تبان زي الإنتاج.
const SEED = [
  {
    slug: 'cairo', nameAr: 'القاهرة', nameEn: 'Cairo', lng: 31.2357, lat: 30.0444,
    areas: [
      ['nasr-city', 'مدينة نصر', 'Nasr City', 31.3416, 30.0626],
      ['maadi', 'المعادي', 'Maadi', 31.2599, 29.9603],
      ['heliopolis', 'مصر الجديدة', 'Heliopolis', 31.3260, 30.0875],
      ['new-cairo', 'القاهرة الجديدة', 'New Cairo', 31.4913, 30.0300],
      ['shobra', 'شبرا', 'Shobra', 31.2444, 30.1218],
    ],
  },
  {
    slug: 'giza', nameAr: 'الجيزة', nameEn: 'Giza', lng: 31.2089, lat: 30.0131,
    areas: [
      ['dokki', 'الدقي', 'Dokki', 31.2118, 30.0382],
      ['mohandessin', 'المهندسين', 'Mohandessin', 31.2003, 30.0588],
      ['6-october', 'مدينة 6 أكتوبر', '6th of October', 30.9419, 29.9660],
      ['haram', 'الهرم', 'Haram', 31.1656, 29.9911],
    ],
  },
  {
    slug: 'alexandria', nameAr: 'الإسكندرية', nameEn: 'Alexandria', lng: 29.9187, lat: 31.2001,
    areas: [
      ['smouha', 'سموحة', 'Smouha', 29.9459, 31.2156],
      ['sidi-gaber', 'سيدي جابر', 'Sidi Gaber', 29.9403, 31.2196],
      ['miami', 'ميامي', 'Miami', 30.0093, 31.2717],
    ],
  },
];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const { rows: countries } = await client.query(
      `SELECT id FROM countries WHERE iso_code = 'EG' AND deleted_at IS NULL LIMIT 1`,
    );
    if (countries.length === 0) throw new Error('مفيش دولة EG في countries — شغّل الـmigrations الأول');
    const countryId = countries[0].id;

    let newCities = 0;
    let newAreas = 0;
    let newZones = 0;

    for (const city of SEED) {
      const { rows } = await client.query(
        `INSERT INTO cities (country_id, name_ar, name_en, slug, center_location, is_active, launched_at)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, true, now())
         ON CONFLICT (slug) DO UPDATE SET is_active = true, launched_at = COALESCE(cities.launched_at, now())
         RETURNING id, (xmax = 0) AS inserted`,
        [countryId, city.nameAr, city.nameEn, city.slug, city.lng, city.lat],
      );
      const cityId = rows[0].id;
      if (rows[0].inserted) newCities += 1;

      // نطاق خدمة واحد نشط بلا `boundary` لكل مدينة. من غيره `findZoneForPoint()` بترجع null
      // وإنشاء الطلب بيتقفل بـ«الخدمة غير متاحة في منطقتك لسه» حتى بعد ما العنوان يتسجّل —
      // يعني الحجز بيفضل ميت رغم إن المدن والمناطق موجودة. بلا مضلّع = fallback بيغطي المدينة
      // كلها، وده السلوك الموثّق في geo/README.md لمدينة لسه مترسمتش.
      const { rows: zoneRows } = await client.query(
        `SELECT id FROM service_zones WHERE city_id = $1 AND deleted_at IS NULL LIMIT 1`,
        [cityId],
      );
      if (zoneRows.length === 0) {
        await client.query(
          `INSERT INTO service_zones (city_id, name_ar, name_en, is_active)
           VALUES ($1, $2, $3, true)`,
          [cityId, `نطاق ${city.nameAr}`, `${city.nameEn} Zone`],
        );
        newZones += 1;
      }

      for (const [slug, nameAr, nameEn, lng, lat] of city.areas) {
        const res = await client.query(
          `INSERT INTO areas (city_id, name_ar, name_en, slug, center_location, is_active, is_launched)
           VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, true, true)
           ON CONFLICT (city_id, slug) DO UPDATE SET is_active = true, is_launched = true
           RETURNING (xmax = 0) AS inserted`,
          [cityId, nameAr, nameEn, slug, lng, lat],
        );
        if (res.rows[0].inserted) newAreas += 1;
      }
    }

    const { rows: totals } = await client.query(
      `SELECT (SELECT count(*) FROM cities c WHERE c.is_active AND c.deleted_at IS NULL
                 AND EXISTS (SELECT 1 FROM areas a WHERE a.city_id = c.id AND a.is_launched AND a.is_active AND a.deleted_at IS NULL)
              )::int AS bookable_cities,
              (SELECT count(*) FROM areas WHERE is_launched AND is_active AND deleted_at IS NULL)::int AS launched_areas`,
    );

    console.log(`✅ مدن جديدة: ${newCities} | مناطق جديدة: ${newAreas} | نطاقات خدمة جديدة: ${newZones}`);
    console.log(`   مدن قابلة للحجز دلوقتي: ${totals[0].bookable_cities} | مناطق مُطلَقة: ${totals[0].launched_areas}`);
    if (totals[0].bookable_cities === 0) {
      console.error('❌ مفيش ولا مدينة قابلة للحجز — العميل مش هيقدر يسجّل عنوان');
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
