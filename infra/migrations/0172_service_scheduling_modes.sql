-- baytak — 0172: أوضاع توقيت الخدمة الجديدة (ADR-0032) — تبادلية مع requires_precise_schedule
-- الموجودة، صفر تغيير على سلوكها. تفاصيل القرار الكامل في docs/adr/0032-service-scheduling-modes.md.

ALTER TABLE services ADD COLUMN requires_start_time_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN requires_hours_only BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE services ADD COLUMN requires_start_and_end BOOLEAN NOT NULL DEFAULT false;

-- تبادلية حقيقية على مستوى الـDB — على الأكتر وضع واحد فعّال في نفس الوقت، مش بس تحقق تطبيقي
-- ممكن يتجاوَز. (عدد الـtrue بين الأربعة <= 1)
ALTER TABLE services ADD CONSTRAINT chk_services_scheduling_mode_exclusive CHECK (
  (CASE WHEN requires_precise_schedule THEN 1 ELSE 0 END) +
  (CASE WHEN requires_start_time_only THEN 1 ELSE 0 END) +
  (CASE WHEN requires_hours_only THEN 1 ELSE 0 END) +
  (CASE WHEN requires_start_and_end THEN 1 ELSE 0 END) <= 1
);

ALTER TABLE orders ADD COLUMN scheduled_end_at TIMESTAMPTZ;
ALTER TABLE orders ADD CONSTRAINT chk_orders_scheduled_end_after_start CHECK (
  scheduled_end_at IS NULL OR scheduled_at IS NULL OR scheduled_end_at > scheduled_at
);
