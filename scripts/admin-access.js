#!/usr/bin/env node
/**
 * **تشخيص وإصلاح صلاحيات حساب الأدمن.**
 *
 * ## المشكلة اللي الملف ده موجود عشانها
 *
 * تدقيق S-1 لقى ٩٢ مسار أدمن **مفتوح لأي موظف** (`PermissionsGuard` كان fail-open: مسار بلا
 * `@RequirePermission` بيعدّي، وكل موظف `user_type='admin'`). الإصلاح أضاف صلاحية صريحة لكل
 * مسار — دلوقتي ٣٣٨ مسار بصلاحية دقيقة.
 *
 * **الأثر الجانبي على قاعدة موجودة من قبل الإصلاح**: حساب أدمن دوره مش شايل الصلاحيات الجديدة
 * بيفضل يدخل عادي، بس:
 *
 *   • الـsidebar بيخفي كل بند المستخدم مالوش صلاحيته ⇒ تلاقي بندين تلاتة بس بدل اللوحة كلها.
 *   • كروت اللوحة بترجع 403 ⇒ تفضل رمادية بتحمّل للأبد.
 *
 * يعني الشكل بالظبط زي «النظام مش شغال»، والحقيقة إن الحساب مش مصرّح له. الفرق ده هو اللي
 * السكريبت ده بيوضّحه.
 *
 * ## الاستخدام
 *
 *   node scripts/admin-access.js                      # اعرض كل حسابات الأدمن وصلاحياتها
 *   node scripts/admin-access.js --grant-super <رقم>  # اعمل الحساب ده super_admin
 *
 * `super_admin` بيتخطّى فحص الصلاحيات بالكامل (ADR-0010 §1) — فهو الإصلاح الصح لحساب المالك
 * على جهازه، مش منح ٣٠ صلاحية واحدة واحدة.
 */
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 'postgres://baytak:baytak@localhost:5432/baytak';
const GREEN = '\x1b[32m'; const YELLOW = '\x1b[33m'; const RED = '\x1b[31m'; const DIM = '\x1b[2m'; const OFF = '\x1b[0m';

async function main() {
  const grantIndex = process.argv.indexOf('--grant-super');
  const grantPhone = grantIndex > -1 ? process.argv[grantIndex + 1] : null;

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

  try {
    if (grantPhone) {
      const [user] = await q(
        `SELECT id, full_name FROM users WHERE phone_number = $1 AND deleted_at IS NULL`,
        [grantPhone],
      );
      if (!user) {
        console.error(`${RED}❌ مفيش مستخدم بالرقم ${grantPhone}${OFF}`);
        console.error(`${DIM}   شغّل السكريبت من غير وسائط عشان تشوف الأرقام الموجودة.${OFF}`);
        process.exit(1);
      }

      // الدور الموجود أصلاً — مش بننشئ دور جديد لو فيه واحد متعلّم `is_super_admin`.
      let [role] = await q(`SELECT id, name FROM roles WHERE is_super_admin = true AND deleted_at IS NULL LIMIT 1`);
      if (!role) {
        [role] = await q(
          `INSERT INTO roles (name, description_ar, is_super_admin, is_active)
           VALUES ('super_admin', 'صلاحية كاملة — بيتخطّى فحص الصلاحيات', true, true)
           RETURNING id, name`,
        );
      }
      await q(`UPDATE users SET user_type = 'admin', is_active = true WHERE id = $1`, [user.id]);
      await q(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, role.id],
      );
      console.log(`\n${GREEN}✅ ${user.full_name} (${grantPhone}) بقى ${role.name}${OFF}`);
      console.log(`${DIM}   اعمل تسجيل خروج ودخول تاني من اللوحة — الصلاحيات بتتحمّل وقت الدخول.${OFF}\n`);
      return;
    }

    // ── العرض ────────────────────────────────────────────────────────────────
    const admins = await q(
      `SELECT u.id, u.phone_number, u.full_name, u.is_active,
              COALESCE(string_agg(DISTINCT r.name, ', '), '—') AS roles,
              bool_or(COALESCE(r.is_super_admin, false)) AS is_super
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.is_active = true
       WHERE u.user_type = 'admin' AND u.deleted_at IS NULL
       GROUP BY u.id, u.phone_number, u.full_name, u.is_active
       ORDER BY u.created_at`,
    );

    if (admins.length === 0) {
      console.log(`\n${RED}❌ مفيش أي حساب أدمن في القاعدة دي.${OFF}\n`);
      return;
    }

    console.log(`\n${'حسابات الأدمن'}\n`);
    for (const a of admins) {
      // نفس استعلام `loadEffectivePermissionNames` بالحرف — بما فيه اشتقاق `<resource>.view`
      // (ADR-0074). أي فرق هنا معناه إن العدد المعروض مش اللي السيرفر بيشوفه فعلاً.
      const [perms] = await q(
        `WITH granted AS (
           SELECT p.name, p.resource FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
           JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.is_active = true
           WHERE ur.user_id = $1
         )
         SELECT count(*)::int AS c FROM (
           SELECT name FROM granted
           UNION
           SELECT v.name FROM permissions v
           WHERE v.action = 'view' AND v.deleted_at IS NULL AND v.resource IN (SELECT resource FROM granted)
         ) x`,
        [a.id],
      );
      const [total] = await q(`SELECT count(*)::int AS c FROM permissions WHERE deleted_at IS NULL`);

      const effective = a.is_super ? total.c : perms.c;
      const badge = a.is_super
        ? `${GREEN}super_admin — كل الصلاحيات (${total.c})${OFF}`
        : effective < 20
          ? `${RED}${effective} صلاحية من ${total.c} — اللوحة هتبان شبه فاضية${OFF}`
          : `${YELLOW}${effective} صلاحية من ${total.c}${OFF}`;

      console.log(`  ${a.phone_number}  ${a.full_name}${a.is_active ? '' : `  ${RED}(معطّل)${OFF}`}`);
      console.log(`  ${DIM}الأدوار: ${a.roles}${OFF}`);
      console.log(`  ${badge}\n`);
    }

    const weak = admins.filter((a) => !a.is_super);
    if (weak.length > 0) {
      console.log(`${DIM}عشان تدي حساب صلاحية كاملة:${OFF}`);
      console.log(`  node scripts/admin-access.js --grant-super ${weak[0].phone_number}\n`);
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`${RED}❌ ${e.message}${OFF}`);
  process.exit(1);
});
