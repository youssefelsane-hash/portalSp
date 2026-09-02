-- baytak (صُنّاع) — 0244: دقة الموعد بقت وضعين بس (ADR-0060 §4، docs/08 §113).
--
-- طلب المالك حرفيًا: «من دقة الموعد المطلوبة هنحتاج بس منهم وقت بداية فقط ويوم كامل. يعني يا
-- إما يختار الساعة، ويا إما يختار التاريخ بس من غير الساعة».
--
-- الأوضاع اللي اتشالت وليه:
--   requires_precise_schedule (بداية + مدة)  → المدة بقت حقل تسعير/ناتج معادلة، مش رقم العميل
--   requires_hours_only       (عدد ساعات بس) → نفس السبب
--   requires_start_and_end    (بداية ونهاية) → دي كانت بتتعارض مع الفترة الشهرية وبتعرض حقول
--                                              تاريخ مكررة على نفس الشاشة (البلاغ الأصلي)
--
-- الخدمات اللي كانت بتطلب وقت بداية (precise أو start_and_end) بتتحول لـ«وقت بداية فقط» — الجزء
-- اللي بيهم العميل فعلاً (امتى الفني ييجي) محفوظ، والباقي بقى مسؤولية محرك التسعير.
-- تحديث واحد عمدًا: قيد `chk_services_scheduling_mode_exclusive` (وضع واحد فعّال على الأكتر)
-- بيترفض لو حطينا الوضع الجديد قبل ما نطفّي القديم في جملة منفصلة.
UPDATE services
SET requires_start_time_only = (requires_precise_schedule OR requires_start_and_end OR requires_start_time_only),
    requires_precise_schedule = false,
    requires_hours_only = false,
    requires_start_and_end = false
WHERE requires_precise_schedule = true OR requires_hours_only = true OR requires_start_and_end = true;

-- الأعمدة بتفضل موجودة عمدًا (بيانات تاريخية + تفادي إعادة بناء الجدول)، بس القيد ده بيمنع أي
-- مسار — كود قديم، سكريبت يدوي، seed — من إحيائهم.
ALTER TABLE services
  ADD CONSTRAINT chk_services_schedule_modes_supported
  CHECK (
    requires_precise_schedule = false
    AND requires_hours_only = false
    AND requires_start_and_end = false
  );
