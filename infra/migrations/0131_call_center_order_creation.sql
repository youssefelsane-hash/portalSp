-- Script 4 §33-37 — Call Center: إنشاء طلب نيابة عن عميل. كانت فجوة موثّقة صراحة: order_source_channel
-- عنده قيمة 'call_center' من زمان (migration الأصلية) بس orders.service.ts بيحط
-- OrderSourceChannel.CUSTOMER_APP دايمًا بلا شرط — عمود ميت. مفيش أي مسار للموظف ينشئ طلب نيابة
-- عن عميل، ومفيش صلاحية مخصصة لده أصلاً (السبيسفيكيشن الأصلي بيطلب صلاحية مخصصة صراحة، مش منح
-- تلقائي لكل أدمن).

ALTER TABLE orders
  ADD COLUMN created_by_admin_user_id UUID NULL REFERENCES users(id);

CREATE INDEX idx_orders_created_by_admin_user_id ON orders(created_by_admin_user_id)
  WHERE created_by_admin_user_id IS NOT NULL;

-- صلاحية مخصصة (orders.create_for_customer) — مش orders.manage عامة، ومش ممنوحة لـops_manager
-- زي orders.cancel/orders.reassign (دول عمليات تشغيلية على طلب موجود، ده إنشاء طلب جديد بهوية
-- عميل تانية بالكامل، خطر مختلف). ممنوحة بس لـsuper_admin وsupport_agent (فريق مركز الاتصال
-- الفعلي، migration 0003_auth.sql).
INSERT INTO permissions (name, resource, action) VALUES
  ('orders.create_for_customer', 'orders', 'create_for_customer');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'orders.create_for_customer'
WHERE r.name IN ('super_admin', 'support_agent');
