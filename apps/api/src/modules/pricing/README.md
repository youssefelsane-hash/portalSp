# modules/pricing

حساب السعر والعمولة والخصم. يستخدم `service_zone_pricing` و`service_level_pricing` (قاموس §5.3-5.4) للتسعير الثابت العادي (موجود في `catalog` module نفسه). **تحديث 2026-08-11**: الموديول ده بقى فيه كمان محرك التسعير الديناميكي (Pricing Engine) — راجع `docs/08-pricing-engine-and-platform-vision.md` §1 و`docs/adr/0001-dynamic-pricing-engine.md` قبل أي تعديل.

## محرك التسعير الديناميكي (Pricing Engine) — ✅ خلص بالكامل end-to-end (Backend + Admin UI + تتبّع السعر بالطلب، 2026-08-12)

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

**قرار موثّق صراحة (مش سهو)**: `PricingEngineService.evaluate()` بتتنادى **قبل** transaction إنشاء الطلب (زي حساب `zone_pricing` بالظبط أصلاً)، فسجل التدقيق `service_pricing_evaluations` بتاع لحظة إنشاء الطلب بيتسجّل الأول بـ`order_id=NULL` — قرار مقصود لتجنّب نداء تاني للمعادلة جوّه الـ transaction (ممكن يدّي نتيجة مختلفة لو القواعد اتغيّرت بين اللحظتين، وتعقيد إضافي بلا داعي واضح).

**تتبّع السعر التاريخي (Price Traceability) — ✅ خلص (2026-08-12)**: المالك طلب صراحة إن "السعر النهائي للطلب لازم يفضل قابل للتتبّع حتى لو الأدمن غيّر قواعد التسعير بعدين". الحل: `evaluate()` بترجّع دلوقتي `evaluationId` (id الصف اللي اتسجّل في `service_pricing_evaluations`) فوق `PricingEvaluationResult` العادي (نوع فرعي إضافي، مش تغيير في الـcontract العام). `CatalogService.estimate()` بتمرّر `pricing_evaluation_id` ده لحد `PriceEstimate`. `OrdersService.create()` بعد ما الـtransaction تخلص (وبقى عندنا `order.id` حقيقي)، بتنادي `PricingEngineService.linkEvaluationToOrder(evaluationId, order.id)` — `UPDATE` بسيط بره الـtransaction عمدًا (نفس فلسفة `AuditLogService.record()`: تدقيق مش لازم يفشّل إنشاء الطلب لو فشل الربط). **اتأكد حي**: طلب حقيقي اتعمل لخدمة formula بـ`field_values:{area:10,wall_type:internal}` → `estimated_price_cents:1400` (مطابق لناتج المعادلة بالظبط)، وصف `service_pricing_evaluations` المرتبط بيه اتحقق إن `order_id` بقى معبّى بـid الطلب (مش NULL) فورًا بعد الإنشاء، بينما صف preview سابق (من Admin Pricing Builder، بدون طلب) فضل `order_id=NULL` صح.

**اختبار حي كامل** (خدمة formula حقيقية جديدة عبر `POST /admin/services` + 4 حقول + 3 قواعد تسعير، بنفس مثال المحارة في `docs/08` §1.8: مساحة×سعر_المتر[نوع الحيط] + 15% لو السمك 3سم + 500 قرش لو الدور>5):
- `POST /services/:id/evaluate-price` بـ`{area:10, wall_type:internal, thickness_cm:"3", floor:6}` → `price_cents:2110` (10×140=1400 + 15%=210 + 500 دور = 2110) ✓.
- `POST /services/:id/estimate` (المسار القديم، من غير `field_values`) → **قبل الإصلاح كان هيرجع `estimated_total_cents:0` بصمت**، بعد الإصلاح بيرفض بوضوح `"الحقل \"المساحة\" (area) مطلوب"` ✓ (رفض واضح أفضل بمراحل من سعر غلط صامت).
- `POST /orders` بنفس `field_values` → طلب حقيقي اتحجز بـ`estimated_price_cents:2110`, `total_amount_cents:2110` بالظبط ✓، وصف في `service_pricing_evaluations` اتسجّل فعلاً.
- `POST /orders` بـ`booking_mode:emergency` بنفس الحقول → `surge_amount_cents:422` (20% من 2110 مقرّبة) و`total_amount_cents:2532` بالظبط ✓ — رسوم الطوارئ بتتطبّق فوق سعر المعادلة صح.
- `POST /orders` من غير `field_values` خالص، وبقيمة `dropdown` غير مسموحة — الاتنين اترفضوا `400` واضح **من غير ما يتعمل أي صف طلب orphan** (اتأكد بعدّ `orders` قبل/بعد).
- `GET /promo-codes/:code/validate` بكود وهمي: من غير `field_values` → رفض "حقل مطلوب"؛ بـ`field_values` كاملة → عدّى التسعير ووصل لخطأ "كود الخصم غير موجود" (يثبت التسعير اتحسب صح ووصل لمرحلة البحث عن الكود)؛ بـJSON غير صالح → 400 واضح من `IsObject()`.

