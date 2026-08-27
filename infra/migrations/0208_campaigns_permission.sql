-- baytak — 0208: صلاحية إدارة الحملات التسويقية (ADR-0046)
--
-- من غير الصف ده، `@RequirePermission('campaigns.manage')` بيرفض **كل** أدمن — بما فيهم
-- super_admin — لأن الصلاحية مش موجودة أصلاً في الجدول فمفيش دور مربوط بيها.

INSERT INTO permissions (name, resource, action) VALUES
  ('campaigns.manage', 'campaigns', 'manage')
ON CONFLICT (name) DO NOTHING;

-- super_admin بياخد كل الصلاحيات (نفس منطق 0020) — الربط بيتعمل صراحةً هنا للصلاحية الجديدة
-- لأن الـCROSS JOIN في 0020 اتنفّذ مرة واحدة وقتها بس.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
 WHERE r.name = 'super_admin' AND p.name = 'campaigns.manage'
ON CONFLICT DO NOTHING;

-- التسويق أقرب لمسؤوليات مدير العمليات منه للمالية — نفس اللي ماسك promotions.manage.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'campaigns.manage'
 WHERE r.name = 'ops_manager'
ON CONFLICT DO NOTHING;
