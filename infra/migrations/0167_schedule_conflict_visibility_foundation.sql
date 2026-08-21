-- baytak — 0167: أساس سياسة إظهار المرشّحين المتعارضين جدوليًا (ADR-0030، docs/08 §42) + إصلاح
-- فجوة صحة بيانات حقيقية: صفر فحص تعارض جدولي لحجز الشغالة حاليًا (قديم أو جديد). صفر تغيير سلوك
-- لأي خدمة/طلب موجود — show_unavailable_providers مش مقروء في أي استعلام لسه (Slice B/C).

ALTER TABLE services ADD COLUMN show_unavailable_providers BOOLEAN NOT NULL DEFAULT false;

-- كان ناقص من ADR-0029 Slice 2a — اتحسب للسعر بس واتفقد، لازم يتسجّل عشان فحص التعارض الجديد
-- (DomesticWorkersService.assertNoSchedulingConflict()) يشتغل صح على مسار orders الموحّد.
ALTER TABLE orders ADD COLUMN domestic_worker_duration_hours SMALLINT NULL;