**ملحوظة جانبية اتلاحظت أثناء الاختبار (مش بَقّة في الكود الجديد، سلوك موجود من Phase 1)**: حقل مُعرَّف `is_required:false` على مستوى `service_pricing_fields` (زي `floor` في المثال) لسه بيتطلّب قيمة لو معادلة `final_price` بتستخدمه جوّه شرط `if`/`gt` — `formula-evaluator.ts` بيرفض المقارنة `undefined` صراحة. ده سلوك المحرك الأصلي من Phase 1 (`formula-evaluator.spec.ts` بيغطيه)، مش حاجة اتغيّرت هنا — تصميم المعادلة نفسها (اختيار الأدمن يستخدم حقل "اختياري" جوّه شرط "إجباري" منطقيًا) هي المسؤولة، مش خطأ في المحرك.

### مرحلة 2 — ✅ خلصت (2026-08-12) — Admin Pricing Builder UI

واجهة "Builder" في `apps/admin` (`app/catalog/services/[id]/pricing-builder.tsx`, component `PricingBuilder`) — مش سحب وإفلات (تعقيد غير مبرر لعدد الحقول المتوقع)، فورم منظّم بأقسام واضحة: إدارة حقول الفورم الديناميكي (14 نوع، مع options/min/max/unit حسب النوع)، ثوابت التسعير، جداول البحث (lookup tables)، محرر JSON للمعادلة النهائية (`final_price`) مع رسالة أمان صريحة إن مفيش `eval`/JavaScript حر — JSON فقط بعمليات whitelist، وقسم معاينة/اختبار حي بيرسم حقول إدخال حسب نوع كل حقل ويستدعي `POST /services/:id/evaluate-price` الحقيقي (نفس الـendpoint اللي التطبيقات هتستخدمه). **اتأكد حي بالكامل عبر متصفح حقيقي (Playwright)**: تسجيل دخول أدمن → إنشاء خدمة `pricing_model=formula` → إضافة حقلين (`area` رقمي، `wall_type` dropdown) → إضافة جدول بحث (`price_per_meter`) → كتابة وحفظ معادلة `multiply(field_ref(area), lookup_ref(price_per_meter, wall_type))` → معاينة بـ`area=10, wall_type=internal` → السعر المعروض `14.00 ج.م.` (=1400 قرش=10×140) ✓ مطابق تمامًا لناتج نفس المعادلة لما استُخدمت في `POST /orders` حقيقي بعد كده. Type جديد `PricingModel='formula'` كان ناقص أصلاً من `packages/shared-types` — ده كان بيمنع الأدمن حتى من *إنشاء* خدمة formula من الواجهة أساسًا (فجوة اتقفلت هنا كمان).

### مرحلة 3 — ✅ خلصت (2026-08-13) — محرر شجرة بصري (No-Code كامل) بدل محرر JSON

