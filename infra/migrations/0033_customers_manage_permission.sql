-- baytak — 0033: صلاحية إدارة العملاء (عرض/حظر حسابات العملاء) — super_admin بس
-- مرجع: apps/api/src/modules/admin/README.md
INSERT INTO permissions (name, resource, action) VALUES
  ('customers.manage', 'customers', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'customers.manage'
WHERE r.name = 'super_admin';
