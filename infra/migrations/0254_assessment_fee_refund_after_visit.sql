-- ADR-0069 — سياسة استرداد رسم المعاينة بعد زيارة حصلت فعلاً.
--
-- الافتراضي `true` = **سلوك النهاردة بالحرف** (الرسم بيترجع كامل). القرار ده تغيير في فلوس
-- العملاء، فالمالك هو اللي يفعّله لكل خدمة من لوحة الإدارة — الشغل ده بيسلّم المفتاح مش القلب.

ALTER TABLE services
  ADD COLUMN assessment_fee_refundable_after_visit boolean NOT NULL DEFAULT true;

-- Snapshot على الطلب زي باقي سياسات التقييم: تعديل الأدمن بكرة مايغيّرش استرداد طلب النهاردة.
ALTER TABLE orders
  ADD COLUMN assessment_fee_refundable_after_visit_snapshot boolean NOT NULL DEFAULT true;
