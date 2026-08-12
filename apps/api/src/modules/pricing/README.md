# modules/pricing

حساب السعر والعمولة والخصم. يستخدم `service_zone_pricing` و`service_level_pricing` (قاموس §5.3-5.4) للتسعير الثابت العادي (موجود في `catalog` module نفسه). **تحديث 2026-08-11**: الموديول ده بقى فيه كمان محرك التسعير الديناميكي (Pricing Engine) — راجع `docs/08-pricing-engine-and-platform-vision.md` §1 و`docs/adr/0001-dynamic-pricing-engine.md` قبل أي تعديل.

## محرك التسعير الديناميكي (Pricing Engine) — ✅ Phase 1 backend خلص

**المشكلة**: خدمات زي المحارة/السباكة/الكهرباء سعرها بيتوقف على متغيرات كتير (مساحة، سمك، دور، نوع التنفيذ...) ومختلفة جذريًا من صنعة لصنعة — `services.base_price_cents` الثابت مش كافي. المالك طلب صراحة إن الأدمن يقدر "يبني" حرفة جديدة بحقول ومعادلة مخصصة من غير أي تعديل كود أو deploy.

### القرار الأمني الجوهري (ADR-0001)

المعادلة **مش نص حر يتفسّر كجافاسكريبت/SQL** (`eval()`/`new Function()` ممنوعين تمامًا — ثغرة remote code execution مباشرة). المعادلة شجرة عمليات JSON محدودة سلفًا (`FormulaNode` في `pricing-formula.types.ts`)، و`formula-evaluator.ts` بيفهم بس قايمة عمليات معروفة (whitelist صريح، مش تفسير ديناميكي). أي عملية برّه القايمة دي **ترفض وقت الحفظ من الأدمن** (`validateFormulaNode()`)، قبل ما توصل تتخزن في الداتابيز خالص — اتأكد حياً (`curl` مباشر بمحاولة عقدة `{"type":"eval","code":"..."}`) إنها بترفض بوضوح بـ`VAL_001` من غير ما تلمس الصف الأصلي الصحيح.

### نموذج البيانات (migration `0057_pricing_engine.sql`)

- `services.pricing_model` — قيمة جديدة `formula` (فوق `fixed`/`hourly`/`per_unit`/`inspection_then_quote` الموجودين، مش استبدال).
- `service_pricing_fields` — حقول الفورم الديناميكي لكل خدمة (`field_key`, `label_ar`, `field_type` enum من 14 نوع، `is_required`, `options` JSONB لـ dropdown/multi_select، `min_value`/`max_value`).
- `service_pricing_rules` — ثوابت (`constant`)، جداول بحث (`lookup_table`)، والمعادلة النهائية (`formula` بـ`rule_key='final_price'`). **نفس فلسفة `service_zone_pricing` بالحرف**: `valid_from`/`valid_until` — تعديل فوري يحدّث الصف الحالي في مكانه، تعديل مستقبلي يقفل الصف الحالي ويفتح صف جديد.
- `service_pricing_evaluations` — سجل كل عملية حساب فعلية للتدقيق، مش للعرض المباشر. فشل الكتابة هنا **معطّل بأمان** (try/catch صامت) — مبيأثرش على رجوع السعر الحقيقي للعميل، نفس فلسفة `AuditLogService.record()`.

### الـ Evaluator (`formula-evaluator.ts`)

عمليات مسموحة: `literal`, `field_ref`, `constant_ref`, `lookup_ref`, `add`, `subtract`, `multiply`, `divide` (برفض واضح لقسمة على صفر)، `percentage`, `min`, `max`, `round`, `if`/`else` بمقارنات (`equals`, `not_equals`, `gt`, `gte`, `lt`, `lte`). أقصى عمق للشجرة 12 مستوى (دفاع ضد أشجار متداخلة بشكل مرضي/DoS، مش قيد عمل). `equals`/`not_equals` بيقارنوا رقميًا لو الطرفين قابلين للتحويل لرقم صالح (حقول `dropdown` قيمتها دايمًا نص حتى لو شكلها رقمي زي "3" سم — قارن نصي صارم كان هيفشل مطابقة "3" مع الرقم 3 غلط) وإلا بيرجعوا لمقارنة نصية عادية. **42 اختبار Jest** في `formula-evaluator.spec.ts` بيغطوا العمليات كلها + محاولات حقن/رفض + مثال متكامل مطابق تمامًا لمثال المحارة الخارجية في `docs/08` §1.8.

