-- أسباب افتراضية منطقية لإلغاء الفني. الإدارة تقدر تعدّلها أو توقفها من الشاشة الموجودة.
-- الإدخال idempotent بالاسم + النوع حتى لا نكرر صفًا أنشأه الأدمن مسبقًا.
INSERT INTO cancellation_reasons
  (reason_ar, reason_en, applies_to, affects_technician_score, display_order, requires_free_text)
SELECT v.reason_ar, v.reason_en, 'technician'::cancellation_applies_to, true, v.display_order, v.requires_free_text
FROM (VALUES
  ('ظرف صحي أو طارئ شخصي', 'Health or personal emergency', 10::smallint, false),
  ('عطل في وسيلة النقل أو تعذر الوصول', 'Transport issue or unable to reach the customer', 20::smallint, false),
  ('العمل خارج تخصصي أو لا يمكن تنفيذه بأمان', 'Work is outside my trade or cannot be performed safely', 30::smallint, false),
  ('تعارض طارئ في الموعد', 'Unexpected schedule conflict', 40::smallint, false),
  ('سبب آخر', 'Other reason', 90::smallint, true)
) AS v(reason_ar, reason_en, display_order, requires_free_text)
WHERE NOT EXISTS (
  SELECT 1 FROM cancellation_reasons cr
  WHERE cr.applies_to = 'technician' AND cr.reason_ar = v.reason_ar
);
