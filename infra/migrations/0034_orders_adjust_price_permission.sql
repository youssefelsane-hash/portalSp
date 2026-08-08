-- baytak — 0034: صلاحية تعديل سعر الطلب يدوياً (قبل الدفع) — super_admin + ops_manager
-- مرجع: apps/api/src/modules/orders/README.md
-- نفس نمط منح orders.cancel/orders.reassign لـ ops_manager في 0020 — تعديل السعر عملية تشغيلية
-- يومية (تصحيح خطأ تسعير، تعديل بعد اتفاق تليفوني مع العميل) مش قرار مالي بمستوى finance.
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.adjust_price', 'orders', 'adjust_price');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.adjust_price'
WHERE r.name IN ('super_admin', 'ops_manager');