كانت فجوة موثّقة صراحة (مراجعة تقنية 2026-08-13، P1): "المعادلة النهائية لسه JSON AST في textarea. تقنيًا آمن، لكن مش تجربة Super Admin احترافية." الحل: `formula-tree-editor.tsx` جديد (component `FormulaTreeEditor`) — محرر شجري recursive، كل عقدة `FormulaNode` بكارت فيه اختيار نوع (12 نوع مطابقين بالحرف لـ`ALLOWED_NODE_TYPES` في `formula-evaluator.ts`) + عناصر تحكم مناسبة لنوعها (رقم لـ`literal`، dropdown حقول لـ`field_ref`، dropdown ثوابت لـ`constant_ref`، dropdown جداول بحث لـ`lookup_ref`، قايمة عناصر قابلة للإضافة/الحذف لـ`add`/`subtract`/`multiply`/`divide`/`min`/`max`، محررين متداخلين لـ`percentage`/`round`/`if`). `PricingBuilder` بقى بيدير `payload: FinalPriceFormulaPayload` كـobject بنية (state) بدل نص JSON — `price_cents` إجباري دايمًا، والحقول الاختيارية السبعة (`min_price_cents`/`max_price_cents`/`estimated_duration_days`/`required_technicians`/`required_assistants`/`requires_assistant`/`suitable_for_emergency`) كل واحد منهم قابل للتفعيل بـcheckbox منفصل.

**قرار تصميم متعمّد (زي مرحلة 2 بالحرف)**: مفيش drag & drop حقيقي — نفس المبرر (تعقيد framework كامل غير مبرر لعدد العمليات المتاح، محرر شجري recursive بيحقق نفس هدف "no-code كامل" بمجهود ومخاطرة أقل بكتير). وضع "عرض/تحرير JSON" اختياري لسه موجود (زرار toggle) لمراجعة الشكل المخزَّن فعليًا أو نسخ/لصق سريع — مش الطريق الافتراضي أو الوحيد زي قبل كده، ومصدر الحقيقة واحد (الـpayload state، مش نصين منفصلين).

اتعمله اختبار حي مباشر عبر curl ضد الباك-إند الحقيقي (نفس شكل الـpayload اللي المحرر الجديد بينتجه بالظبط): `PUT /admin/services/:id/pricing-rules` بمعادلة `multiply(field_ref(area), literal(100))` + `min_price_cents` اختياري مفعّل → اتخزن صح، و`POST /services/:id/evaluate-price` بـ`area=30`/`area=100` رجّع `price_cents` صحيح (3000/10000) و`min_price_cents` متسجّل صح (5000) — نفس الـendpoint اللي التطبيقات بتستخدمه، صفر منطق تقييم جديد أو مكرر.

### اختبار حي كامل (2026-08-11)

خدمة تجريبية "محارة" (`pricing_model=formula`) اتعملت بـ4 حقول (`wall_type` dropdown، `area`، `thickness_cm` dropdown، `floor` اختياري) + قاعدتين (lookup table لسعر المتر حسب النوع، ثابت لرسوم الدور) + معادلة نهائية مطابقة تمامًا لمثال `docs/08` §1.8. `POST /services/:id/evaluate-price` بـ`{area:120, wall_type:external, thickness_cm:"3", floor:7}` رجّع **`price_cents: 23270`** — مطابق تمامًا للحساب اليدوي `(120×165×1.15)+500=23270`. اختبار تاني (`area:150, wall_type:internal, thickness_cm:"2", floor:2`) رجّع `21000` (من غير مكافآت السمك/الدور) — صح. محاولة حفظ معادلة خبيثة (`{"type":"eval",...}`) اترفضت بوضوح بـ`VAL_001` من غير ما تمس القاعدة الصحيحة الموجودة (اتأكد بإعادة تقييم السعر بعد المحاولة الفاشلة ورجوع نفس القيمة الصح). الخدمة التجريبية اتمسحت بعد التأكد (بيانات اختبار مش حقيقية).

### مرحلة 4 — ✅ خلصت (2026-08-18) — Script 4 Part L §47-50: معاينة مسوّدة قبل النشر + حالات اختبار محفوظة

كانت فجوة موثّقة صراحة اتكشفت وقت مراجعة Script 4 من الأول: قسم "معاينة واختبار السعر" (مرحلة 2)
كان بينادي `POST /services/:id/evaluate-price` — نفس الـendpoint اللي التطبيقات الحقيقية بتستخدمه،
يعني بيقرا القاعدة **المحفوظة فعليًا** بس. عمليًا: الأدمن بيعدّل المعادلة في `FormulaTreeEditor`،
لازم يحفظ (`PUT /admin/services/:id/pricing-rules` — يخلي التعديل ساري لأي عميل حقيقي فورًا) الأول
قبل ما يقدر يشوف نتيجته — بالظبط عكس §47 ("Before publishing: allow Admin to enter sample inputs").

