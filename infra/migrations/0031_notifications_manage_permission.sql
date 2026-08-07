-- baytak — 0031: صلاحية تعديل قواعد توجيه الإشعارات — super_admin بس
-- مرجع: apps/api/src/modules/notifications/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('notifications.manage', 'notifications', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'notifications.manage'
WHERE r.name = 'super_admin';
