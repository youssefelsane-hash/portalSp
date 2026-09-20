/**
 * **ليه الفني ده مش ظاهر للعميل في النطاق ده؟** (docs/08 §168، بلاغ مالك 2026-09-19).
 *
 * > «عملت منطقة ونطاق جديد ليها، وخليت فني معتمد في المنطقة دي… دخلت عند الكاستمر عشان أطلب
 * >  لقيت الفني مش ظاهر.»
 *
 * السلسلة من «الأدمن اعتمد الفني في النطاق» لحد «العميل بيشوفه» فيها **سبع حلقات**، وأي واحدة
 * تقطع بتدّي نفس النتيجة على الشاشة: قايمة فاضية. السكريبت ده بيمشي على الحلقات السبعة بالترتيب
 * وبيقول **أول واحدة مقطوعة بالاسم** — بدل تخمين.
 *
 *   node scripts/diagnose-zone-coverage.js                 # بيفحص كل النطاقات ويلخّص
 *   node scripts/diagnose-zone-coverage.js --zone <uuid>   # نطاق بعينه بالتفصيل
 *   node scripts/diagnose-zone-coverage.js --city <uuid>
 *
 * بيقرا القاعدة بس — **مفيش أي كتابة**، فآمن تشغيله على أي بيئة.
 */
'use strict';

const { Client } = require('/home/user/portalSp/node_modules/pg');

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const ONLY_ZONE = argValue('--zone');
const ONLY_CITY = argValue('--city');

// نفس إصلاح `audit-money-paths.js` (تدقيق 2026-09-20): الافتراضي المكتوب بالإيد كان بيشاور على
// قاعدة `baytak` القديمة اللي لسه موجودة على سيرفر التطوير — فالتشخيص كان بيطلع من بيانات تانية
// خالص من غير ما حد يلاحظ. المصدر بقى نفس اللي كل الأدوات بتقراه.
const DB = process.env.DATABASE_URL ?? readDatabaseUrlFromEnvFile();

function readDatabaseUrlFromEnvFile() {
  const envPath = require('node:path').resolve(__dirname, '../apps/api/.env');
  const fs = require('node:fs');
  const found = fs.existsSync(envPath)
    ? /^DATABASE_URL=(.*)$/m.exec(fs.readFileSync(envPath, 'utf8'))?.[1]?.trim()
    : undefined;
  if (!found) {
    console.error('مفيش DATABASE_URL — لا في البيئة ولا في apps/api/.env.');
    process.exit(2);
  }
  return found;
}

/**
 * سلسلة الفني الواحد — «هو معتمد في النطاق، أمال ليه مش ظاهر؟».
 *
 * الحلقات هنا هي **نفس شروط `listForServiceBooking()` المرحلة ١** بالحرف (البوابة الصارمة اللي
 * أي فني مايعدّيهاش مابيظهرش خالص للعميل): معتمد · له صف نطاق نشط · له صف خدمة نشط · فئة الخدمة
 * مصرّح بيها · مش محجوب عن الخدمة · عنده موقع GPS.
 *
 * بتطبع لكل فني في النطاق أول حلقة مقطوعة — عشان الأدمن يعرف يصلّح إيه بالظبط بدل «مش ظاهر».
 */
