# ADR-0025: فئة تسعير الفني (Pricing Tier) — منفصلة عن `TechnicianLevel` التشغيلي

**الحالة:** معتمد
**التاريخ:** 2026-08-21

## السياق

طلب المالك (docs/08 §36 الجزء د، §36.24): فئات تسعير الفني (Standard/Expert/Senior/Premium) —
منفصلة عن `TechnicianLevel` التشغيلي.

**تدقيق حي**: `service_level_pricing.technician_level` (مضاعف سعر لكل خدمة) مربوط مباشرة بـ
`TechnicianLevel` (`new`/`verified`/`professional`/`premium`/`team_leader`) — نفس العمود المستخدم
لحد القرار المالي (`decision_limit_cents`)، أولوية المطابقة (`order_priority_weight`)، أهلية قيادة
طلب "اعتماد" (`eligible_for_team_booking`)، وتقدّم مسار الـKPI. يعني **مضاعف السعر اللي بيشوفه
العميل مقفول تمامًا على نفس القرار التشغيلي/الثقة** — المنصة معندهاش طريقة تسعّر شغل فني تجاريًا
مختلف عن تصنيفه التشغيلي (مثلاً: فني تخصصي بيستاهل سعر "Premium" تجاريًا رغم إنه لسه "professional"
تشغيليًا لحد ما يجمع نقاط KPI كفاية للترقية الرسمية، أو العكس).

## القرار

1. **`TechnicianPricingTier` enum جديد بالكامل**: `standard`/`expert`/`senior`/`premium` — أسماء
   مختلفة عمدًا عن `TechnicianLevel` (مفيش تشابه حتى في التسمية يوحي بربط ضمني).
2. **`technician_profiles.pricing_tier` عمود جديد** (افتراضي `standard` لكل الصفوف — **صفر اشتقاق
   تلقائي من `current_level`**: لو اشتقينا خريطة افتراضية `professional→senior` مثلاً، ده قرار
   تسعير تجاري بيتخذ نيابة عن المالك بصمت وقت الـdeploy، عكس فلسفة المشروع بالكامل. كل الفنيين
   `standard` لحد ما أدمن يصنّفهم صراحة).
3. **جدول جديد `service_pricing_tier_pricing`** (مرآة كاملة لـ`service_level_pricing`: service_id،
   `pricing_tier`، `price_multiplier`، `is_active`) — **مش تعديل على الجدول القديم**. `service_level_pricing`
   يفضل موجود ومتاح بلا أي تغيير (توافقية كاملة مع أي خدمة عندها مضاعفات مستوى مضبوطة بالفعل).
4. **ترتيب الأولوية في `CatalogService.estimate()`**: لو الفني عنده `pricing_tier` وفيه صف نشط
   لـ(خدمة، فئة) في الجدول الجديد → هو اللي بيتطبّق. **غير كده، fallback كامل للسلوك القديم**
   (`service_level_pricing` بـ`current_level`، أو مضاعف=1 لو مفيش أي صف). يعني تفعيل الميزة دي
   **اختياري تمامًا لكل خدمة على حدة** — خدمة من غير أي صف تسعير-فئة جديد تفضل بالظبط زي ما كانت.
5. **الأدمن يصنّف الفني صراحة** (`PATCH /admin/technicians/:id/pricing-tier`، نفس نمط `changeLevel()`
   بالحرف) — منفصل تمامًا عن `PATCH .../level` (تغيير واحد ميأثرش على التاني خالص).
6. **`GET /services/:id/estimate`**: `pricing_tier` query param جديد **اختياري، إضافي** جنب
   `technician_level` الموجود (مفيش استبدال) — استهلاك apps/customer-app الحالي بلا أي تغيير مطلوب.

## البدائل اللي اتقيّمت

- **اشتقاق `pricing_tier` تلقائيًا من `current_level` وقت الـmigration** (`professional→senior` مثلاً)
  — رُفض. قرار تسعير تجاري بيتاخد نيابة عن المالك بصمت، عكس كل قرار مشابه في المشروع ده (نفس منطق
  رفض "تحويل صفوف `service_zone_pricing` تلقائيًا لـpercentage" في ADR-0024).
- **إعادة استخدام `service_level_pricing` نفسه بإضافة عمود `pricing_tier` بديل لـ`technician_level`**
  — رُفض. هيكسر أي خدمة عندها صفوف مستوى موجودة فعلاً (الجدول محتاج يبقى عن مفهوم واحد بس)، وهيلخبط
  قراءة الكود مستقبلاً (عمود واحد بيمثّل مفهومين مختلفين حسب السياق). جدول منفصل أوضح وأأمن.
- **ربط `pricing_tier` بحد أدنى/أقصى لـ`current_level`** (مثلاً منع فني `new` من `pricing_tier=premium`)
  — رُفض دلوقتي. طلب المالك صريح إن الاتنين "منفصلين" — فرض قيد تشابك بينهم بيناقض المطلوب مباشرة.
  ممكن يتضاف لاحقًا كإعداد اختياري لو المالك طلبه صراحة، مش قرار افتراضي هنا.

## الأثر

- Migration جديدة: enum + عمود `pricing_tier` (افتراضي `standard`)، جدول `service_pricing_tier_pricing` جديد.
- `CatalogService.estimate()`: باراميتر جديد `technicianPricingTier?`، فرع أولوية جديد قبل fallback
  لـ`service_level_pricing` القديم — **صفر كسر لأي مسار موجود** (الباراميتر الجديد اختياري، كل
  الكولرز الحاليين بيفضلوا يشتغلوا بالظبط زي ما هما).
- `orders.service.ts`/`catalog.controller.ts`'s `listTechniciansForService`: تمرير `technician.pricingTier`
  الجديد جنب `technician.currentLevel` الموجود — بمجرد ما أدمن يضيف صف تسعير-فئة لخدمة، بيتفعّل
  تلقائيًا في كل مسارات التسعير الحقيقية بلا أي كود إضافي.
- `admin-technicians.controller.ts`: endpoint جديد `PATCH :id/pricing-tier`.
- `apps/admin`: قسم "فئة التسعير" في بروفايل الفني + فورم تسعير-فئة جديد في صفحة تفاصيل الخدمة
  (نفس نمط فورم تسعير المستوى الموجود).
- اختبار حي جديد: تفعيل تسعير-فئة لخدمة بيغيّر السعر النهائي حسب فئة الفني، خدمة من غير صفوف فئة
  تفضل بتستخدم تسعير المستوى القديم (رجريشن)، تغيير فئة فني منفصل تمامًا عن تغيير مستواه.
