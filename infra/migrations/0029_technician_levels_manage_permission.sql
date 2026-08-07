-- baytak — 0029: صلاحية تعديل إعدادات مستويات الفنيين (عمولة، أولوية، حد قرار) — super_admin + ops_manager
-- مرجع: apps/api/src/modules/technicians/README.md

INSERT INTO permissions (name, resource, action) VALUES
  ('technician_levels.manage', 'technician_levels', 'manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'technician_levels.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