**الحل — `PricingEngineService.evaluateDraft()`**: نفس محرك الحساب بالحرف (`computeResult()`
مشترك، اتفصل من `evaluate()` الأصلية بدون تغيير سلوكها)، بس `formula_payload` اختياري بيتبعت
كـoverride بدل ما يتقرا من الداتابيز — **صفر كتابة** (لا `service_pricing_evaluations` ولا أي
تدقيق). لو مبعوتش، بيقرا القاعدة الحية الحالية (نفس سلوك `evaluate()` تمامًا، مفيد لتشغيل حالات
اختبار محفوظة ضد الوضع الحالي بدون أي تعديل). فحص شكل الـoverride بنفس `validateFinalPriceFormulaPayload`
المستخدمة وقت الحفظ الحقيقي (اتفصلت من `pricing-rules.service.ts` لـ`formula-evaluator.ts`
عشان تتشارك بين المسارين، صفر تكرار منطق أمان).

- **`POST /admin/services/:id/pricing/evaluate-draft`** — `{field_values, formula_payload?}`.
  `pricing-builder.tsx`'s `handlePreview()` بقى بيبعت الـ`payload` state الحالي (اللي لسه بيتعدّل
  في المحرر، ممكن يكون متغيّر ولسه مش محفوظ) بدل ما يعتمد على القاعدة المحفوظة — زرار "احسب
  السعر" دلوقتي بيعاين *المسوّدة الفعلية* مش آخر نسخة محفوظة.

- **حالات اختبار محفوظة (§48، `service_pricing_rule_tests`, migration `0134`)** — "المدخلات دي
  لازم تنتج السعر ده بالظبط". `PricingRuleTestsService.runAll(serviceId, formulaPayloadOverride?)`
  بتشغّل كل الحالات المحفوظة لخدمة معيّنة ضد القاعدة الحية أو مسوّدة (نفس `evaluateDraft()`)، بترجّع
  `{actual_price_cents, passed, error}` لكل حالة — فشل حالة واحدة (مثلاً حقل مطلوب ناقص) ما بيوقفش
  باقي الحالات. زرار "احفظ كحالة اختبار" جنب زرار المعاينة بياخد مدخلات المعاينة الحالية كنقطة بداية
  سريعة. زرار "شغّل كل الحالات ضد المسوّدة الحالية" بيشغّلهم ضد `payload` الحالي — يقدر الأدمن
  يتأكد إن تعديله اللي لسه بيعمله (مش محفوظ لسه) ما كسرش أي سيناريو معروف قبل ما يحفظ، بالظبط
  زي المطلوب في §48 ("When formula changes: run tests. Do not silently publish broken pricing").

- **§49 (draft/publish versioning) — تم التأكد إنها مش فجوة فعلية، صفر بناء إضافي**: النظام
  عنده بالفعل آلية "جدولة مستقبلية" (`valid_from`/`valid_until` في `PricingRulesService.upsert()`،
  نفس نمط `upsertZonePricing`) — تعديل بتاريخ سريان مستقبلي بيقفل الصف الحالي عند لحظة السريان
  الجديدة ويفتح صف جديد، من غير ما يمس السعر الساري دلوقتي خالص. وشرط §49 الأهم ("Existing
  confirmed orders retain their pricing snapshot") متحقق بالفعل من مرحلة 1 (`evaluationId` +
  `service_pricing_evaluations` — كل طلب مربوط بصف تقييم ثابت، تعديل القواعد بعد كده ميغيّرش
  السعر المتفق عليه). بناء جدول "draft/published" منفصل كان هيكرر آلية موجودة تحل نفس المشكلة
  فعليًا — قرار متعمّد بعدم البناء، مش سهو.

- **§50 (RBAC granularity) — تم التأكد إنها مش فجوة فعلية**: "القراءة" (`GET
  .../pricing-fields`, `GET .../pricing-rules`, `GET .../pricing-tests`) مفتوحة لأي أدمن بالفعل
  (صفر `@RequirePermission`) — أي موظف يقدر يشوف تسعير خدمة من غير ما يقدر يعدّله. "التعديل"
  (`POST`/`PUT`/`DELETE` على الحقول/القواعد/حالات الاختبار، وكمان `evaluate-draft`/`run` — لازم
  تعديل تقدر تعاينه/تختبره) مقفولة خلف `catalog.manage`. الفرق بين "edit draft" و"publish" مالوش
  معنى فعلي هنا (مفيش "draft" منفصل عن "published" — راجع §49 فوق)، فمفيش صلاحية تالتة مطلوبة.