### العلاقة بـ `service_standard_data` (موجود من قبل، Part C)

المحرك ده **يعمم** فكرة `service_standard_data` (يومية صنايعي/مساعد + إنتاجية ثابتة)، مش بيلغيها — الجدولين لسه موجودين الاتنين، `catalog.service.ts`'s `estimateDuration()` القديمة فاضلة شغالة زي ما هي للخدمات اللي مبنية على `service_standard_data`. معادلة `service_pricing_rules` تقدر (مستقبلاً، لو احتجنا) ترجع لأرقام `service_standard_data` كمصدر بيانات بدل ما تكررها — مفيش ربط تلقائي دلوقتي، القرار ده مؤجل عمدًا.

### الـ endpoints

**عامة (`PricingController`, `@Public()`)**:
- `GET /services/:id/pricing-fields` — الحقول النشطة بس (`is_active=true`)، عشان `apps/customer-app` يرسم الفورم الديناميكي.
- `POST /services/:id/evaluate-price` — `{field_values: {...}}` → السعر + (اختياري) المدة/الطاقم المطلوب/هل محتاج مساعد/هل يصلح لطوارئ. بيرفض بوضوح (`VAL_001`) لو حقل مطلوب ناقص أو قيمة برّه الحدود المسموحة أو خارج خيارات `dropdown`.

**إدارية (`AdminPricingController`, صلاحية `catalog.manage` الموجودة أصلاً — مفيش صلاحية جديدة، حقول/قواعد التسعير جزء من إدارة الكتالوج)**:
- `GET/POST /admin/services/:id/pricing-fields`, `PATCH/DELETE /admin/services/pricing-fields/:fieldId`
- `GET /admin/services/:id/pricing-rules`, `PUT /admin/services/:id/pricing-rules` (upsert بتاريخ سريان)، `DELETE /admin/services/pricing-rules/:ruleId` (تعطيل، مش حذف فعلي)

### الربط بمسار إنشاء الطلب (`POST /orders`) — كانت فجوة موثّقة صراحة، اتقفلت (2026-08-12)

**البَقّة الحقيقية اللي اتلقطت**: `CatalogService.estimate()` (في `catalog` module) — نقطة التسعير الوحيدة اللي `orders.service.ts`'s `create()`، `promotions.service.ts`'s `previewForOrder()`، و`GET /services/:id/estimate` (`catalog.controller.ts`) الثلاثة بينادوها — **كانت أصلاً مش عارفة `pricing_model=formula` خالص**. أي خدمة formula كان `estimate()` بيدّيها المسار الثابت العادي (`service.basePriceCents`)، واللي بيتسجّل `0` عمدًا لخدمات formula (مفيش سعر أساسي ثابت لها أصلاً، السعر كله من المعادلة) — يعني **أي طلب حقيقي لخدمة formula كان بيتحجز مجانًا بالكامل** (`estimated_price_cents=0`, `total_amount_cents=0`) من غير أي خطأ ولا تحذير، بينما `POST /services/:id/evaluate-price` (المسار المنفصل اللي `apps/customer-app` المفروض يستخدمه لعرض السعر الحي وقت ملء الفورم) كان شغال صح تمامًا ويحسب سعر حقيقي. يعني العميل كان ممكن يشوف سعر تقديري حقيقي (مثلاً 2110 قرش) في شاشة المعاينة، وبعدين الطلب الفعلي يتحجز بصفر — أخطر فجوة تسعير في المشروع كله لحد اللحظة دي.

