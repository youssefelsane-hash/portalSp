-- baytak — 0061: الضمان وإعادة الزيارة (docs/08 §7)
-- اكتشاف قبل أي كود: orders.warranty_expires_at وorders.parent_order_id **موجودين بالفعل من
-- migration 0007 الأولى** بس معمول عليهم أي حساب/استخدام خالص — نفس فئة "أعمدة راكدة" اللي
-- اتكشفت أكتر من مرة في السيشن ده (customer_profiles.total_orders_count، technician_services.
-- completed_count، إلخ). مفيش أعمدة جديدة اتضافت هنا — بس تفعيل الموجود + enum جديد.
ALTER TYPE order_type ADD VALUE 'revisit';

-- parent_order_id هو الرابط بين "طلب إعادة الزيارة" والطلب الأصلي (API contract اسمها
-- original_order_id — أوضح دلالياً للعميل، بس بتترجم لنفس العمود ده داخليًا، مفيش عمود مكرر).
CREATE INDEX idx_orders_parent_order_id ON orders(parent_order_id) WHERE parent_order_id IS NOT NULL;
