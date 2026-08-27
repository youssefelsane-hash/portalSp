-- baytak — 0205: الرقم القومي كهوية دائمة للفني (ADR-0045، docs/08 §74-ب)
--
-- طلب المالك (2026-08-27): «الفنيين لازم يضاف لكل واحد خانة بتاخد الرقم القومي، لأن ده الحاجة
-- اليونيك… لو فني حصل منه مشكلة ما يروحش جاي رايح مسجل برقم تليفون تاني… والرقم القومي ده ما
-- ينفعش يبقى متكرر عند اتنين فنيين إلا مثلاً لو الفني الأكونت بتاعه الأولاني اتمسح».
--
-- الوضع قبل ده: `national_id_encrypted` موجود من migration 0005 (وبقى nullable في 0018) لكنه
-- **ما بيتكتبش ولا بيتقرا من أي مكان في الكود** — خانة موجودة ووظيفة مش موجودة. الهوية الوحيدة
-- الفعّالة كانت رقم التليفون، وهي قابلة للتبديل بالكامل (شريحة جديدة = شخص جديد في نظر المنصة).

-- الفهرس الأعمى (blind index): HMAC-SHA256 حتمي للرقم بعد التطبيع. **ليه مش نستخدم
-- national_id_encrypted نفسه؟** لأنه AES-GCM بـIV عشوائي — نفس الرقم بيدّي ciphertext مختلف كل
-- مرة، فمستحيل تعمل عليه UNIQUE ولا تقارن بيه. والهاش one-way فتسريب الجدول مايديش الأرقام.
ALTER TABLE technician_profiles
  ADD COLUMN IF NOT EXISTS national_id_hash CHAR(64);

COMMENT ON COLUMN technician_profiles.national_id_hash IS
  'HMAC-SHA256 (hex) للرقم القومي بعد التطبيع — الفهرس الأعمى للتفرّد. القيمة نفسها في national_id_encrypted.';

-- مين كتب الرقم وإمتى — الأدمن محتاج يعرف لو الرقم جه من الفني نفسه ولا من مراجع بشري قرا
-- البطاقة، خصوصًا لو حصل نزاع.
ALTER TABLE technician_profiles
  ADD COLUMN IF NOT EXISTS national_id_set_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS national_id_set_by_user_id UUID REFERENCES users(id);

COMMENT ON COLUMN technician_profiles.national_id_set_by_user_id IS
  'مين سجّل الرقم: الفني نفسه (user_id بتاعه) أو الأدمن المراجع. NULL = بيانات قديمة.';

-- التفرّد **مشروط بحالة الحساب** (ADR-0045 §2): فهرس جزئي على الحسابات غير المحذوفة بس.
--   • فني نشط/معلّق/**محظور** ⇒ رقمه محجوز، محدش يسجّل بيه تاني. ده جوهر الطلب: الحظر يفضل
--     نافذ رغم تغيير التليفون، لأن الحساب المحظور ما بيتحذفش.
--   • فني حسابه اتشال فعلًا (deleted_at IS NOT NULL) ⇒ الرقم يتحرّر، لأن ده قرار إداري صريح.
-- UNIQUE مطلق كان هيمنع حتى إعادة التسجيل المسموح بيها إداريًا، وهيخلي الحذف مستحيل عمليًا.
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_national_id_active
  ON technician_profiles (national_id_hash)
  WHERE national_id_hash IS NOT NULL AND deleted_at IS NULL;

-- فهرس للبحث التشخيصي (الأدمن بيدوّر برقم قومي عبر كل الحسابات بما فيها المحذوفة، عشان يجاوب
-- "الشخص ده كان عندنا قبل كده؟"). الفهرس فوق جزئي فما بيخدمش السؤال ده.
CREATE INDEX IF NOT EXISTS idx_technician_national_id_hash_all
  ON technician_profiles (national_id_hash)
  WHERE national_id_hash IS NOT NULL;

-- الاعتماد ممنوع بلا رقم قومي — إعداد مش hardcode، عشان حالة استثنائية تتاخد بقرار واعٍ مسجّل
-- مش بتعديل كود.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('technicians.require_national_id_for_approval', 'true', 'boolean', 'technicians',
   'لازم يكون للفني رقم قومي مسجّل قبل ما الأدمن يقدر يعتمده (approved). إقفالها بيسمح باعتماد فني بلا هوية دائمة — استخدمها لحالات استثنائية بس.',
   false)
ON CONFLICT (key) DO NOTHING;