**الحل المعماري**: `CatalogService.estimate()` بقى بياخد `fieldValues?: Record<string, string | number | boolean>` كمعامل خامس اختياري، وبيتفرّع فورًا لو `service.pricingModel === PricingModel.FORMULA` لاستدعاء `PricingEngineService.evaluate(serviceId, fieldValues ?? {})` بدل المسار الثابت بالكامل — **مسار مستقل تمامًا**، مفيش تركيب مع `zone_pricing`/`level_pricing` (المعادلة نفسها مسؤولة عن كل عوامل السعر). القرارات المعمارية المحسومة هنا:
- `CatalogModule` بقى بيستورد `PricingModule` (اتحقق الأول مفيش استيراد دائري: `PricingModule` بيستورد `TypeOrmModule`+`AuditModule` بس، مفيش استيراد لـ`CatalogModule` من جواه).
- `inspection_fee_cents` لسه بييجي من `service.inspectionFeeCents` بشكل موحّد (مش جزء من ناتج المعادلة — `PricingEvaluationResult` مفيهوش حقل زيه أصلاً).
- رسوم الطوارئ الإضافية (`emergency_surcharge_cents`/`emergency_sla_minutes`) لسه بتتطبّق فوق السعر الناتج من المعادلة بنفس منطق المسار الثابت بالحرف (نسبة `pricing.emergency_surcharge_percentage` من الإعدادات).
- `PriceEstimate` (النوع المُرجَع) بقى فيه `min_price_cents`/`max_price_cents` إضافيين (مطابقين لناتج المعادلة، `null` دايمًا للنماذج التانية).
- `CreateOrderDto` بقى فيه `field_values?: Record<string, string|number|boolean>` اختياري، بيتبعت مباشرة من `orders.service.ts`'s `create()` لـ`estimate()`. لو الخدمة formula وفيها حقل مطلوب ناقص، نفس خطأ `PricingEngineService.validateAndNormalizeFieldValues()` (`VAL_001` بوضوح) بيترفض **قبل** أي كتابة في transaction إنشاء الطلب — مفيش صف orphan.
- `ValidatePromoCodeQueryDto` (`GET /promo-codes/:code/validate`) بقى فيه `field_values?` كمان — بما إنه `GET` بلا body، بيوصل كـ JSON string جوّه الـ query ويتفسّر بـ`@Transform`؛ JSON غير صالح بيتسيب كـ string عمدًا عشان `@IsObject()` يرفضه برسالة 400 واضحة بدل ما يتبلع بصمت. `previewForOrder()` بتستخدمها بنفس منطق `create()` بالحرف.

**قرار موثّق صراحة (مش سهو)**: `PricingEngineService.evaluate()` بتتنادى **قبل** transaction إنشاء الطلب (زي حساب `zone_pricing` بالظبط أصلاً)، فسجل التدقيق `service_pricing_evaluations` بتاع لحظة إنشاء الطلب بيتسجّل بـ`order_id=NULL` (مش رابط بالطلب اللي هيتولد بعد كده) — قرار مقصود لتجنّب نداء تاني للمعادلة جوّه الـ transaction (ممكن يدّي نتيجة مختلفة لو القواعد اتغيّرت بين اللحظتين، وتعقيد إضافي بلا داعي واضح).

