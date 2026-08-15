-- baytak — 0108: تسليم كاش بتأكيد الطرفين (docs/08 §22 بند 13-14)
-- كانت فجوة موثّقة صراحة: collectCash() تأكيد الفني بس، صفر أثر لتأكيد العميل، وصفر مسار
-- "لم أستلم" حقيقي للفني — إعادة استخدام كاملة لـComplaint الموجودة لمسار النزاع، صفر جدول جديد.

ALTER TABLE orders ADD COLUMN customer_cash_confirmed_at TIMESTAMPTZ NULL;
ALTER TABLE orders ADD COLUMN technician_cash_not_received_at TIMESTAMPTZ NULL;

-- صلاحية أدمن مخصوصة لحل نزاع تسليم الكاش — نفس نمط orders.resolve_failed_visit في migration 0107
-- بالحرف، نفس مستوى حساسية مالية.
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.resolve_cash_dispute', 'orders', 'resolve_cash_dispute');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.resolve_cash_dispute'
WHERE r.name IN ('super_admin', 'ops_manager');
