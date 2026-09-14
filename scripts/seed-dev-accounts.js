#!/usr/bin/env node
// حسابات ثابتة لبيئة التطوير — العملاء/الفنيين/الأدمنز اللي اختبارات `test_live/` بتسجّل دخول بيهم.
//
// **ليه موجود (تدقيق ماراثوني 2026-09-14، docs/08 §148)**: ملفات `test_live/` في التطبيقين بتسجّل
// دخول بأرقام ثابتة (`+201000000011` فني، `+201000000001` أدمن…). الأرقام دي كانت بتتعمل **بالإيد**
// في سيشن قديمة، فأي قاعدة تطوير نضيفة بترجّع «الرقم ده مش مسجل» لعشرة اختبارات دفعة واحدة —
// سبب السقوط مالوش أي علاقة بالكود المختبَر، ومكانش موثّق في مكان واحد.
//
// السكربت idempotent (بيتعرّف على المستخدم برقم الموبايل) ومحتاج `scripts/seed-dev-geo.js`
// يكون اتشغّل قبله عشان يبقى فيه مدينة/نطاق يربط بيهم.
//
// الاستخدام:  node scripts/seed-dev-geo.js && node scripts/seed-dev-accounts.js
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://baytak:baytak@localhost:5432/baytak_main';

// الأرقام دي **مش أسرار** — أرقام وهمية في قاعدة تطوير محلية، والدخول بيها بيتم بكود OTP
// بيتطبع في لوج التطوير بس (الإنتاج مابيطبعهوش). مافيش أي كلمة سر أو توكن متخزّن هنا.
const CUSTOMERS = [
  ['+201000009999', 'عميل التطوير الرئيسي'],
  ['+201000000101', 'عميل تطوير ١٠١'],
  ['+201000000102', 'عميل تطوير ١٠٢'],
  ['+201000005501', 'عميل تطوير ٥٥٠١'],
];
const TECHNICIANS = [
  ['+201000000011', 'فني التطوير الرئيسي', 'DEVT011'],
  ['+201000000012', 'فني تطوير تاني', 'DEVT012'],
  ['+201000000021', 'فني تطوير تالت', 'DEVT021'],
  // **فني مخصّص لكل اختبار بياخد طلبات (تدقيق §148)**: الفني مورد له «طلب نشط» واحد في
  // المسار ده، فلو أكتر من ملف اختبار اشتغلوا على نفس الفني، اللي بعده بيلاقيه مشغول ويفشل —
  // فشل سببه تزاحم الاختبارات مش الكود. كل ملف بياخد فني لوحده.
  ['+201000000013', 'فني اختبار التتبع', 'DEVT013'],
  ['+201000000014', 'فني اختبار الشات', 'DEVT014'],
  ['+201000000015', 'فني اختبار صور الشات', 'DEVT015'],
  ['+201000000016', 'فني اختبار البروفايل', 'DEVT016'],
  ['+201000000017', 'فني اختبار التقييم', 'DEVT017'],
  ['+201000000018', 'فني اختبار الدفع من المحفظة', 'DEVT018'],
  ['+201099988877', 'فني تطوير رابع', 'DEVT877'],
];
// أدمن `is_super_admin` بيعدّي كل `@RequirePermission` بالتعريف. `+201000000031` عمدًا **مش**
// كده: اختبار شات الدعم بيتأكد إن أدمن مالوش `support_tickets.manage` بيترفض ٤٠٣ — لو بقى
// super admin الاختبار ده بيبقى فاضي من غير ما يفشل.
const ADMINS = [
  ['+201000000001', 'أدمن التطوير الرئيسي', 'DEVADM001', 'super'],
  ['+201000000098', 'أدمن التطوير ٠٩٨', 'DEVADM098', 'super'],
  ['+201000000030', 'أدمن التطوير ٠٣٠', 'DEVADM030', 'super'],
  ['+201000000031', 'أدمن مالية التطوير', 'DEVADM031', 'finance'],
];
const FINANCE_PERMISSIONS = ['payments.view', 'payments.confirm_manual'];

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const q = (sql, params) => client.query(sql, params).then((r) => r.rows);
  try {
    const [city] = await q(`SELECT id FROM cities WHERE slug = 'cairo' AND deleted_at IS NULL`);
    const [zone] = city ? await q(`SELECT id FROM service_zones WHERE city_id = $1 AND is_active AND deleted_at IS NULL LIMIT 1`, [city.id]) : [];
    if (!city || !zone) throw new Error('مفيش مدينة/نطاق — شغّل scripts/seed-dev-geo.js الأول');
    const [area] = await q(`SELECT id FROM areas WHERE city_id = $1 AND is_launched AND is_active AND deleted_at IS NULL LIMIT 1`, [city.id]);

    /** بيرجّع id المستخدم، وبيعمله لو مش موجود. `users.phone_number` مالهاش unique constraint
     *  فـ`ON CONFLICT` مش متاحة — الفحص بيتعمل صراحةً. */
    async function upsertUser(phone, fullName, userType) {
      const [existing] = await q(`SELECT id FROM users WHERE phone_number = $1 AND deleted_at IS NULL LIMIT 1`, [phone]);
      if (existing) {
        await q(`UPDATE users SET user_type = $2, is_active = true WHERE id = $1`, [existing.id, userType]);
        return { id: existing.id, created: false };
      }
      const [row] = await q(
        `INSERT INTO users (phone_number, full_name, user_type, is_active) VALUES ($1,$2,$3,true) RETURNING id`,
        [phone, fullName, userType],
      );
      return { id: row.id, created: true };
    }

    let created = 0;

    for (const [phone, name] of CUSTOMERS) {
      const user = await upsertUser(phone, name, 'customer');
      if (user.created) created += 1;
      await q(`INSERT INTO customer_profiles (user_id) SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM customer_profiles WHERE user_id = $1)`, [user.id]);
      await q(
        `INSERT INTO addresses (user_id, city_id, area_id, street_name, building_number, location, is_default)
         SELECT $1,$2,$3,'شارع التطوير','1',ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography,true
         WHERE NOT EXISTS (SELECT 1 FROM addresses WHERE user_id = $1 AND deleted_at IS NULL)`,
        [user.id, city.id, area?.id ?? null],
      );
    }

    const services = await q(`SELECT id FROM services WHERE is_active = true AND deleted_at IS NULL LIMIT 50`);
    const zones = await q(
      `SELECT z.id FROM service_zones z JOIN cities c ON c.id = z.city_id
       WHERE z.is_active AND z.deleted_at IS NULL AND c.slug = ANY($1)`,
      [['cairo', 'giza', 'alexandria']],
    );
    for (const [phone, name, code] of TECHNICIANS) {
      const user = await upsertUser(phone, name, 'technician');
      if (user.created) created += 1;
      let [profile] = await q(`SELECT id FROM technician_profiles WHERE user_id = $1`, [user.id]);
      if (!profile) {
        [profile] = await q(
          `INSERT INTO technician_profiles
             (user_id, technician_code, current_level, verification_status, is_available, is_on_duty,
              technician_kind, current_location)
           VALUES ($1,$2,'premium','approved',true,true,'technician',
                   ST_SetSRID(ST_MakePoint(31.25,30.05),4326)::geography) RETURNING id`,
          [user.id, code],
        );
      }
      for (const service of services) {
        await q(
          `INSERT INTO technician_services (technician_id, service_id, is_active, verification_status)
           VALUES ($1,$2,true,'approved') ON CONFLICT DO NOTHING`,
          [profile.id, service.id],
        );
      }
      // **كل** نطاقات المدن المزروعة، مش القاهرة بس: `/cities` مرتّبة بالاسم العربي فأول مدينة
      // بترجع للعميل هي «الإسكندرية». فني متربط بالقاهرة لوحدها كان بيدّي
      // «الفني غير مؤهل للخدمة أو نطاق الطلب» على كل طلب بيتعمل في أول مدينة.
      for (const seededZone of zones) {
        await q(
          `INSERT INTO technician_zones (technician_id, service_zone_id, is_active) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,
          [profile.id, seededZone.id],
        );
      }
    }

    let [superRole] = await q(`SELECT id FROM roles WHERE is_super_admin = true AND is_active AND deleted_at IS NULL LIMIT 1`);
    if (!superRole) {
      [superRole] = await q(
        `INSERT INTO roles (name, display_name, is_super_admin, is_active) VALUES ('super_admin','مدير النظام',true,true) RETURNING id`,
      );
    }
    let [financeRole] = await q(`SELECT id FROM roles WHERE name = 'dev_finance' AND deleted_at IS NULL LIMIT 1`);
    if (!financeRole) {
      [financeRole] = await q(
        `INSERT INTO roles (name, display_name, is_super_admin, is_active) VALUES ('dev_finance','مالية (تطوير)',false,true) RETURNING id`,
      );
    }
    for (const permName of FINANCE_PERMISSIONS) {
      await q(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.name = $2 ON CONFLICT DO NOTHING`,
        [financeRole.id, permName],
      );
    }

    for (const [phone, name, code, kind] of ADMINS) {
      const user = await upsertUser(phone, name, 'admin');
      if (user.created) created += 1;
      await q(
        `INSERT INTO employee_profiles (user_id, employee_code, department, is_active)
         SELECT $1,$2,'ops',true WHERE NOT EXISTS (SELECT 1 FROM employee_profiles WHERE user_id = $1)`,
        [user.id, code],
      );
      // الدور بيتقرا من `user_roles` مش من بروفايل الموظف — ده مصدر `PermissionsGuard`.
      await q(`INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
        user.id,
        kind === 'super' ? superRole.id : financeRole.id,
      ]);
    }

    const [totals] = await q(
      `SELECT count(*) FILTER (WHERE user_type='customer')::int AS customers,
              count(*) FILTER (WHERE user_type='technician')::int AS technicians,
              count(*) FILTER (WHERE user_type='admin')::int AS admins
       FROM users WHERE phone_number = ANY($1) AND deleted_at IS NULL`,
      [[...CUSTOMERS, ...TECHNICIANS, ...ADMINS].map((r) => r[0])],
    );
    console.log(`✅ حسابات جديدة: ${created}`);
    console.log(`   جاهزة دلوقتي — عملاء: ${totals.customers} | فنيين: ${totals.technicians} | أدمنز: ${totals.admins}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
