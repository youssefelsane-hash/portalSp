-- **رمز الدخول (PIN) بدل الـOTP** (ADR-0109، قرار مالك 2026-09-24).
--
-- الأعمدة دي بتحمل الـcredential الجديد وحالة الحماية بتاعته. كلها `NULL`/صفر للحسابات
-- الموجودة — مفيش حساب بيتكسر بالمايجريشن دي، والمستخدم بيحط الـPIN وهو **متوثّق بالفعل**
-- (`POST /auth/pin`) زي ما ADR-0109 §6-أ بيقول.
--
-- ### ليه أعمدة جديدة والـ`password_hash` موجود أصلاً؟
--
-- `users.password_hash` عمود ميت (مفيش سطر بيكتب فيه؛ `anonymizeAccount()` بيعمله NULL وبس).
-- إعادة استخدامه كانت هتخلي عمود اسمه «باسورد» شايل حاجة مالهاش نفس السياسة خالص: الـPIN
-- ٤–٦ أرقام، وله قفل ومحاولات، ومالوش دورة تغيير إجبارية. الاسم الغلط على عمود بيحمل
-- credential هو بالظبط نوع اللبس اللي بيولّد بَقّة أمنية بعد سنة. سايبينه زي ما هو.
--
-- ### `phone_verified_at` مابيتغيّرش هنا
--
-- ADR-0109 §4: التسجيل بالـPIN **مابيثبتش** ملكية الرقم، فالعمود بيفضل NULL للحسابات الجديدة
-- بدل ما يتحط تلقائيًا (وده اللي كان بيحصل مع الـOTP). الحسابات القديمة اللي اتوثّقت بـOTP
-- بتفضل موثّقة — مفيش backfill ولا مسح هنا عمدًا.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pin_hash varchar(255),
  -- وقت آخر تعيين/تغيير. بيفرّق بين «مالوش PIN» و«ليه PIN» من غير ما نقرا الهاش نفسه.
  ADD COLUMN IF NOT EXISTS pin_set_at timestamptz,
  -- محاولات غلط متتالية. بيترجع صفر مع أول دخول ناجح — نفس منطق `otp_codes.attempts_count`.
  ADD COLUMN IF NOT EXISTS pin_failed_attempts smallint NOT NULL DEFAULT 0,
  -- مقفول لحد إمتى بعد استهلاك المحاولات. NULL = مش مقفول.
  ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- الدخول بيدوّر بالرقم على حساب حي. الفهرس ده بيخدم `POST /auth/pin/login` — أهم استعلام في
-- المسار الجديد وبيتنادى على كل دخول.
CREATE INDEX IF NOT EXISTS idx_users_phone_active
  ON users (phone_number)
  WHERE deleted_at IS NULL;

-- **ثابت**: مستحيل يبقى فيه قفل أو محاولات على حساب مالوش PIN أصلاً — ده كان هيبقى حالة
-- مستحيلة بتقفل حساب على credential مش موجود.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS chk_users_pin_state;
ALTER TABLE users
  ADD CONSTRAINT chk_users_pin_state
  CHECK (
    pin_hash IS NOT NULL
    OR (pin_failed_attempts = 0 AND pin_locked_until IS NULL AND pin_set_at IS NULL)
  );

COMMENT ON COLUMN users.pin_hash IS
  'رمز الدخول (bcrypt) — ADR-0109. NULL = الحساب لسه مالوش PIN (مستخدم قديم قبل التبديل).';
COMMENT ON COLUMN users.pin_locked_until IS
  'قفل مؤقت بعد محاولات غلط متتالية. NULL = مش مقفول. بيترجع NULL مع أول دخول ناجح.';

-- **مفتاح وسيلة الدخول** (ADR-0109 §7) — صف حقيقي في القاعدة عشان الأدمن يقدر يضبطه من
-- الشاشة، مش قيمة افتراضية في الكود بس. `pin` = الوضع الجديد و`otp/request` بيترفض فورًا
-- فمفيش أي مسار بيوصل لمزوّد الـSMS ⇒ صفر تكلفة. تغييره لـ`otp` بيرجّع السلوك القديم
-- **بلا نشر نسخة جديدة** — وده مقصود لأن ده أخطر تغيير ممكن يتعمل: تغيير الدخول.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('auth.login_method', '"pin"', 'string', 'security',
   'وسيلة الدخول: pin (رمز دخول — الافتراضي، صفر تكلفة SMS) أو otp (كود رسايل — بيرجّع تكلفة المزوّد).',
   false)
ON CONFLICT (key) DO NOTHING;
