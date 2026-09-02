-- baytak — 0248: ADR-0065 §4 — بصمة سياق الحجز بلا الفني، عشان إعادة اختيار المنفّذ تفضل لنفس الحجز.
--
-- `booking_match_previews.context_hash` الموجود بيدخل فيه `technician_id`، فتذكرة لفني تاني
-- بتديّ هاش مختلف بالضرورة — مالوش لازمة لمقارنة «هي دي نفس الشغلانة؟». العمود الجديد هو نفس
-- الدالة بالظبط بـ`technician_id = ''`، فمقارنة الطلب بالتذكرة الجديدة بتكشف أي تغيير في
-- المدخلات (فورم/موعد/إضافات/خصم) من غير ما نخزّن الـDTO كله على الطلب.
--
-- nullable عمدًا: الطلبات والتذاكر اللي اتعملت قبل الـmigration دي ماكانش عليها قفل منفّذ أصلاً،
-- فمفيش قيمة صحيحة نحطها لها — و`orderHasLockedProvider()` بترجع false لها زي ما هي.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS booking_context_hash varchar(64);

ALTER TABLE booking_match_previews
  ADD COLUMN IF NOT EXISTS booking_context_hash varchar(64);

COMMENT ON COLUMN orders.booking_context_hash IS
  'ADR-0065 §4 — بصمة مدخلات الحجز بلا الفني. إعادة اختيار المنفّذ بتقارنها بتذكرة المعاينة الجديدة.';
COMMENT ON COLUMN booking_match_previews.booking_context_hash IS
  'ADR-0065 §4 — نفس بصمة الطلب بالظبط، عشان التذكرة تثبت إنها لنفس الحجز مش لحجز أرخص.';
