-- baytak — 0040: صلاحية technicians.manage_zones (تعيين/إزالة مناطق عمل الفني)
-- مرجع: apps/api/src/modules/technicians/README.md (فجوة موثّقة اتقفلت هنا — كانت technician_zones
-- يدوي عبر SQL مباشر تماماً) — نفس نمط catalog.manage في 0022. permission منفصل عن
-- technicians.approve عمداً: تعيين المناطق عملية تشغيلية يومية، مش قرار اعتماد/رفض فني.

INSERT INTO permissions (name, resource, action) VALUES
  ('technicians.manage_zones', 'technicians', 'manage_zones');

-- لازم تُمنح لـ super_admin صراحة — درس اتعلّمناه في 0037/0038/0039 (الـ CROSS JOIN في 0020 كان
-- snapshot لحظي وقتها بس، مش قاعدة حية).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'technicians.manage_zones'
WHERE r.name IN ('super_admin', 'ops_manager');
