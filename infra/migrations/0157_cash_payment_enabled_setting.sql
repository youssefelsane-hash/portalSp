-- إعداد "تفعيل الدفع كاش" (docs/08، بَقّة تسليم كاش على طلب pending_payment بلا فني —
-- طلب صريح من صاحب المشروع 2026-08-21). الكاش هو وسيلة الدفع الأساسية الفعلية حاليًا
-- (Paymob/Fawry معطّلين افتراضيًا)، فـ true افتراضيًا — عكس fawry_enabled بالضبط — عشان
-- ترقية الداتابيز الحالية ما تكسرش الدفع الكاش الشغال فعليًا لحد ما الأدمن يقرر يعطّله صراحة.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.cash_enabled', 'true', 'boolean', 'payments', 'تفعيل الدفع كاش (تسليم مباشر للفني) — لو اتعطّل، العميل ميقدرش يأكّد تسليم كاش ولا يختاره كوسيلة دفع جديدة', false)
ON CONFLICT (key) DO NOTHING;
