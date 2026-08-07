-- baytak — 0021: صلاحية مشاهدة سجل التدقيق الكامل — super_admin بس، مش أي أدمن
-- مرجع: apps/api/src/modules/admin/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('audit.view', 'audit', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'audit.view'
WHERE r.name = 'super_admin';
