-- تدقيق A-4 (أثر جانبي لتدقيق S-1) — موضوع `payments` في البث اللحظي للأدمن كان `null`، يعني
-- أي موظف يقدر يشترك فيه ويستقبل أحداث المدفوعات لحظيًا. بعد S-1 بقى ده تناقض صريح: نفس
-- البيانات على الـREST بقت وراء صلاحية، وعلى السوكِت مفتوحة. بوابتين لنفس البيانات بمعيارين
-- مختلفين = الأضعف فيهم هو الفعلي.
--
-- باقي المواضيع الستة اللي كانوا `null` اتربطوا بصلاحيات موجودة أصلاً (`orders.view`,
-- `technicians.view`, `refunds.view`, `support_tickets.view`) — المدفوعات هي الوحيدة اللي
-- مكانش لها صلاحية قراءة في الكتالوج.

INSERT INTO permissions (name, resource, action) VALUES
  ('payments.view', 'payments', 'view')
ON CONFLICT (name) DO NOTHING;

-- نفس قاعدة التوزيع المتّبعة في 0268: مين بيتعامل مع الفلوس فعلاً يقراها. مشتقّ من البيانات
-- عشان يمشي على أي دور مخصّص في الإنتاج كمان، مش على قايمة أدوار مكتوبة بالإيد.
INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, target.id
FROM role_permissions rp
JOIN permissions src ON src.id = rp.permission_id
  AND src.resource IN ('payments', 'payouts', 'wallets', 'refunds', 'settlement', 'platform_commission')
JOIN permissions target ON target.name = 'payments.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- مدير العمليات بيشوف حالة دفع الطلب جوّه شاشة الطلب (مش كشوف مالية) — نفس منطق
-- `orders.view` اللي اتمنح له في 0268.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name = 'payments.view'
WHERE r.name = 'ops_manager' AND r.deleted_at IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;
