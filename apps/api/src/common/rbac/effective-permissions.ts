import { DataSource, EntityManager } from 'typeorm';

/** أي حاجة بتعرف تنفّذ SQL — `DataSource` أو `EntityManager` جوّه ترانزاكشن. */
type Queryable = Pick<DataSource | EntityManager, 'query'>;

/**
 * الصلاحيات الفعلية لمستخدم — **مصدر واحد** لكل مسار بيسأل «هو مسموح له؟».
 *
 * كان فيه نسختين من نفس الاستعلام: `PermissionsService.getUserPermissionNames()` للـHTTP،
 * ونسخة يدوية جوّه `AdminRealtimeGateway` للسوكِت (اتكتبت كده عشان دورة استيراد موثّقة في
 * `admin.module.ts`). النسختين اتفرّقوا فعلاً: قاعدة الاشتقاق (ADR-0074) اتضافت في الأولى بس،
 * فبقى نفس المستخدم مسموح له على الـREST ومرفوض على السوكِت. الدالة دي بتقفل الفرق ده بنيويًا —
 * وحدة نقية مالهاش أي اعتماد على Nest، فمفيش دورة استيراد أصلاً.
 *
 * القاعدة (ADR-0074): أي دور عنده **أي** صلاحية على مورد بياخد `<resource>.view` بتاعه ضمنيًا.
 * `action = 'view'` بالظبط — النطاقات الأضيق على نفس المورد (`technicians.finance.view` →
 * `finance_view`) مش بتتشتق.
 */
export async function loadEffectivePermissionNames(db: Queryable, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ name: string }[]>(
    `WITH granted AS (
       SELECT p.name, p.resource
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id AND p.deleted_at IS NULL
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL AND r.is_active = true
       WHERE ur.user_id = $1
     )
     SELECT name FROM granted
     UNION
     SELECT v.name FROM permissions v
     WHERE v.action = 'view' AND v.deleted_at IS NULL
       AND v.resource IN (SELECT resource FROM granted)`,
    [userId],
  );
  return new Set(rows.map((r) => r.name));
}

/**
 * `super_admin` بيتخطّى الفحص بالكامل (ADR-0010 §1) — بيقفل بَقّة «لازم تفتكر تمنح كل صلاحية
 * جديدة لـsuper_admin يدويًا». استعلام منفصل عمدًا: الإجابة `true` بتوفّر الاستعلام التاني كله.
 */
export async function isSuperAdmin(db: Queryable, userId: string): Promise<boolean> {
  const rows = await db.query<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.is_super_admin = true AND r.is_active = true AND r.deleted_at IS NULL
     ) AS exists`,
    [userId],
  );
  return rows[0]?.exists === true;
}
