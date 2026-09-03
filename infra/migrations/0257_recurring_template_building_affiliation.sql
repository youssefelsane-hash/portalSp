-- baytak (صُنّاع) — 0257: ارتباط العمارة يستمر مع القالب المتكرر (docs/08 §122، طلب مالك صريح)
--
-- كانت فجوة حقيقية: القالب المتكرر (recurring_order_templates) ما كانش بيخزّن أي ارتباط بعمارة
-- خالص — التعليق في الكيان كان بيقول صراحة "building_code مش بتتخزن عمدًا" ضمن نفس الجملة اللي
-- بتستثني promo_code (خصم لمرة واحدة). المشكلة إن العمارة **مش** خصم لمرة واحدة زي كود الخصم —
-- هي انتماء دائم للعنوان، والعميل المشترك في عمارة متعاقدة المفروض يفضل ياخد خصمها في كل نوبة
-- متولّدة، مش في الطلب الأول بس.
--
-- بنخزّن **معرّف العمارة** مش نسبة الخصم نفسها: كل نوبة بتقرأ الخصم الحالي وقت التوليد (نفس
-- استعلام buildings.findActiveByCodeOrThrow اللي الطلب العادي بيستخدمه) — لو الإدارة غيّرت
-- النسبة من 10% لـ15%، النوبة الجديدة بتاخد 15% تلقائيًا من غير أي كود إضافي هنا.
ALTER TABLE recurring_order_templates
  ADD COLUMN building_id UUID NULL REFERENCES buildings(id);

CREATE INDEX idx_recurring_order_templates_building_id
  ON recurring_order_templates(building_id) WHERE building_id IS NOT NULL;

COMMENT ON COLUMN recurring_order_templates.building_id IS
  'العمارة اللي الطلب الأصلي اتحجز بكودها (لو فيه) — بيتقرا فريش وقت كل توليد نوبة، مش snapshot لنسبة الخصم';
