-- ADR-0037 / docs/08 §60.1 — أساس العمولة (commissionable base).
--
-- قبل كده كانت عمولة المنصة بتتحسب على `orders.total_amount_cents` بالكامل، و`total_amount_cents`
-- مجموع مكوّنات مختلفة الطبيعة تمامًا: سعر الشغل + مضاعف المنطقة + رسوم الطوارئ + رسوم المعاينة
-- + إضافات + سعر الضمان الاختياري. يعني الفني كان بياخد 85% من سعر الضمان (بنسبة عمولة 15%) —
-- والضمان منتج مالي بتتحمّل الشركة وحدها مخاطره. بلاغ مالك صريح.
--
-- العمود ده هو الوعاء اللي نسبة العمولة بتتطبّق عليه. NULL = طلب قديم اتعمل قبل الـmigration دي؛
-- الكود بيرجع للسلوك القديم (الوعاء = الإجمالي) للصفوف دي عمدًا، عشان إعادة تسوية طلب قديم
-- ما تديش نتيجة مختلفة عن تسويته الأصلية.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commissionable_base_cents integer;

COMMENT ON COLUMN orders.commissionable_base_cents IS
  'ADR-0037: الوعاء اللي عمولة المنصة بتتحسب عليه (سعر الشغل + ما تسمح به سياسة commission_base.*). NULL = طلب قبل الـADR، بيرجع للإجمالي.';

-- سياسة الوعاء بمكوّن بمكوّن — في محرك الإعدادات الموجود، مش جدول جديد ولا قيم ثابتة في الكود.
-- القيم دي بتنفّذ طلب المالك بالحرف: الضمان وفوائد التقسيط ومضاعف المنطقة/التضخم ورسوم الطوارئ
-- كلها 100% للشركة؛ سعر الشغل ومضاعف مستوى الفني ورسوم المعاينة والإضافات والبنود الإضافية
-- أثناء الشغل كلها داخل الوعاء (الفني بياخد نصيبه منها).
INSERT INTO settings (key, value, value_type, group_name, description, is_public) VALUES
  ('commission_base.include_level_premium', 'true', 'boolean', 'pricing',
   'مضاعف مستوى الفني داخل وعاء العمولة — ليفل أعلى يعني فلوس أكتر للفني نفسه (طلب مالك صريح).', false),
  ('commission_base.include_zone_surge', 'false', 'boolean', 'pricing',
   'مضاعف المنطقة/التضخم: false = الزيادة دي 100% للشركة، الفني مالوش نصيب فيها.', false),
  ('commission_base.include_emergency_surcharge', 'false', 'boolean', 'pricing',
   'رسوم الطوارئ الإضافية: false = 100% للشركة.', false),
  ('commission_base.include_inspection_fee', 'true', 'boolean', 'pricing',
   'رسوم المعاينة داخل الوعاء — الفني هو اللي بينزل المعاينة فعلاً.', false),
  ('commission_base.include_addons', 'true', 'boolean', 'pricing',
   'إضافات الكتالوج المختارة وقت الحجز داخل الوعاء — شغل إضافي حقيقي بينفّذه الفني.', false),
  ('commission_base.include_additional_items', 'true', 'boolean', 'pricing',
   'البنود الإضافية المعتمدة أثناء الشغل داخل الوعاء (طلب مالك صريح: "ده برضه بيعتبر ضمن الشغل").', false),
  ('commission_base.include_warranty', 'false', 'boolean', 'pricing',
   'سعر الضمان الاختياري: false = 100% للشركة (طلب مالك صريح — ده كان أصل البلاغ).', false),
  ('commission_base.include_installment_interest', 'false', 'boolean', 'pricing',
   'فوائد/رسوم التقسيط: false = 100% للشركة (طلب مالك صريح).', false),
  ('commission_base.discount_reduces_technician_share', 'false', 'boolean', 'pricing',
   'false = الخصم (كوبون/عمارة) بيتحمّله نصيب الشركة وحدها، والفني بياخد على سعر الشغل الكامل قبل الخصم.', false)
ON CONFLICT (key) DO NOTHING;
