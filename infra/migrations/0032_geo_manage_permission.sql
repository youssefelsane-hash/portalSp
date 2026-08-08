-- baytak — 0032: صلاحية إدارة المدن/المناطق/النطاقات (نقطة 7) — super_admin + ops_manager
-- مرجع: apps/api/src/modules/geo/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('geo.manage', 'geo', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'geo.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
