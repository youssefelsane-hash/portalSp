-- baytak — 0025: صلاحية إدارة الموظفين (إنشاء/تعديل/حظر حسابات أدمن) — super_admin بس
-- مرجع: apps/api/src/modules/admin/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('employees.manage', 'employees', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'employees.manage'
WHERE r.name = 'super_admin';
