-- baytak — 0221: مساعد اختياري واحد للشغلانات الفردية (ADR-0052، docs/08 §97).
--
-- صفر تغيير على أي جدول: الأهلية مشتقّة من required_technicians/required_assistants الموجودين
-- أصلاً (عمود جديد كان هيبقى مصدر حقيقة تاني لنفس السؤال لازم يتزامن يدويًا). الإعدادين دول بس.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('crew.optional_assistant_enabled', 'true', 'boolean', 'orders',
   'يسمح لفني الشغلانة الفردية إنه يضم مساعد اختياري. الاختياري عمره ما يتحسب "نقص طاقم" — مفيش تصعيد ولا كارت أحمر.', false),
  ('crew.optional_assistant_max_per_order', '1', 'number', 'orders',
   'أقصى عدد مساعدين اختياريين في الشغلانة الفردية الواحدة (طلب المالك: واحد بس).', false)
ON CONFLICT (key) DO NOTHING;