**اختبار حي كامل**:
- **jest** (`pricing-draft-preview.spec.ts`, 6 اختبارات، ضد Postgres حقيقي): `evaluateDraft()`
  بدون override بيرجع نفس نتيجة القاعدة الحية وصفر كتابة، مع override بيقيّم المسوّدة (سعر مختلف
  تمامًا) والقاعدة الحية تفضل زي ما هي، رفض override غير صالح (نفس فحص الحفظ الحقيقي)، CRUD كامل
  لحالات الاختبار + `runAll()` (حالة ناجحة وفاشلة معًا)، `runAll()` مع override بيشغّل ضد مسوّدة
  مش القاعدة الحية، ورفض حذف حالة مش موجودة.
- **curl مباشر ضد dev server حقيقي**: خدمة formula حقيقية، `evaluate-draft` بدون/مع override
  (تحقق DB إن القاعدة الحية اتفضلت زي ما هي)، إنشاء/تشغيل/حذف حالات اختبار حقيقية (تحقق
  `audit_logs`: `pricing_rule_test.created`×2، `pricing_rule_test.deleted`)، ورفض بدون توكن
  (401). بيانات الاختبار اتنضّفت بالكامل.

`npx tsc --noEmit`، `npx nest build`، `npx jest --runInBand` (83/83 suites، 486/486 tests) +
`tsc`/`eslint`/`next build` لـ`apps/admin` كلهم ناجحين.

## بَقّة حقيقية اتلقطت واتصلحت — `default_value` كانت بتتجاوز فحص min/max وoptions تمامًا (Script 7 Phase 3، 2026-08-19)

**السياق**: `resolveDefaultValue()` (Script 6 Part 3/4) بتحل القيمة الافتراضية لحقل اختياري
العميل ما لمسوش. النسخة الأولى من `validateAndNormalizeFieldValues()` كانت بتحط القيمة دي في
`normalized[field.fieldKey]` وتعمل `continue` **فورًا** — يعني بتتخطى كل الفحص اللي أي قيمة
مبعوتة من العميل بتتعرضله بالحرف (عضوية `options` لحقول DROPDOWN/MULTI_SELECT، وحدود
`min_value`/`max_value` لحقول NUMBER/SLIDER).

**الاستغلال المؤكد حيًا**: حقل NUMBER بحدود `[1,100]` لكن `default_value='99999'` (أدمن غلط أو
نسي يحدّث الحد الأقصى بعد ما غيّر `default_value`) → السعر اتحسب بـ`99999×100 = 9999900` قرش
بدل رفض واضح — **سعر خاطئ تمامًا يتحسب بصمت لأي عميل ما لمسش الحقل ده**. نفس الاستغلال لحقل
DROPDOWN بـ`default_value` مش من ضمن `options` — بيتقيّم كـ"مش مساوي" لأي شرط `equals` في
المعادلة بصمت، بدل رفض.

**الإصلاح**: القيمة الافتراضية بقت بتمشي في **نفس مسار الفحص بالحرف** اللي أي قيمة مبعوتة من
العميل بتمشي فيه (`value` بقت متغيّر واحد يُعاد استخدامه، مفيش `continue` مبكر بعد حساب
الافتراض) — رسالة الخطأ كمان بتوضّح صراحة إن المصدر "القيمة الافتراضية المُعدّة" لو ده اللي
سبب الرفض، عشان الأدمن يعرف يصلّح الإعداد بسرعة بدل ما يفتكرها بَقّة عميل.

**قرار تصميم متعمّد**: الرفض الواضح (400) أُختير عمدًا بدل "قصّ" القيمة على أقرب حد مسموح —
سعر مقصوص لسه ممكن يبقى غلط وسط بصمت (العميل مش بيعرف السبب)، بينما الرفض بيلفت نظر الأدمن
فورًا لخطأ إعداد حقيقي بدل ما يفضل يحسب أسعار خاطئة لحد ما حد يلاحظ بالصدفة — نفس فلسفة "لا
تسعير من العميل موثوق، السيرفر لازم يتحقق ويرفض بوضوح" المُطبّقة في كل الموديول ده.

