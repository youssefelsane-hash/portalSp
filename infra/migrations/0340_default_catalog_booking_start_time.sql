-- Osta — 0340: ساعة وصول الفني هي الافتراضي في خدمات الكتالوج.
--
-- اختفاء خطوة الساعة كان يحدث لأن الخدمة الجديدة، عند غياب `schedule_precision` من نموذج
-- الإنشاء، تحفظ `requires_start_time_only = false` تلقائيًا. العميل يختار اليوم ثم ينتقل
-- مباشرة من دون وقت، بعكس الخدمات القديمة التي كانت مفعّل لها الوقت. نحول الخدمات المجدولة
-- الحالية إلى وقت وصول أيضًا؛ «يوم كامل» يظل اختيارًا صريحًا متاحًا من صفحة الخدمة في الإدارة.

ALTER TABLE services
  ALTER COLUMN requires_start_time_only SET DEFAULT true;

UPDATE services
SET requires_start_time_only = true
WHERE allows_scheduling = true
  AND requires_start_time_only = false;
