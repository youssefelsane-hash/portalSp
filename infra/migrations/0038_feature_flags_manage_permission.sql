-- baytak — 0038: صلاحية feature_flags.manage (إنشاء/تعديل/حذف فلاجات الميزات)
-- مرجع: apps/api/src/modules/feature-flags/README.md (فجوة موثّقة اتقفلت هنا) — نفس نمط catalog.manage في 0022

INSERT INTO permissions (name, resource, action) VALUES
  ('feature_flags.manage', 'feature_flags', 'manage');

-- لازم تُمنح لـ super_admin صراحة — الـ CROSS JOIN في 0020 كان snapshot لحظي وقتها بس، مش قاعدة
-- حية (نفس الدرس اللي اتعلّمناه وقت 0037_support_tickets_manage_permission.sql).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'feature_flags.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
