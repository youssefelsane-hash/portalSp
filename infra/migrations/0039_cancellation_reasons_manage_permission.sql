-- baytak — 0039: صلاحية cancellation_reasons.manage (إدارة قايمة أسباب الإلغاء المعيارية)
-- مرجع: apps/api/src/modules/orders/README.md (فجوة موثّقة اتقفلت هنا) — نفس نمط catalog.manage في 0022

INSERT INTO permissions (name, resource, action) VALUES
  ('cancellation_reasons.manage', 'cancellation_reasons', 'manage');

-- لازم تُمنح لـ super_admin صراحة — درس اتعلّمناه في 0037/0038 (الـ CROSS JOIN في 0020 كان
-- snapshot لحظي وقتها بس، مش قاعدة حية).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'cancellation_reasons.manage'
WHERE r.name IN ('super_admin', 'ops_manager');
