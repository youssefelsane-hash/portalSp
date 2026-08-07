-- baytak — 0023: صلاحية تعديل إعدادات النظام — super_admin بس
-- مرجع: apps/api/src/modules/settings/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('settings.manage', 'settings', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'settings.manage'
WHERE r.name = 'super_admin';
