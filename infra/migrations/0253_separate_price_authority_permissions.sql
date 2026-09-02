-- ADR-0068 — فصل سلطة السعر لتلات صلاحيات بدل واحدة.
--
-- `orders.adjust_price` كانت بتفتح سبع عمليات مختلفة الخطورة: من «خفّض سعر لعميل زعلان» لحد
-- «اعتمد سعر أعلى من السقف اللي العميل شافه». الفصل بيخلي الأدوار قابلة للضبط بدقة.

INSERT INTO permissions (name, resource, action) VALUES
  ('orders.approve_price_increase', 'orders', 'approve_price_increase'),
  ('orders.waive_fees',             'orders', 'waive_fees')
ON CONFLICT (name) DO NOTHING;

-- **توافق**: كل دور عنده orders.adjust_price النهاردة بياخد الاتنين تلقائيًا — صفر تغيير سلوك
-- يوم النشر. المكسب إنهم بقوا قابلين للسحب لوحدهم من شاشة الأدوار من غير أي كود.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
  FROM role_permissions rp
  JOIN permissions existing ON existing.id = rp.permission_id AND existing.name = 'orders.adjust_price'
  JOIN permissions p ON p.name IN ('orders.approve_price_increase', 'orders.waive_fees')
ON CONFLICT DO NOTHING;
