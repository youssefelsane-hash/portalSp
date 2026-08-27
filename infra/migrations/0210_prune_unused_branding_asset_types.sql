-- baytak — 0210: تقليم أنواع أصول البراندنج اللي مالهاش أي مستهلك (docs/08 §78-ج).
--
-- **بلاغ مالك صريح (2026-08-27)**: «في الحتة بتاعت البراندنج فيها حاجات كتير، مش عارف هل
-- الحاجات دي كلها أصلًا موجودة في السيستم ولا لأ، ولكن لو حاجة أصلًا مالهاش وجود فشيلها».
--
-- التتبّع الفعلي لكل نوع (grep على كل التطبيقات، مش تخمين):
--   primary_logo → مستهلك: `apps/customer-app` (شعار الرأس في الشاشة الرئيسية) + شاشة الدخول.
--   splash       → مستهلك: خلفية الـhero في `apps/customer-app` و`apps/customer-web`.
--   logo_mark    → صفر مستهلك.
--   logo_light   → صفر مستهلك.
--   logo_dark    → صفر مستهلك.
--   login_logo   → صفر مستهلك (شاشة الدخول بقت بتستخدم primary_logo — لوجو واحد لكل حتة،
--                  بدل خانة تانية لازم الأدمن يفتكر يزامنها مع الأولى بإيده).
--
-- الأربعة دول كانوا خانات رفع شغّالة في لوحة الأدمن بترفع ملف لتخزين حقيقي وما يظهرش في أي
-- مكان أبدًا. ده أسوأ من نقص ميزة: بيدّي المشغّل انطباع إنه ظبط حاجة وهو ما ظبطش.
--
-- **ليه إعادة إنشاء الـtype بالكامل؟** PostgreSQL مافيهوش `ALTER TYPE ... DROP VALUE` خالص
-- (لأي إصدار)، فالطريقة الوحيدة هي نوع جديد + تحويل العمود + إسقاط القديم.

BEGIN;

-- الصفوف دي (لو موجودة) بتشاور على ملفات في التخزين — الملفات نفسها بتفضل مكانها عمدًا،
-- نفس سياسة الاستبدال في ADR-0014 (كل رفع بيتخزّن تحت key جديد، والتنضيف لاحق ويدوي).
-- مسحها هنا بيشيل المؤشر بس، ومفيش أي حاجة تانية بتشاور عليه (مفيش FK على الجدول ده).
DELETE FROM branding_assets
 WHERE asset_type IN ('logo_mark', 'logo_light', 'logo_dark', 'login_logo');

CREATE TYPE branding_asset_type_v2 AS ENUM ('primary_logo', 'splash');

ALTER TABLE branding_assets
  ALTER COLUMN asset_type TYPE branding_asset_type_v2
  USING asset_type::text::branding_asset_type_v2;

DROP TYPE branding_asset_type;
ALTER TYPE branding_asset_type_v2 RENAME TO branding_asset_type;

COMMIT;
