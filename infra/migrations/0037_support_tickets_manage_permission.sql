-- baytak — 0037: صلاحية support_tickets.manage (تعيين/تغيير حالة تذاكر الدعم العامة)
-- مرجع: apps/api/src/modules/support/README.md (فجوة موثّقة اتقفلت هنا) — نفس نمط complaints.resolve في 0020

INSERT INTO permissions (name, resource, action) VALUES
  ('support_tickets.manage', 'support_tickets', 'manage');

-- ملحوظة: الـ CROSS JOIN اللي بيدّي super_admin كل الصلاحيات (0020) كان snapshot وقتها بس —
-- أي صلاحية جديدة بعد كده (زي كل صلاحيات 0022+) لازم تتمنح لـ super_admin صراحة هنا كمان،
-- نفس نمط كل migration صلاحية سابقة (مثلاً 0022_catalog_manage_permission.sql).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'support_tickets.manage'
WHERE r.name IN ('super_admin', 'support_agent');
