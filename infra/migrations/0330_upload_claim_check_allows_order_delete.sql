-- تناقض بين قيدين على نفس العمود (تدقيق ماراثوني 2026-09-13، docs/08 §148).
--
-- الجدولين `order_problem_image_uploads` (0237) و`pricing_field_uploads` (0235) كل واحد فيهم:
--
--   claimed_order_id uuid REFERENCES orders(id) ON DELETE SET NULL
--   CHECK ((claimed_order_id IS NULL AND claimed_at IS NULL)
--       OR (claimed_order_id IS NOT NULL AND claimed_at IS NOT NULL))
--
-- الاتنين مايتحققوش مع بعض: لما طلب يتحذف فعليًا، الـFK بيصفّر `claimed_order_id` **وبس** —
-- `claimed_at` بيفضل مليان — فالـCHECK بيرفض، والحذف كله بيفشل بـ
-- `order_problem_image_uploads_claim_pair_check`. يعني `ON DELETE SET NULL` معلن ومستحيل ينفّذ.
--
-- اتلقط حيًا: `onsite-conversion-visibility-audit` وقع على الخطأ ده وهو بينضّف وراه.
-- الأثر في الإنتاج محدود (الطلبات بتتحذف soft عادةً) لكنه حقيقي: أي مسار حذف فعلي لطلب
-- (تنظيف بيانات، حذف حساب، purge إداري) بيتقفل على قيد مستحيل إرضاؤه.
--
-- القرار: نسيب **الاتجاه اللي له معنى** ونشيل المستحيل. «مطالبة بلا وقت» غلط حقيقي لازم يفضل
-- ممنوع. أما «وقت مطالبة بلا طلب» فده الحالة الشرعية بعد حذف الطلب — الصورة اتطالب بيها فعلاً
-- في وقت معروف، والطلب اللي طالبها مابقاش موجود.
--
-- مسار إعادة المطالبة مايتأثرش: `order-creation.service.ts` بيقرا `claimed_order_id` وحده
-- (وبيكتب العمودين مع بعض بـCOALESCE)، فالصف اليتيم بيبان «مش متطالب» ويخضع لنفس فحص الصلاحية.

ALTER TABLE order_problem_image_uploads
  DROP CONSTRAINT IF EXISTS order_problem_image_uploads_claim_pair_check;

ALTER TABLE order_problem_image_uploads
  ADD CONSTRAINT order_problem_image_uploads_claim_pair_check
  CHECK (claimed_order_id IS NULL OR claimed_at IS NOT NULL);

ALTER TABLE pricing_field_uploads
  DROP CONSTRAINT IF EXISTS pricing_field_uploads_claim_pair_check;

ALTER TABLE pricing_field_uploads
  ADD CONSTRAINT pricing_field_uploads_claim_pair_check
  CHECK (claimed_order_id IS NULL OR claimed_at IS NOT NULL);
