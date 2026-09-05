#!/usr/bin/env node
/**
 * **بيانات تشغيل محلية — الحد الأدنى اللي بيخلّي النظام قابل للاستخدام فعلاً.**
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * قاعدة نضيفة بعد كل الـmigrations بتطلع كده بالظبط (اتقيس، مش تخمين):
 *
 * | | العدد |
 * |---|---|
 * | فئات خدمة · خدمات | ٥ · ٤ ✅ |
 * | صلاحيات · أدوار · إعدادات | ١٠٣ · ٥ · ١٨٥ ✅ |
 * | **مستخدم أدمن تقدر تدخل بيه** | **صفر** ❌ |
 * | **مدن · نطاقات خدمة** | **صفر · صفر** ❌ |
 * | **فنيين · عملاء** | **صفر · صفر** ❌ |
 *
 * الصف الوحيد في `users` هو `+200000000000` = **حساب المنصّة النظامي** (بيتستخدم في حركات
 * المحفظة)، و`is_active = false` — يعني **مش حساب دخول**.
 *
 * النتيجة إن كل حاجة «بتشتغل» ومفيش حاجة بتبان:
 *
 *   • لوحة الإدارة: مفيش حساب تدخل بيه أصلاً ⇒ «الأدمن مش شغال».
 *   • تطبيق العميل: الفئات بتظهر، بس **مفيش مدينة ولا نطاق خدمة** ⇒ مايقدرش يضيف عنوان،
 *     ومن غير عنوان مفيش حجز — فالتطبيق يبان فاضي.
 *   • تطبيق الفني: مفيش حساب فني ⇒ مفيش شغل يظهر.
 *
 * ده **مش بق في الكود** — ده بيانات ناقصة. والـmigrations مش مكانها: الـmigration بيوصف
 * **المخطّط** وبيانات مرجعية ثابتة، مش حسابات تجريبية بأرقام موبايل وهمية تروح الإنتاج معاها.
 *
 * ## الاستخدام
 *
 *   node scripts/seed-dev-data.js
 *
 * idempotent بالكامل — تشغيله عشر مرات بيدي نفس النتيجة (كل إدخال `ON CONFLICT DO NOTHING`
 * أو مسبوق بفحص وجود).
 *
 * **مايشتغلش لو `NODE_ENV` إنتاجي** — الحسابات دي بأرقام وهمية ومستوى تحقق «مقبول» بلا أي
 * مستندات حقيقية؛ وصولها لقاعدة إنتاج معناه حسابات مفتوحة بلا تحقق.
 */
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 'postgres://baytak:baytak@localhost:5432/baytak';

// أرقام وهمية بنمط ثابت وسهل الحفظ — مصر (+20) + صفر متكرر + رقم الدور.
const ACCOUNTS = {
  admin: { phone: '+201000000001', name: 'أدمن التطوير' },
  technician: { phone: '+201000000002', name: 'فني التطوير' },
  customer: { phone: '+201000000003', name: 'عميل التطوير' },
};

// ميدان التحرير — نقطة مركزية في القاهرة، والنطاق مربع حواليها بيغطي وسط البلد كله.
const CAIRO = { lng: 31.2357, lat: 30.0444 };
const ZONE_BOX = { minLng: 31.10, minLat: 29.95, maxLng: 31.40, maxLat: 30.15 };

/**
 * إنشاء/تفعيل مستخدم بالرقم.
 *
 * **مش `ON CONFLICT`**: الفهرس الفريد على `phone_number` **جزئي**
 * (`WHERE deleted_at IS NULL`)، فـ`ON CONFLICT (phone_number)` بيرفض بـ«مفيش قيد مطابق».
 * فحص-ثم-إدخال هنا أوضح، ومفيش سباق يخاف منه في سكريبت تطوير بيتشغّل يدويًا.
 */
async function upsertUser(q, { phone, name, type }) {
  const [existing] = await q(`SELECT id FROM users WHERE phone_number = $1 AND deleted_at IS NULL`, [phone]);
  if (existing) {
    await q(`UPDATE users SET is_active = true, user_type = $2, full_name = $3 WHERE id = $1`, [existing.id, type, name]);
    return existing.id;
  }
  const [created] = await q(
    `INSERT INTO users (phone_number, full_name, user_type, is_active, phone_verified_at)
     VALUES ($1, $2, $3, true, now()) RETURNING id`,
    [phone, name, type],
  );
  return created.id;
}

