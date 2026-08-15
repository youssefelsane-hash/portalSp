-- baytak — 0106: بيانات تواصل خدمة العملاء مُدارة من الأدمن (docs/08 §22 بند 15-19)
-- كانت فجوة موثّقة صراحة: صفر مكان لتليفون/واتساب الشركة، والتطبيقات مفيهاش أي زرار اتصال بالدعم.
-- إعادة استخدام محرك الإعدادات الموجود بالكامل (نفس نمط loyalty/commission settings) — صفر جدول جديد.
-- القيم فاضية افتراضيًا (المالك يملأها بعد كده من /admin/settings)، support.enabled=false لحد ما
-- تتملى — عشان التطبيقات ما تعرضش زرار اتصال بلا رقم حقيقي وراه.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('support.enabled', 'false', 'boolean', 'support', 'إظهار قسم "تواصل معنا" في التطبيقات — false لحد ما الأرقام تتملى', true),
  ('support.phone_number', '""', 'string', 'support', 'رقم تليفون خدمة العملاء (بصيغة دولية، مثال: +201001234567)', true),
  ('support.whatsapp_number', '""', 'string', 'support', 'رقم واتساب خدمة العملاء (أرقام بس، بصيغة دولية بلا +، مثال: 201001234567)', true),
  ('support.email', '""', 'string', 'support', 'إيميل الدعم (اختياري)', true),
  ('support.help_url', '""', 'string', 'support', 'رابط صفحة مساعدة/موقع (اختياري، لازم يبدأ https://)', true);
