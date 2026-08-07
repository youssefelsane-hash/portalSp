-- baytak — 0022: صلاحية إدارة الكتالوج (فئات، خدمات، تسعير مناطق، تأهيل فنيين)
-- مرجع: apps/api/src/modules/catalog/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('catalog.manage', 'catalog', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'catalog.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
