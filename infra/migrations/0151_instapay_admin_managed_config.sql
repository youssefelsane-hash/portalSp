-- baytak — 0151: بيانات InstaPay (عنوان IPA + اسم المستلم) بقت تتعدّل من لوحة تحكم الأدمن
-- (/settings)، مش env vars — طلب مالك صريح 2026-08-20 (docs/08 §33): "عادي بيانات InstaPay
-- ممكن تتغير... بس ما يحقش لحد يغيّرها غير السوبر أدمين". القيمتين دول نص تعليمات بيتعرض للعميل
-- بس (مش سر/مفتاح API)، فمناسبين تمامًا لمخزن settings الديناميكي بدل .env — أي super_admin
-- يقدر يعدّلهم لحظيًا من /admin/settings من غير إعادة نشر أو restart للسيرفر (settings.manage
-- صلاحية super_admin بس فعليًا — migration 0023).

INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('payments.instapay.ipa_address', '""', 'string', 'payments', 'عنوان IPA أو رقم موبايل InstaPay المسجّل — بيتعرض للعميل كتعليمات تحويل. فاضي = InstaPay معطّلة (isConfigured=false)', false),
  ('payments.instapay.recipient_name', '""', 'string', 'payments', 'الاسم اللي بيتعرض للعميل مع عنوان IPA فوق (يتطمّن إنه بيحوّل للجهة الصح). فاضي = InstaPay معطّلة', false)
ON CONFLICT (key) DO NOTHING;
