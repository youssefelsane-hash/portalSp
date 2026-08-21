-- baytak — 0166: أساس هجرة حجز الشغالة للمحرك الموحّد (ADR-0029، docs/08 §42 Phase A.4 Slice 1).
-- صفر تغيير سلوك لأي خدمة/طلب موجود — القيمة الجديدة worker_rate مش مستخدمة في أي Service حقيقي
-- لسه، وorders.domestic_worker_profile_id مش مقروء/مكتوب من أي كود لسه (Slice 2).

-- نموذج تسعير جديد: السعر من معدّل الفني (الشغالة) الشخصي، مش من الكتالوج (base_price_cents).
-- ADD VALUE آمن جوّه transaction (PostgreSQL 12+) طالما مش بنستخدم القيمة الجديدة في نفس الـmigration
-- (نفس نمط 0042_fawry_payment_method.sql).
ALTER TYPE pricing_model ADD VALUE 'worker_rate';

-- تمثيل الفني (الشغالة) على الطلب — نفس فلسفة "مرجع واحد بالظبط" اللي ADR-0019 أثبتها على
-- payments/refunds (domestic_worker_booking_id جنب order_id)، هنا بمعنى أخف: طلب بـ
-- domestic_worker_profile_id مش NULL لازم technician_id يفضل NULL دايمًا (الفحص هيتفرض كودياً في
-- Slice 2، مش CHECK constraint هنا — orders.technician_id أصلاً nullable لأسباب تانية كتير).
ALTER TABLE orders ADD COLUMN domestic_worker_profile_id UUID NULL REFERENCES domestic_worker_profiles(id);