**اختبار حي كامل** (خدمة formula حقيقية جديدة عبر `POST /admin/services` + 4 حقول + 3 قواعد تسعير، بنفس مثال المحارة في `docs/08` §1.8: مساحة×سعر_المتر[نوع الحيط] + 15% لو السمك 3سم + 500 قرش لو الدور>5):
- `POST /services/:id/evaluate-price` بـ`{area:10, wall_type:internal, thickness_cm:"3", floor:6}` → `price_cents:2110` (10×140=1400 + 15%=210 + 500 دور = 2110) ✓.
- `POST /services/:id/estimate` (المسار القديم، من غير `field_values`) → **قبل الإصلاح كان هيرجع `estimated_total_cents:0` بصمت**، بعد الإصلاح بيرفض بوضوح `"الحقل \"المساحة\" (area) مطلوب"` ✓ (رفض واضح أفضل بمراحل من سعر غلط صامت).
- `POST /orders` بنفس `field_values` → طلب حقيقي اتحجز بـ`estimated_price_cents:2110`, `total_amount_cents:2110` بالظبط ✓، وصف في `service_pricing_evaluations` اتسجّل فعلاً.
- `POST /orders` بـ`booking_mode:emergency` بنفس الحقول → `surge_amount_cents:422` (20% من 2110 مقرّبة) و`total_amount_cents:2532` بالظبط ✓ — رسوم الطوارئ بتتطبّق فوق سعر المعادلة صح.
- `POST /orders` من غير `field_values` خالص، وبقيمة `dropdown` غير مسموحة — الاتنين اترفضوا `400` واضح **من غير ما يتعمل أي صف طلب orphan** (اتأكد بعدّ `orders` قبل/بعد).
- `GET /promo-codes/:code/validate` بكود وهمي: من غير `field_values` → رفض "حقل مطلوب"؛ بـ`field_values` كاملة → عدّى التسعير ووصل لخطأ "كود الخصم غير موجود" (يثبت التسعير اتحسب صح ووصل لمرحلة البحث عن الكود)؛ بـJSON غير صالح → 400 واضح من `IsObject()`.

**ملحوظة جانبية اتلاحظت أثناء الاختبار (مش بَقّة في الكود الجديد، سلوك موجود من Phase 1)**: حقل مُعرَّف `is_required:false` على مستوى `service_pricing_fields` (زي `floor` في المثال) لسه بيتطلّب قيمة لو معادلة `final_price` بتستخدمه جوّه شرط `if`/`gt` — `formula-evaluator.ts` بيرفض المقارنة `undefined` صراحة. ده سلوك المحرك الأصلي من Phase 1 (`formula-evaluator.spec.ts` بيغطيه)، مش حاجة اتغيّرت هنا — تصميم المعادلة نفسها (اختيار الأدمن يستخدم حقل "اختياري" جوّه شرط "إجباري" منطقيًا) هي المسؤولة، مش خطأ في المحرك.

### مرحلة 2 — لسه فاضية عمدًا (`docs/08` §1.7)

واجهة "Builder" بصرية في `apps/admin` (سحب وإفلات للحقول، بناء المعادلة بـ blocks، Preview بقيم تجريبية قبل الحفظ) — شغل frontend كبير مستقل، الـ backend/API دلوقتي كافي يخلي المحرك شغال ومختبر حي بالكامل عبر REST مباشر لحد ما الواجهة تتبني.

### اختبار حي كامل (2026-08-11)

خدمة تجريبية "محارة" (`pricing_model=formula`) اتعملت بـ4 حقول (`wall_type` dropdown، `area`، `thickness_cm` dropdown، `floor` اختياري) + قاعدتين (lookup table لسعر المتر حسب النوع، ثابت لرسوم الدور) + معادلة نهائية مطابقة تمامًا لمثال `docs/08` §1.8. `POST /services/:id/evaluate-price` بـ`{area:120, wall_type:external, thickness_cm:"3", floor:7}` رجّع **`price_cents: 23270`** — مطابق تمامًا للحساب اليدوي `(120×165×1.15)+500=23270`. اختبار تاني (`area:150, wall_type:internal, thickness_cm:"2", floor:2`) رجّع `21000` (من غير مكافآت السمك/الدور) — صح. محاولة حفظ معادلة خبيثة (`{"type":"eval",...}`) اترفضت بوضوح بـ`VAL_001` من غير ما تمس القاعدة الصحيحة الموجودة (اتأكد بإعادة تقييم السعر بعد المحاولة الفاشلة ورجوع نفس القيمة الصح). الخدمة التجريبية اتمسحت بعد التأكد (بيانات اختبار مش حقيقية).

مرجع كامل: `../../../../docs/02-data-dictionary.md`، `../../../../docs/01-master-plan.md` §2.4، `../../../../docs/08-pricing-engine-and-platform-vision.md`، `../../../../docs/adr/0001-dynamic-pricing-engine.md`.