**اتأكد حيًا مرتين**: اختبار جديد (`pricing-field-default-value-bypass.spec.ts`، Postgres حقيقي)
بيثبت رقم بره الحدود وdropdown بقيمة مش موجودة كلاهما بيترفضوا بـ`VAL_001` بعد الإصلاح (كانوا
بينجحوا بسعر غلط قبله). وتأكيد إضافي عبر `curl` مباشر ضد dev server حقيقي: خدمة formula حقيقية
بحقل `area` (حدود `[1,100]`، `default_value='99999'`)، `POST /services/:id/estimate` من غير
`field_values` رجع `400` برسالة واضحة تذكر "القيمة الافتراضية المُعدّة" بدل ما يحسب سعر
`9999900` قرش. بيانات الاختبار اتنضّفت.

مرجع كامل: `../../../../docs/02-data-dictionary.md`، `../../../../docs/01-master-plan.md` §2.4، `../../../../docs/08-pricing-engine-and-platform-vision.md`، `../../../../docs/adr/0001-dynamic-pricing-engine.md`.

## تحديث محرك المعادلات (docs/01B — 2026-08-24): عمق 48 + حدود تعقيد + تحقق مراجع

### إيه اللي اتغيّر بالظبط
1. **العمق**: `MAX_FORMULA_DEPTH` من 12 → **48** (`formula-limits.ts`/FORMULA_LIMITS المشتركة
   مع الواجهة). نقطة الفرض واحدة في `validateFormulaNode` — نفس المكان الوحيد زي ما كان.
2. **حدود تعقيد جديدة فوق العمق** (العمق لوحده مش حماية كافية):
   - `MAX_NODE_COUNT = 1500` عقدة لكل payload كامل (كل المخرجات).
   - `MAX_PAYLOAD_JSON_BYTES = 128KB`.
3. **أخطاء بمسار العقدة**: أي رفض هيوضّح مكانه (`price_cents → add.operands[3]: ...`) —
   الواجهة بتعرض المسار ده عشان الأدمن يوصل للعقدة مباشرة.
4. **التحقق من المراجع وقت الحفظ** (`PricingRulesService.assertFormulaReferencesValid`):
   field_ref/constant_ref/lookup_ref/if-condition ضد حقول الخدمة النشطة والثوابت/الجداول
   السارية — مرفوض برسالة مسماة. **المعاينة (evaluateDraft) متعمّدًا بتفحص الشكل بس** عشان
   تسمح بتجربة مراجع لسه هتتعمل قبل الحفظ. القاعدة القديمة المحفوظة مابتتلمش لو اتعطّل حقل —
   خط الدفاع التاني هو رفض التقييم وقت التنفيذ (الموجود أصلًا).
5. **واجهة الأدمن** (`formula-tree-editor.tsx`/pricing-builder): طي/فتح لكل عقدة تركيبية بملخص
   سطر واحد، badge عمق على العقد العميقة (تحذير من 85%)، شريط breadcrumb (زرار ⌖)، ومؤشر
   عمق/عقد live فوق المحرر ضد FORMULA_LIMITS المشتركة.

### اللي اتحافظ عليه بدون تغيير (موجود ويعمل)
- الـAST والـoperators الـ15 كلها (allowlist، صفر eval) — نفس الصيغة المخزنة، صفر migration.
- evaluateDraft = نفس evaluator الإنتاج (preview == production) + حالات اختبار محفوظة.
- النشر بنظام valid_from scheduling؛ الطلبات بـsnapshot سعرها (مثبت حي: تغيير الثابت بعد
  حجز ما غيّرش total_cents للطلب القديم).
- المخرجات المتعددة (min/max/duration/crew/emergency) كلها بنفس grammar.

### قرارات مؤجلة (موثقة، مش سهو)
- **Reusable sub-expressions** (docs/01B §7): مفيش آلية قائمة والمعادلات الحالية shallow
  (أعمق حاجة < 20 عقدة) — التكلفة/الفايدة مش لصالحها دلوقتي. متابعة لما تظهر معادلات فعلية
  بتكرر أشجار كبيرة.
- **Lookup ranges/tiers** (§12): المطابقة النصية الحالية دقيقة مقصودة؛ نطاقات رقمية هتبقى
  node type جديد لو الأعمال طلبتها (مش تغيير صامت في الدلالة).

