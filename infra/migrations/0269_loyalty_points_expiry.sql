-- تدقيق L-6 — نقاط الولاء ماكانتش بتنتهي أبدًا.
--
-- `loyalty_transactions.expires_at` و`loyalty_direction = 'expire'` موجودين في المخطّط من أول يوم
-- (docs/02 §10.3)، بس مفيش أي كود بيكتب فيهم: كل نداءات `LoyaltyService.earn()` بتمرّر
-- `expiresAt = null`، ومفيش أي sweep بيحوّل نقطة لـ`expire`. النتيجة إن الرصيد بيتراكم للأبد
-- والتزام مالي على الشركة بيكبر بلا سقف، والعميل شايف رصيد قديم شغّال وهو المفروض انتهى.
--
-- الإصلاح محتاج حاجتين في المخطّط:
--
--   1. `expired_at` على الصف: علامة إن الدفعة (lot) دي **اتفحصت** بالفعل من الـsweep. من غيرها
--      مفيش طريقة نفرّق بين دفعة لسه ماوصلتش دورها ودفعة انتهت واتحسبت — والفرق ده هو اللي
--      بيمنع الحساب المزدوج. بتتحط حتى لو الدفعة كانت مستهلكة بالكامل (صفر نقطة تنتهي)، عشان
--      الـsweep مايفضلش يعيد فحص نفس الصفوف كل يوم للأبد.
--
--   2. فهرس جزئي على الدفعات المستحقّة بس. الجدول ده بيكبر بمعدّل «صف لكل طلب مكتمل»، والـsweep
--      بيمشي عليه يوميًا — من غير الفهرس ده هيبقى seq scan على كل تاريخ الولاء كل مرة.

ALTER TABLE loyalty_transactions ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

COMMENT ON COLUMN loyalty_transactions.expired_at IS
  'لحظة ما الـsweep فحص الدفعة دي (earn) وحسم اللي فضل فيها. NULL = لسه محتاجة فحص.';

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_due_expiry
  ON loyalty_transactions (expires_at)
  WHERE direction = 'earn' AND expires_at IS NOT NULL AND expired_at IS NULL;

-- الـsweep بيقرا كل دفعات المستخدم بترتيب FIFO عشان يحسب المستهلك — الفهرس ده بيخلّيها قراية
-- مرتّبة جاهزة بدل sort على كل صفوف المستخدم.
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_user_created
  ON loyalty_transactions (user_id, created_at, id);

-- مدة الصلاحية إعداد إداري مش رقم مدفون في الكود: سياسة تجارية بتتغيّر (وبتختلف بين حملة وحملة).
-- `0` = النقاط ماتنتهيش خالص — مخرج صريح للمشغّل بدل ما يضطر يوقّف الـsweep من الكود.
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('loyalty.points_expiry_months', '12', 'number', 'loyalty',
   'بعد كام شهر تنتهي نقاط الولاء المكتسبة (0 = ماتنتهيش أبدًا). التغيير بيسري على النقاط الجديدة بس — النقاط القديمة بتحتفظ بتاريخ انتهائها المتسجّل وقت اكتسابها.', false)
ON CONFLICT (key) DO NOTHING;