async function printTechnicianChain(q, zone) {
  const techs = await q(
    `SELECT tp.id, u.full_name, tp.verification_status, tp.technician_kind,
            (tp.current_location IS NOT NULL) AS has_location,
            tz.is_active AS zone_row_active,
            -- نفس شرط approvedSpecialtyCondition() بالحرف: خدمة مباشرة **أو** فئة، وكل صف لازم
            -- يكون is_active **و** verification_status='approved' هو نفسه. الصف المضاف ولسه
            -- مستني اعتماد بيعدّي من شاشة الأدمن ومابيأهّلش — سبب شائع جدًا لـ«الفني مش ظاهر».
            (SELECT COUNT(*)::int FROM technician_services ts
              WHERE ts.technician_id = tp.id AND ts.is_active = true
                AND ts.verification_status = 'approved') AS approved_services,
            (SELECT COUNT(*)::int FROM technician_services ts
              WHERE ts.technician_id = tp.id AND ts.is_active = true
                AND ts.verification_status <> 'approved') AS pending_services,
            (SELECT COUNT(*)::int FROM technician_categories tc
              WHERE tc.technician_id = tp.id AND tc.is_active = true
                AND tc.verification_status = 'approved') AS approved_categories,
            (SELECT COUNT(*)::int FROM technician_categories tc
              WHERE tc.technician_id = tp.id AND tc.is_active = true
                AND tc.verification_status <> 'approved') AS pending_categories,
            (SELECT COUNT(*)::int FROM technician_excluded_services tes
              WHERE tes.technician_id = tp.id) AS excluded_services
       FROM technician_zones tz
       JOIN technician_profiles tp ON tp.id = tz.technician_id AND tp.deleted_at IS NULL
       JOIN users u ON u.id = tp.user_id
      WHERE tz.service_zone_id = $1 AND tz.deleted_at IS NULL
      ORDER BY u.full_name`,
    [zone.id],
  );

  if (techs.length === 0) {
    console.log('     ℹ️  مفيش ولا فني مربوط بالنطاق ده أصلاً (`technician_zones`).');
    return;
  }

  for (const t of techs) {
    const breaks = [];
    if (!t.zone_row_active) breaks.push('صف النطاق بتاعه متوقّف (`technician_zones.is_active = false`)');
    if (t.verification_status !== 'approved') breaks.push(`اعتماده «${t.verification_status}» مش approved`);
    // التأهيل = خدمة مباشرة **أو** فئة (OR مش AND) — نفس `approvedSpecialtyCondition()`.
    if (Number(t.approved_services) === 0 && Number(t.approved_categories) === 0) {
      const pending = Number(t.pending_services) + Number(t.pending_categories);
      breaks.push(
        pending > 0
          ? `مفيش ولا خدمة/فئة **معتمدة** عليه — فيه ${pending} صف نشط بس لسه مستني اعتماد (\`verification_status\`). الإضافة لوحدها مش كفاية، لازم تتعتمد.`
          : 'مفيش ولا خدمة (`technician_services`) ولا فئة (`technician_categories`) معتمدة عليه — النطاق لوحده مايأهّلوش لأي خدمة.',
      );
    }
    if (!t.has_location) breaks.push('مفيش موقع GPS محفوظ (`current_location`) — المطابقة بتستبعده');
    const mark = breaks.length === 0 ? '✅' : '❌';
    console.log(`     ${mark} ${t.full_name} (${t.technician_kind})`);
    for (const b of breaks) console.log(`          ↳ ${b}`);
    if (breaks.length === 0 && Number(t.excluded_services) > 0) {
      console.log(`          ↳ ℹ️  محجوب عن ${t.excluded_services} خدمة بالاسم — هيظهر في الباقي بس.`);
    }
  }
}