### الموجة 2 (نفس اليوم): حواجز التغييرات التدميرية + trace + شرح (docs/01B §5/§6/§13/§14)
- **حقول (§14)**: حذف/تعطيل/تغيير نوع/تقليص خيارات حقل مستخدم في معادلة نشطة = مرفوض 409
  بمسار الاستخدام. label/display_order/is_required/unit/min/max/default مسموحة دايمًا.
- **ثوابت/جداول بحث (§13)**: تعطيل مستخدم = مرفوض 409 بمسار أول استخدام. المعادلة نفسها تتعطل عادي.
- **find-usages**: GET /admin/services/:id/pricing-usages?field_key|rule_key — مواضع بالمسارات.
- **trace (§5)**: evaluateDraft بيرجّع خطوات الحساب (ربط الأوراق ثم العمليات لأعلى لحد الناتج)
  بنفس أرقام الإنتاج — عرض للأدمن بس، مش مصدر تسعير.
- **شرح هيكلي (§6)**: سطر لكل مخرج («ضرب(حقل hours × ثابت hourly_rate)») — explanation-only.
- اختبارات: pricing-lifecycle-guards.spec.ts (8 حالات حية) — إجمالي موديول التسعير 71 ✓.

### الموجة 3 — تكامل السلسلة الكاملة Price→Booking→Schedule→Matching (docs/01B §22، 2026-08-24)
1. **مخرجات المعادلة التشغيلية وصلت للطلب**: required_technicians/assistants/days/suitable_for_
   emergency من معادلة formula بتملى orders.* لو مفيش standard_data (الأولوية للإنتاجية القياسية
   لما العميل يستخدمها صراحةً). كانت بتتحسب وتتسجل في evaluations وتُهمل تمامًا.
2. **بوابة الطوارئ الديناميكية**: suitable_for_emergency=false في المعادلة يرفض booking_mode=
   emergency بوضوح (كانت قيمة ميتة).
3. **min/max clamp فعلي**: الحدود بتتفرض على estimated_total_cents بعد مضاعف المستوى وقبل رسوم
   الطوارئ — كانت بتترجع للعرض بس والسعر النهائي بيعدّيها.
4. **الجدولة بمدة الطلب الحقيقية**: توافر/تعارض الفني بقى بيقرا مدة المرشّح من orders.duration_hours
   (ADR-0031/0032) بدل دقائق الخدمة الثابتة، + الشرط المتماثل: طلب تاني duration_hours*60 ≥ عتبة
   اليوم الكامل = تعارض. المصدر الموحد: serviceDurationExpr في technician-eligibility.sql.ts مع
   fallback آمن لدقائق الخدمة الثابتة (مهم لمرشّح مش محفوظ بعد — اختبار blocked-day).
5. **بوابة الطاقم عند بدء التنفيذ اتوسعت**: كانت مقصورة على booking_mode=team — دلوقتي أي طلب
   محسوب له طاقم > 1 (أي وضع) لازم الطاقم يكتمل قبل IN_PROGRESS. نفس الرسالة/الدالة
   (getCrewComposition) — صفر منطق موازٍ؛ نسخة مكررة أقل شمولاً اتبنت بالغلط أثناء الشغل واتشالت.

### الموجة 4 — Admin Live Updates (docs/01B مهمة B، 2026-08-24)
**البنية**: namespace `/admin` جديد (`admin-realtime.gateway.ts`) — نفس بنية /tracking و/chat بالحرف
(RealtimeAccessService للـJWT handshake، RealtimeSessionRegistry للإبطال اللحظي عبر pg_notify).
الأحداث: @OnEvent على ~25 حدث دومين موجود أصلاً (orders/technicians/payments/payouts/installments/
recurring/support/complaints/ratings/settings/security) → بث إلى غرف `admin:topic:{topic}`.

**الأمان**: handshake يرفض غير الأدمن؛ الاشتراك في topic بيفحص الصلاحية حيًا (TOPIC_PERMISSIONS
في admin-topics.ts — installments.view / recurring_orders.view / payouts.view / settings.manage /
security.alerts.view)؛ الإبطال اللحظي عبر pg_notify مفعل تلقائياً من السجل المشترك.

