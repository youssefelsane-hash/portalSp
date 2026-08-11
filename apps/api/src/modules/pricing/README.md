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

### مرحلة 2 — لسه فاضية عمدًا (`docs/08` §1.7)

واجهة "Builder" بصرية في `apps/admin` (سحب وإفلات للحقول، بناء المعادلة بـ blocks، Preview بقيم تجريبية قبل الحفظ) — شغل frontend كبير مستقل، الـ backend/API دلوقتي كافي يخلي المحرك شغال ومختبر حي بالكامل عبر REST مباشر لحد ما الواجهة تتبني.

### اختبار حي كامل (2026-08-11)

خدمة تجريبية "محارة" (`pricing_model=formula`) اتعملت بـ4 حقول (`wall_type` dropdown، `area`، `thickness_cm` dropdown، `floor` اختياري) + قاعدتين (lookup table لسعر المتر حسب النوع، ثابت لرسوم الدور) + معادلة نهائية مطابقة تمامًا لمثال `docs/08` §1.8. `POST /services/:id/evaluate-price` بـ`{area:120, wall_type:external, thickness_cm:"3", floor:7}` رجّع **`price_cents: 23270`** — مطابق تمامًا للحساب اليدوي `(120×165×1.15)+500=23270`. اختبار تاني (`area:150, wall_type:internal, thickness_cm:"2", floor:2`) رجّع `21000` (من غير مكافآت السمك/الدور) — صح. محاولة حفظ معادلة خبيثة (`{"type":"eval",...}`) اترفضت بوضوح بـ`VAL_001` من غير ما تمس القاعدة الصحيحة الموجودة (اتأكد بإعادة تقييم السعر بعد المحاولة الفاشلة ورجوع نفس القيمة الصح). الخدمة التجريبية اتمسحت بعد التأكد (بيانات اختبار مش حقيقية).

مرجع كامل: `../../../../docs/02-data-dictionary.md`، `../../../../docs/01-master-plan.md` §2.4، `../../../../docs/08-pricing-engine-and-platform-vision.md`، `../../../../docs/adr/0001-dynamic-pricing-engine.md`.