async function main() {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;

  try {
    const zones = await q(
      `SELECT sz.id, sz.name_ar, sz.is_active, sz.deleted_at IS NOT NULL AS deleted,
              (sz.boundary IS NOT NULL) AS has_boundary,
              sz.city_id, c.name_ar AS city_name, c.is_active AS city_active,
              sz.created_at
         FROM service_zones sz
         JOIN cities c ON c.id = sz.city_id
        WHERE ($1::uuid IS NULL OR sz.id = $1)
          AND ($2::uuid IS NULL OR sz.city_id = $2)
        ORDER BY c.name_ar, sz.created_at ASC`,
      [ONLY_ZONE, ONLY_CITY],
    );

    if (zones.length === 0) {
      console.log('مفيش نطاقات مطابقة.');
      return;
    }

    /*
      **أهم حلقة، وأخفاها**: `GeoService.findZoneForPoint()` بترجع لـ«أقدم نطاق نشط في المدينة»
      لما المدينة **معندهاش ولا نطاق برسم حدود**. يعني في مدينة كده، كل عناوين العملاء بترسّى
      على **نطاق واحد** — الأقدم — مهما كان عدد النطاقات. فني معتمد في نطاق تاني في نفس المدينة
      مستحيل يظهر لأي عميل، والأدمن مايشوفش أي إشارة إن اعتماده بلا أثر.
    */
    const cityFallback = new Map();
    for (const z of zones) {
      if (cityFallback.has(z.city_id)) continue;
      const [row] = await q(
        `SELECT
           (SELECT COUNT(*)::int FROM service_zones
             WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL AND boundary IS NOT NULL) AS with_boundary,
           (SELECT COUNT(*)::int FROM service_zones
             WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL) AS active_zones,
           (SELECT id FROM service_zones
             WHERE city_id = $1 AND is_active = true AND deleted_at IS NULL
             ORDER BY created_at ASC LIMIT 1) AS oldest_active_zone_id`,
        [z.city_id],
      );
      cityFallback.set(z.city_id, row);
    }

    const problems = [];
    console.log('\n— سلسلة تغطية النطاقات —\n');

    for (const z of zones) {
      const city = cityFallback.get(z.city_id);
      const geographicMatching = Number(city.with_boundary) > 0;
      // النطاق ده بيوصله عملاء فعلاً؟
      const reachable = geographicMatching
        ? z.has_boundary && z.is_active && !z.deleted
        : z.id === city.oldest_active_zone_id && z.is_active && !z.deleted;

      const [counts] = await q(
        `SELECT
           (SELECT COUNT(*)::int FROM technician_zones tz
             JOIN technician_profiles tp ON tp.id = tz.technician_id AND tp.deleted_at IS NULL
            WHERE tz.service_zone_id = $1 AND tz.is_active = true AND tz.deleted_at IS NULL) AS techs_assigned,
           (SELECT COUNT(*)::int FROM technician_zones tz
             JOIN technician_profiles tp ON tp.id = tz.technician_id AND tp.deleted_at IS NULL
            WHERE tz.service_zone_id = $1 AND tz.is_active = true AND tz.deleted_at IS NULL
              AND tp.verification_status = 'approved') AS techs_approved,
           (SELECT COUNT(*)::int FROM addresses a
            WHERE a.city_id = $2 AND a.deleted_at IS NULL) AS addresses_in_city`,
        [z.id, z.city_id],
      );

      const line = [
        `${z.city_name} › ${z.name_ar}`,
        `فنيين معتمدين: ${counts.techs_approved}/${counts.techs_assigned}`,
        `عناوين في المدينة: ${counts.addresses_in_city}`,
      ].join('  ·  ');

      if (reachable) {
        console.log(`✅ ${line}`);
        if (ONLY_ZONE || ONLY_CITY) await printTechnicianChain(q, z);
        continue;
      }

      // ليه مش قابل للوصول — بالاسم، مش «غير متاح».
      let why;
      if (z.deleted) why = 'النطاق نفسه متمسوح (deleted_at)';
      else if (!z.is_active) why = 'النطاق متوقّف (is_active = false)';
      else if (geographicMatching && !z.has_boundary) {
        why =
          'المدينة دي فعّلت المطابقة الجغرافية (فيه نطاق واحد على الأقل برسم حدود)، والنطاق ده **بلا رسم حدود** — فمستحيل أي عنوان يترسّى عليه. ارسم حدوده.';
      } else {
        why =
          `مفيش ولا نطاق برسم حدود في المدينة دي، فكل العناوين بترسّى على **أقدم نطاق نشط** (${city.oldest_active_zone_id}). النطاق ده مش الأقدم، فمستحيل يوصله عميل. ارسم حدود النطاقات، أو اشتغل بنطاق واحد للمدينة.`;
      }

      console.log(`❌ ${line}`);
      console.log(`     ${why}`);
      if (ONLY_ZONE || ONLY_CITY) await printTechnicianChain(q, z);
      if (Number(counts.techs_approved) > 0) {
        console.log(`     ⚠️  فيه ${counts.techs_approved} فني معتمد في النطاق ده — اعتمادهم بلا أي أثر دلوقتي.`);
        problems.push({ zone: `${z.city_name} › ${z.name_ar}`, techs: Number(counts.techs_approved), why });
      }
      console.log('');
    }

    console.log('\n— الخلاصة —\n');
    if (problems.length === 0) {
      console.log('✅ كل نطاق فيه فنيين معتمدين قابل للوصول من عناوين العملاء.');
    } else {
      console.log(`❌ ${problems.length} نطاق فيهم فنيين معتمدين ومستحيل عميل يوصلهم:`);
      for (const p of problems) console.log(`   • ${p.zone} — ${p.techs} فني`);
      console.log('\nده مش عطل في شاشة الأدمن: الاعتماد اتسجّل فعلاً، بس مافيش عنوان بيترسّى على النطاق ده.');
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
