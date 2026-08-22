-- baytak — 0169: إلغاء بنية "الشغالة كنوع مزوّد منفصل" بالكامل (ADR-0031، تصحيح مالك 2026-08-21).
-- الشغالة/المربية/عامل التنظيف بقت فني عادي (UserType.TECHNICIAN) بمسار تسجيل/اعتماد/كتالوج
-- واحد موحّد — صفر كيان/جدول/عمود مستقل. مفيش بيانات إنتاجية حقيقية تستأهل الحفاظ عليها (تصريح
-- المالك صراحة)، فالإلغاء الكامل هنا قرار سليم، مش خطر يستأهل حذر migration رجعي.

-- قيود "مرجع واحد بالظبط" (ADR-0019) على payments/refunds — كانت تفرض بالظبط واحد من
-- order_id/domestic_worker_booking_id. بعد الإلغاء، order_id هو المرجع الوحيد دايمًا.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_exactly_one_payable_reference_chk;
DROP INDEX IF EXISTS idx_payments_domestic_worker_booking_id;
ALTER TABLE payments DROP COLUMN IF EXISTS domestic_worker_booking_id;

ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_exactly_one_payable_reference_chk;
DROP INDEX IF EXISTS idx_refunds_domestic_worker_booking_id;
ALTER TABLE refunds DROP COLUMN IF EXISTS domestic_worker_booking_id;

-- orders.domestic_worker_profile_id (ADR-0029 Slice 1) — الفني بقى فني عادي، technician_id
-- الموجود بالفعل كافي. domestic_worker_duration_hours اتعمم واتسمّى duration_hours (ADR-0031
-- Slice B، أي فني عادي بخدمة requires_precise_schedule=true ممكن يستخدمه، مش الشغالة بس).
ALTER TABLE orders DROP COLUMN IF EXISTS domestic_worker_profile_id;
ALTER TABLE orders RENAME COLUMN domestic_worker_duration_hours TO duration_hours;

-- دقة الوقت (ADR-0031 Slice B) — قدرة عامة جديدة على أي Service، معمَّمة من فكرة حجز الشغالة
-- بالساعة (كانت خاصة بـpricing_model=worker_rate بس)، مش قاصرة عليها.
ALTER TABLE services ADD COLUMN requires_precise_schedule BOOLEAN NOT NULL DEFAULT false;

-- الجداول المستقلة بالكامل (ADR-0004/ADR-0029) — إلغاء كامل، مفيش migration رجعي للبيانات
-- (تصريح مالك صريح: مفيش بيانات إنتاجية حقيقية تستأهل الحفاظ عليها).
DROP TABLE IF EXISTS domestic_worker_earning_approvals CASCADE;
DROP TABLE IF EXISTS domestic_worker_bookings CASCADE;
DROP TABLE IF EXISTS domestic_worker_profiles CASCADE;

-- ملحوظة: قيم enum قديمة (pricing_model.worker_rate, user_type.domestic_worker,
-- wallet_owner_type.domestic_worker, domestic_worker_booking_status/domestic_worker_specialty/
-- domestic_worker_booking_type الأنواع الكاملة) اتسابت من غير تعديل عمدًا — Postgres مايدعمش
-- DROP VALUE على enum بسهولة (محتاج إعادة بناء النوع بالكامل)، والقيم دي orphaned بس غير مؤذية
-- (صفر عمود بيستخدمها بعد الحذف فوق). موثّق صراحة في ADR-0031، مش سهو.