**العميل الفعلي** (apps/admin): `lib/admin-realtime-context.tsx` يفتح Socket.IO واحدًا بعد تسجيل
الدخول، يرسل `admin:subscribe`، ويوزع `admin:live` على المشتركين عبر `useAdminLiveRefresh`.
صفحتا الطلبات وتفاصيل الطلب تعيدان الجلب الصامت عند أحداث الطلب/الدفع، وصفحتا الفنيين والتفاصيل
تعيدان الجلب عند الاعتماد أو تغيّر الحضور. الاتصال يسمح بـSocket.IO polling fallback لو الـproxy
لا يمرر WebSocket بدل ما تتوقف الميزة بالكامل. قبل إصلاح 2026-08-25 كان هذا القسم يصف ملفات
`admin-live.ts`/`live-indicator.tsx` غير موجودة فعليًا؛ البوابة كانت تبث لكن صفر عميل في اللوحة
كان يتصل بها، لذلك كان الأدمن محتاج Refresh يدويًا رغم وجود كود السيرفر.

حضور الفني: اتصال `/tracking` المستقل في تطبيق الفني يصدّر `technician.presence_changed` فقط عند
الانتقال الحقيقي صفر→اتصال أو آخر اتصال→صفر؛ اتصالان لنفس الفني لا ينتجان Offline كاذبًا. قائمة
الفنيين تعرض الحالة وتُحدّث نفسها فورًا. مثبت باختبار PostgreSQL + Socket.IO حقيقي مع اتصالين،
واختبار مستقل لبوابة الأدمن والاشتراك والبث.

## طرق حساب السعر — سجل واحد (ADR-0050 §1)

`pricing-methods.ts` هو **المصدر الوحيد** لكل طريقة حساب. كل طريقة صف بيقول:

| | |
|---|---|
| `requires` | المدخل اللي لازم يجي من العميل (`none` / `duration` / `quantity` / `period`) |
| `buildPrice(rate)` | شجرة `FormulaNode` بتحسب السعر — بتتنفّذ في **نفس** `evaluateFormulaNode()` بتاع المعادلة الديناميكية |
| `unitsForZoneOverride` | «الوحدة» اللي سعر المنطقة المطلق بيتضرب فيها |

**مفيش مسار حساب تاني في المشروع.** قبل ADR-0050 كانت المعرفة دي متفرّقة على تلات أماكن
(`switch` في `pricing-engine.service.ts`، `if` في `catalog.service.ts`، و`switch` تالت لوحدة
سعر المنطقة)، وأي تعديل كان لازم يتعمل في التلاتة.

`PRICING_METHODS` في `packages/shared-types` مرآة للأسماء والأوصاف — صفحات الأدمن بتقرا منها.
أي تعديل هنا لازم يتعمل هناك كمان.

## التواريخ والمسافات (ADR-0050 §2/§3)

`pricing-temporal.ts` — كل حسابات التقويم بتوقيت القاهرة، بتقرا مكوّنات التاريخ من `Intl`
مباشرة (مش بحساب منتصف الليل في JS، اللي كان مصدر بَقّة `CAIRO_DAY_EXPR`).

- `date_diff(from, to, unit, rounding?, inclusive?, absolute?)` — `minutes`/`hours` زمن منقضي
  فعلي؛ `days`/`weeks`/`months` **تقويمية** (من 1 مارس لـ1 أبريل = شهر واحد بالظبط).
- `distance(from, to, unit)` — Haversine. المصادر: حقل `location`، موقع الطلب، أو نقطة ثابتة.

**المدخلات مصادر مش أرقام عمدًا** — `field_ref` على حقل تاريخ بيفضل يرفض (برسالة بتقترح
`date_diff`)، لأن رجوع epoch ms كرقم كان هيدّي سعر بالمليارات بصمت لو اتضرب في تعريفة.

## الفورم الديناميكي على خدمة بلا سعر (ADR-0050 §6)

`validateFieldValuesOnly()` بتشغّل **نفس** تحقق الحقول (إجباري/خيارات/حدود) بلا أي تسعير —
لخدمات `inspection_then_quote` اللي بتنزل بلا سعر ومحتاجة «فلتر» أسئلة عشان الإدارة/الفني
يسعّروا. قبلها كان التحقق جوّه `evaluate()` اللي مابتتنادى غير لخدمات `formula`، يعني الفورم
على أي خدمة تانية كان **بلا أي فحص خالص**.
