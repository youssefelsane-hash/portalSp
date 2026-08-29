-- baytak — 0223: بيانات الجهة المشغّلة الرسمية كإعدادات قابلة للتحرير (docs/08 §100).
--
-- قرار المالك النهائي (2026-08-29): اسم المنصة «أسطى — OSTA»، والجهة المشغّلة «الصانع جروب —
-- ELSANE Group». باقي البيانات (العنوان، الإيميلات، التليفون، السجل التجاري، البطاقة الضريبية)
-- لسه مش جاهزة وهتتجهز قبل الرفع على Google Play.
--
-- **ليه إعدادات مش ثوابت في الكود؟** لأن البيانات دي بتتغيّر بقرار إداري مش بنشر كود، ولأن
-- Google Play بيطلبها ظاهرة في صفحة السياسة نفسها. الإعدادات بتديها المسار الكامل مجانًا:
-- تحرير من /admin/settings/:key بصلاحية settings.manage + step-up MFA + audit log — صفر بنية
-- تحتية جديدة. القيم الفاضية **مقصودة**: الواجهة بتخفي أي سطر قيمته فاضية بدل ما تعرض سطر أعرج.

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('legal.platform_name_ar', '"أسطى"', 'string', 'legal_entity',
   'اسم المنصة بالعربي كما يظهر في كل الواجهات والمستندات القانونية.', true),
  ('legal.platform_name_en', '"OSTA"', 'string', 'legal_entity',
   'اسم المنصة بالإنجليزي.', true),
  ('legal.company_name_ar', '"الصانع جروب"', 'string', 'legal_entity',
   'الاسم القانوني للجهة المشغّلة بالعربي.', true),
  ('legal.company_name_en', '"ELSANE Group"', 'string', 'legal_entity',
   'الاسم القانوني للجهة المشغّلة بالإنجليزي — بيظهر جنب علامة حقوق النشر ©.', true),
  ('legal.legal_address', '""', 'string', 'legal_entity',
   'العنوان القانوني المسجَّل للشركة. مطلوب من Google Play قبل النشر.', true),
  ('legal.support_email', '""', 'string', 'legal_entity',
   'بريد الدعم الرسمي. مطلوب من Google Play في صفحة السياسة وفي Store Listing.', true),
  ('legal.privacy_email', '""', 'string', 'legal_entity',
   'بريد طلبات الخصوصية وحقوق أصحاب البيانات (قانون 151 لسنة 2020). لو فاضي بيتعرض بريد الدعم بدله.', true),
  ('legal.support_phone', '""', 'string', 'legal_entity',
   'رقم التواصل الرسمي المعلن.', true),
  ('legal.website_url', '""', 'string', 'legal_entity',
   'الموقع الرسمي للمنصة. لازم يبدأ https:// وإلا بيتجاهَل.', true),
  ('legal.commercial_register', '""', 'string', 'legal_entity',
   'رقم السجل التجاري.', true),
  ('legal.tax_id', '""', 'string', 'legal_entity',
   'الرقم الضريبي.', true)
ON CONFLICT (key) DO NOTHING;
