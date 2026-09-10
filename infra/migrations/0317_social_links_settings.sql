-- روابط السوشيال ميديا الرسمية للمنصة (docs/08 §136، طلب مالك 2026-09-10).
--
-- **اتعاد ترقيمها من `0313` لـ`0317`**: سيشنين متوازيين خدوا نفس الرقم `0313`
-- (`0313_promo_code_smart_links.sql` كمان)، و`scripts/check-migrations.js` — اللي شغّال في
-- CI — بيرفض ده صراحةً، فالبوابة كانت حمرا على `main`. إعادة الترقيم آمنة هنا تحديدًا لأن
-- كل جملة في الملف **idempotent** (`WHERE NOT EXISTS` + `UPDATE` مشروط): قاعدة طبّقت الملف
-- بالاسم القديم هتطبّقه تاني بالاسم الجديد بلا أي أثر، وقاعدة جديدة هتطبّقه مرة واحدة.
-- `migrate.js` بيتتبّع بالاسم، فالصف القديم بيفضل موجود ومش بيضر.
--
-- **الفجوة اللي المالك لقطها بنفسه**: «بحثت في المشروع عن Facebook وInstagram وما لقيتش
-- Settings/URLs خاصة بيهم». صحيح — مكانش فيه أي مفتاح سوشيال في `settings-registry.ts`،
-- فالفوتر مكانش يقدر يعرض أيقونات أصلاً من غير ما نكتب روابط في الكود (وده يخلّي تغييرها
-- محتاج deploy بدل تعديل من لوحة الأدمن).
--
-- كل القيم بتبدأ **فاضية عمدًا**: الفاضي معناه الأيقونة ما تظهرش خالص. البديل (رابط افتراضي
-- مخترع) كان هيدّي أيقونة بتودّي لصفحة مش بتاعتنا — أسوأ من مفيش أيقونة.
--
-- التعديل من `PATCH /admin/settings/:key` الموجود بالفعل: صلاحية `settings.manage` +
-- تأكيد Passkey حديث + تسجيل في `audit_logs`. صفر كود إضافي.
INSERT INTO settings (key, value, value_type, group_name, description, is_public)
SELECT v.key, v.value::jsonb, v.value_type, v.group_name, v.description, true
FROM (VALUES
  ('social.facebook_url',  '""', 'string', 'social', 'رابط صفحة فيسبوك الرسمية. لازم يبدأ https:// وإلا بيتجاهَل والأيقونة ما تظهرش.'),
  ('social.instagram_url', '""', 'string', 'social', 'رابط حساب إنستجرام الرسمي. نفس شرط https://.'),
  ('social.tiktok_url',    '""', 'string', 'social', 'رابط حساب تيك توك الرسمي. نفس شرط https://.'),
  ('social.linkedin_url',  '""', 'string', 'social', 'رابط صفحة لينكدإن الرسمية. نفس شرط https://.'),
  ('social.youtube_url',   '""', 'string', 'social', 'رابط قناة يوتيوب الرسمية. نفس شرط https://.')
) AS v(key, value, value_type, group_name, description)
WHERE NOT EXISTS (SELECT 1 FROM settings s WHERE s.key = v.key);

-- المفاتيح دي ممكن تكون اتخلقت قبل الـmigration دي من مزامنة السجل وقت الإقلاع (بـ`is_public`
-- الافتراضي = false). القيم دي بتتقدّم فعلاً من `GET /social-links` العام، فالراية لازم توصف
-- الواقع — سطر واحد بيخلّي النتيجة النهائية واحدة سواء اتخلقوا هنا أو قبلها.
UPDATE settings
   SET is_public = true
 WHERE key IN (
   'social.facebook_url',
   'social.instagram_url',
   'social.tiktok_url',
   'social.linkedin_url',
   'social.youtube_url'
 )
   AND is_public = false;
