-- baytak — 0198: نصوص واجهة الـhero مُدارة من الأدمن (docs/08 §64.د، طلب مالك صريح 2026-08-26)
--
-- طلب المالك: «الكلام اللي تحت… عايز الأدمين ليه أكسس على الكلام ده». النصوص دي كانت مكتوبة
-- **ثابتة في كود التطبيقين** (customer-app Dart وcustomer-web TSX) — أي تعديل صياغة كان يحتاج
-- إعادة نشر التطبيقين. نفس نمط homepage.trust_message (0174) وhomepage.tips (0175) بالحرف:
-- إعدادات عادية بـ is_public=true، صفر جدول جديد وصفر endpoint جديد.
--
-- القيم الافتراضية هنا = النص القديم **بالحرف**، فمفيش أي تغيير شكلي للمستخدم بعد الـmigration.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('homepage.hero_eyebrow', '"أساعدك إزاي؟"', 'string', 'homepage',
   'السطر الصغير فوق عنوان البحث في الشاشة الرئيسية', true),
  ('homepage.hero_title', '"محتاج مساعدة في إيه؟"', 'string', 'homepage',
   'العنوان الرئيسي فوق شريط البحث في الشاشة الرئيسية', true),
  ('homepage.hero_subtitle', '"قول لينا مشكلتك بكلامك العادي، أو تصفّح الفئات تحت"', 'string', 'homepage',
   'السطر التوضيحي تحت العنوان في الشاشة الرئيسية', true),
  ('homepage.search_placeholder', '"وصّف مشكلتك... زي \"المياه بتنزل من تحت الحوض\""', 'string', 'homepage',
   'النص الرمادي جوّه شريط البحث في الشاشة الرئيسية', true)
ON CONFLICT (key) DO NOTHING;