async function main() {
  if (['production', 'staging'].includes(process.env.NODE_ENV)) {
    console.error('❌ السكريبت ده للتطوير المحلي بس — الحسابات دي بأرقام وهمية بلا أي تحقق حقيقي.');
    process.exit(1);
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
  const done = [];

  try {
    await db.query('BEGIN');

    // ── ١) مدينة + نطاق خدمة ────────────────────────────────────────────────
    // من غير دول العميل مايقدرش يضيف عنوان أصلاً، ومن غير عنوان مفيش حجز. ده أكتر جزء
    // بيتنسى لأن غيابه مابيطلعش رسالة خطأ واضحة — الشاشة بتفضل فاضية بس.
    const [country] = await q(`SELECT id FROM countries ORDER BY created_at LIMIT 1`);
    if (!country) throw new Error('مفيش دولة في القاعدة — الـmigrations اتطبقت صح؟');

    const [city] = await q(
      `INSERT INTO cities (country_id, name_ar, name_en, slug, center_location, is_active, launched_at)
       VALUES ($1, 'القاهرة', 'Cairo', 'cairo',
               ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, true, now())
       ON CONFLICT (slug) DO UPDATE SET is_active = true
       RETURNING id`,
      [country.id, CAIRO.lng, CAIRO.lat],
    );
    done.push(['مدينة', 'القاهرة']);

    let [zone] = await q(`SELECT id FROM service_zones WHERE city_id = $1 AND deleted_at IS NULL LIMIT 1`, [city.id]);
    if (!zone) {
      [zone] = await q(
        `INSERT INTO service_zones (city_id, name_ar, name_en, boundary, is_active)
         VALUES ($1, 'وسط القاهرة', 'Central Cairo',
                 ST_SetSRID(ST_MakeEnvelope($2, $3, $4, $5), 4326)::geography, true)
         RETURNING id`,
        [city.id, ZONE_BOX.minLng, ZONE_BOX.minLat, ZONE_BOX.maxLng, ZONE_BOX.maxLat],
      );
    }
    done.push(['نطاق خدمة', 'وسط القاهرة']);

    // ── ٢) أدمن يقدر يدخل فعلاً ─────────────────────────────────────────────
    const adminUserId = await upsertUser(q, { ...ACCOUNTS.admin, type: 'admin' });
    const [superAdmin] = await q(`SELECT id FROM roles WHERE name = 'super_admin' LIMIT 1`);
    if (!superAdmin) throw new Error("مفيش دور super_admin — الـmigration 0020 اتطبق؟");
    await q(
      `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [adminUserId, superAdmin.id],
    );
    done.push(['أدمن (super_admin)', ACCOUNTS.admin.phone]);

    // ── ٣) فني معتمد وجاهز يستقبل شغل ───────────────────────────────────────
    const techUserId = await upsertUser(q, { ...ACCOUNTS.technician, type: 'technician' });
    let [techProfile] = await q(`SELECT id FROM technician_profiles WHERE user_id = $1`, [techUserId]);
    if (!techProfile) {
      [techProfile] = await q(
        `INSERT INTO technician_profiles
           (user_id, technician_code, current_level, verification_status, is_available, is_on_duty, current_location)
         VALUES ($1, 'DEV-TECH-001', 'new', 'approved', true, true,
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)
         RETURNING id`,
        [techUserId, CAIRO.lng, CAIRO.lat],
      );
    }
    // مؤهّل لكل الخدمات الموجودة + شغّال في النطاق — من غير الاتنين دول التوزيع مالقاش حد.
    await q(
      `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
       SELECT $1, s.id, true, 'approved' FROM services s WHERE s.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [techProfile.id],
    );
    await q(
      `INSERT INTO technician_zones (technician_id, service_zone_id, is_active)
       SELECT $1, $2, true
       WHERE NOT EXISTS (
         SELECT 1 FROM technician_zones
         WHERE technician_id = $1 AND service_zone_id = $2 AND deleted_at IS NULL
       )`,
      [techProfile.id, zone.id],
    );
    const [svcCount] = await q(`SELECT count(*)::int AS c FROM technician_services WHERE technician_id = $1`, [techProfile.id]);
    done.push(['فني معتمد', `${ACCOUNTS.technician.phone} · ${svcCount.c} خدمة`]);

    // ── ٤) عميل ─────────────────────────────────────────────────────────────
    const custUserId = await upsertUser(q, { ...ACCOUNTS.customer, type: 'customer' });
    const [existingProfile] = await q(`SELECT id FROM customer_profiles WHERE user_id = $1`, [custUserId]);
    if (!existingProfile) {
      await q(`INSERT INTO customer_profiles (user_id) VALUES ($1)`, [custUserId]);
    }
    // عنوان جاهز جوّه النطاق — عشان تقدر تحجز من غير ما تلف على الخريطة كل مرة.
    const [addr] = await q(`SELECT id FROM addresses WHERE user_id = $1 AND deleted_at IS NULL LIMIT 1`, [custUserId]);
    if (!addr) {
      await q(
        `INSERT INTO addresses (user_id, city_id, street_name, building_number, location, is_default)
         VALUES ($1, $2, 'شارع التحرير', '10', ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, true)`,
        [custUserId, city.id, CAIRO.lng, CAIRO.lat],
      );
    }
    done.push(['عميل + عنوان', ACCOUNTS.customer.phone]);

    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    console.error(`\n❌ فشل زرع البيانات: ${error.message}\n`);
    process.exit(1);
  } finally {
    await db.end();
  }

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  console.log('\n\x1b[32m✅ بيانات التطوير جاهزة\x1b[0m\n');
  for (const [label, value] of done) console.log(`   ${pad(label, 22)} ${value}`);
  console.log(`
   \x1b[2mالدخول بالـOTP: اطلب الكود من التطبيق/اللوحة، وهتلاقيه مطبوع في لوج الـAPI:
     tail -f .dev-logs/api.log | grep OTP\x1b[0m
`);
}

main();
