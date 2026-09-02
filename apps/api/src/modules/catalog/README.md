# modules/catalog

التصنيفات والخدمات والتسعير. جداول: service_categories, services, service_zone_pricing, service_level_pricing, service_addons, technician_services (قاموس §5).

**الحالة: شغال — قراءة عامة + إدارة أدمن ديناميكية كاملة.**

- `GET /service-categories`, `GET /services?category_id=`, `GET /services/:id` — endpoints عامة (`@Public()`).
- `POST /services/:id/estimate?zone_id=` — بيرجّع سعر تقديري: بياخد `service_zone_pricing` لو فيه override نشط للمنطقة، وإلا بيرجع لسعر الخدمة الأساسي × `surge_multiplier`.

## إدارة الأدمن الديناميكية (`AdminCatalogController`, `@RequirePermission('catalog.manage')`)

الهدف: الأدمن يقدر يضيف/يعدّل/يمسح أي فئة أو خدمة **من غير أي تعديل كود** — بالظبط زي المطلوب (Category → sub-category → service، بهيكلية شجرية حرة عن طريق `parent_category_id`).

- **`/admin/service-categories`**: `POST` (إنشاء، بيرفض `slug` مكرر ويتحقق إن الأب موجود لو محدد)، `PATCH` (تعديل أي حقل، بيرفض إن الفئة تبقى أب لنفسها)، `DELETE` (soft-delete — بيرفض لو فيه خدمات لسه مرتبطة بالفئة، لازم تتعطّل أو تتنقل الأول).
- **`/admin/services`**: نفس النمط — `POST`/`PATCH`/`DELETE`. أي تغيير سعر (`base_price_cents`) بيتطبّق فوراً على `POST /services/:id/estimate` من غير أي إعادة نشر أو تعديل كود.
- **`/admin/services/:id/zone-pricing`**: `PUT` upsert (سعر مختلف لمنطقة معيّنة + `surge_multiplier`) و `DELETE .../zone-pricing/:pricingId` (تعطيل). الـ upsert بيدوّر على صف نشط موجود لنفس (خدمة، منطقة) بدل ما يكرّر صفوف.
- ~~**`/admin/services/:id/technicians`**: تحديد الفنيين المؤهلين لخدمة معيّنة (`technician_services`) — `POST`/`DELETE`~~ — **الواجهة اتشالت (§29/§30، طلب مالك صريح 2026-08-20)**: الـendpoints نفسها فاضلة شغالة (تعديل `technician_services` مباشرة لو حد احتاجها عبر API)، بس مش المصدر الحقيقي للأهلية ولا مستخدمة من أي واجهة تانية — راجع تعليق `AdminCatalogService.listEligibleTechnicians()` والقسم تحت.
- **كل عملية بتتسجّل في سجل التدقيق** (`../audit/README.md`) — `service.created`/`updated`/`deleted`, `service_category.*`, `service_zone_pricing.*`, `technician_service.assigned`/`removed`.
- اتعمله اختبار end-to-end فعلي شامل مطابق لمثال المستخدم بالحرف: فئة "خدمات منزلية" ← فئة فرعية "تنظيف" (بإعادة ربط فئة موجودة بأب جديد) ← خدمة "تنظيف كنب" — ظهرت فوراً في `GET /services` العام. تعديل السعر (من 250 لـ 300 جنيه) اتطبّق فوراً على `estimate`. تعطيل الخدمة خفاها من القائمة العامة فوراً. تسعير منطقة مخصص (350 جنيه + surge 1.2) اتطبّق صح على `estimate` وقفل السطر الأول لما اتعدّل تاني بدل ما يكرّره. تعيين فني كمستوى "خبير" نجح، تكراره اترفض، فني وهمي اترفض بـ404، وشيله نجح. حذف فئة فيها خدمة لسه اترفض بوضوح، وبعد حذف الخدمة الحذف نجح (soft-delete حقيقي — اختفت من قائمة الأدمن). عميل عادي اترفض بالكامل من كل مسارات الإدارة (403 من `RolesGuard` قبل حتى `PermissionsGuard`).
- **`catalog.manage`** صلاحية جديدة (`infra/migrations/0022_catalog_manage_permission.sql`) — `super_admin` و`ops_manager` بس.

## `service_level_pricing` و `service_addons` — كانت فجوة موثّقة، اتقفلت

**ملحوظة مهمة**: الجدولين كانوا موجودين فعلياً في `infra/migrations/0006_catalog.sql` من أول يوم (فاضيين، من غير entity/service/endpoint) — مفيش migration جديدة اتضافت، بس الكود اللي بيستخدمهم.

- **`service_level_pricing`** (فرق السعر حسب مستوى الفني اللي هيتنفّذ الطلب): إدارة كاملة عبر `GET/PUT /admin/services/:id/level-pricing` (upsert بيدوّر على صف موجود لنفس (خدمة، مستوى) بدل ما يكرّر) و`DELETE /admin/services/level-pricing/:pricingId` (تعطيل، مش حذف فعلي). القيم المسموحة لـ `technician_level` هي القيم الحقيقية المستخدمة فعلاً في الكود (`new`/`verified`/`professional`/`premium`/`team_leader` من `TechnicianLevel` enum بعد الـ rename في `0027_technician_level_tiers.sql`) — **مش** الأسماء التوضيحية القديمة (`bronze`/`silver`/`gold`/`platinum`) المكتوبة كتعليق في `02-data-dictionary.md` §5.4، اتجنّبنا اختراعها بالتحقق من الـ enum الحقيقي في الكود قبل الكتابة.
- **`POST /services/:id/estimate`** بقى بياخد query param اختياري `technician_level` — لو فيه صف `service_level_pricing` نشط لنفس (خدمة، مستوى)، بيتضرب في السعر (بعد أي `zone_pricing` override لو موجود). ده **معاينة سعر بس**، مش تطبيق تلقائي على الطلب الفعلي:
  - **قرار معماري متعمّد، مش سهو**: `POST /orders` (في `orders.service.ts`) بيستدعي `estimate()` من غير `technician_level` لأن الفني مش معروف لسه وقت إنشاء الطلب (الطلب لسه في `searching_technician`، والمطابقة بتحصل بعد كده). تطبيق المضاعف تلقائياً على السعر الفعلي بعد ما فني معيّن يقبل الطلب معناه تغيير سعر شافه العميل بالفعل وقت الحجز — قرار عمل (business decision) مش موجود بالتفصيل في القاموس (هل يتقبل العميل السعر الجديد؟ يتلغي؟ يتقفل على المستوى وقت المطابقة؟)، فمش هنخترعه. فجوة موثّقة صراحة.
- **`service_addons`**: إدارة كاملة عبر `POST/PATCH/DELETE /admin/services/:id/addons` و`/admin/services/addons/:addonId` (soft-delete حقيقي عبر `@DeleteDateColumn`)، بالإضافة لـ `GET /services/:id/addons` **عام** (`@Public()`) للتطبيقات تقرأ الإضافات المتاحة وقت إنشاء الطلب. **الربط بمسار إنشاء الطلب — كانت فجوة موثّقة أصغر متبقية، اتقفلت**: `POST /orders` بياخد `addon_ids?: string[]` اختياري (`CreateOrderDto`، حد أقصى 20، UUIDs فريدة). `CatalogService.findAddonsByIds(serviceId, ids)` (جديدة) بتتحقق إن كل الإضافات موجودة/نشطة/بتاعة نفس الخدمة **قبل** ما أي صف يتكتب في DB — إضافة واحدة غلط أو من خدمة تانية بترفض الطلب كله `400` بوضوح (مش تتجاهل بصمت، عشان العميل مايتفاجئش إنه اتحمّل حاجة طلبها فعلاً من غير ما تظهر). الإضافات المختارة بتتحط كـ `order_items` (`item_type=addon`) **جوّه نفس transaction إنشاء الطلب**، بـ `is_customer_approved=true`/`approved_at=now` فوراً — مختلف جوهرياً عن مسار `order_items`/`AWAITING_QUOTE_APPROVAL` (`../orders/README.md`) اللي الفني بيقترحه *أثناء* الشغل ومحتاج موافقة لاحقة؛ هنا العميل اختار الإضافة بنفسه صراحة وقت الحجز، فمفيش داعي لدورة موافقة تانية. سعرها بيتضاف لـ `orders.total_amount_cents` من نفس لحظة الإنشاء. اتعمله اختبار حي: إضافة كتالوج حقيقية (4000 قرش) اتعملت لخدمة، طلب حقيقي بـ`addon_ids` شامل الإضافة دي وصل بـ`total_amount_cents=34000` بالظبط (30000 أساسي + 4000)، `order_items` فيه صف `is_customer_approved=true` صح من غير أي فعل تاني مطلوب، و`GET /orders/:id/quote-items` (نفس endpoint مسار عرض السعر) عرضها صح. معرّف إضافة عشوائي غلط اترفض `400` واضح من غير ما يتعمل أي طلب أصلاً (اتأكد بعدم وجود صف orphan في `orders`). ~~فجوة موثّقة متبقية: apps/customer-app مفيهاش شاشة اختيار إضافات~~ — **اتقفلت**: `CreateOrderScreen` بقى بيجيب إضافات الخدمة (`CatalogRepository.fetchAddons()`) ويعرضها كـ`CheckboxListTile` بسعر كل واحدة، والمُختارة بتتبعت كـ`addon_ids` مع `POST /orders`. **اتعمله اختبار حي** (`test_live/addon_order_creation_live_test.dart`): إضافة حقيقية (4000 قرش) اتعرضت واتختارت، الطلب الناتج `total_amount_cents` طابق الأساسي + سعر الإضافة بالظبط، و`GET /orders/:id/quote-items` رجّع بند واحد `item_type=addon`/`is_customer_approved=true`.
- اتعمله اختبار حي كامل: إنشاء تسعير مستوى `premium` (×1.45) و`new` (×1.00) لخدمة حقيقية، `estimate` من غير `technician_level` رجّع السعر الأساسي، مع `technician_level=premium` رجّع `30000 × 1.45 = 43500` بالظبط، مع مستوى مالوش صف (`verified`) رجع للسعر الأساسي (fallback ×1) بدل ما يفشل، وقيمة enum قديمة غلط (`bronze`) اترفضت `VAL_001` بوضوح. تعطيل صف `new` عبر `DELETE .../level-pricing/:pricingId` اتأكد إنه بيوقف يتطبّق فوراً. إنشاء إضافتين، تعديل سعر واحدة وتعطيلها اختفت فوراً من `GET /services/:id/addons` العام لكن فضلت ظاهرة لقايمة الأدمن، حذفها (`DELETE`) اختفت من الاتنين (soft-delete حقيقي). أدمن `support_agent` (مالوش `catalog.manage`) اترفض 403 من كل عمليات الكتابة على الاتنين لكن قدر يقرا (`GET`) عادي. كل عملية اتسجّلت في `audit_logs` بالقيم القديمة/الجديدة صح.

## بَقّة حقيقية اتلقطت واتصلحت — `zone-pricing`/`technicians` كانوا بيرجّعوا entity خام (camelCase)

اتلقطت وقت بناء شاشة تفاصيل الخدمة في `apps/admin` (تحت). `GET/PUT /admin/services/:id/zone-pricing` و`GET/POST /admin/services/:id/technicians` كانوا الاستثناء الوحيد في `admin-catalog.controller.ts` كله — بيرجّعوا كائن TypeORM entity خام (`{serviceZoneId, priceCents, surgeMultiplier, isActive, createdAt, ...}` بـ camelCase) بدل ما يعدّوا على `toXxxResponseDto()` زي كل مسار تاني في نفس الملف بالظبط (`toServiceLevelPricingResponseDto`، `toServiceAddonResponseDto`، إلخ). اتأكدت البَقّة حياً بـ`curl` مباشر (رد فعلي فيه `serviceZoneId`/`priceCents` بدل `service_zone_id`/`price_cents`) قبل الإصلاح. اتصلحت بإضافة `ServiceZonePricingResponseDto`/`toServiceZonePricingResponseDto` و`EligibleTechnicianResponseDto`/`toEligibleTechnicianResponseDto` في `dto/admin-catalog-response.dto.ts`، وتعديل الـ4 مسارات (`GET`/`PUT` zone-pricing، `GET`/`POST` technicians) تعدّي عليهم. اتأكد الإصلاح حياً: نفس الـ`curl` رجّع `service_zone_id`/`price_cents` صح بعد الإصلاح.

## `apps/admin` — شاشة تفاصيل الخدمة (`/catalog/services/:id`) — كانت فجوة موثّقة، اتقفلت

كانت موثّقة في `apps/admin/README.md` ("تسعير حسب المنطقة، الفنيين المؤهلين لكل خدمة... مش متاحين من الواجهة لسه") — كل الـ endpoints فوق كانت API-only. اسم الخدمة في `/catalog` بقى رابط لشاشة تفاصيل فيها 4 أقسام: تسعير حسب المنطقة (إنشاء/تعطيل)، الفنيين المؤهلين (إضافة/إزالة، بالاسم وكود الفني الحقيقي مش UUID خام — بيتحل من نفس قايمة `GET /admin/technicians?verification_status=approved` المُستخدمة في شاشة إعادة تعيين الطلبات)، تسعير حسب مستوى الفني (إنشاء/upsert)، والإضافات الاختيارية (إنشاء/تفعيل/تعطيل). تفاصيل كاملة في `apps/admin/README.md`.

## "الفنيين المؤهلين" في شاشة الخدمة كانت قايمة قراءة مضلّلة — اتشالت (§29/§30، بلاغ مالك مباشر 2026-08-20)

كارت "الفنيين المؤهلين" في `apps/admin`'s `/catalog/services/:id` (موصوف فوق) كان بيقرا/يكتب
`technician_services` مباشرة بس — مش شرط الأهلية الحقيقي الكامل (`technician_services` مباشر OR
فئة معتمدة، §29). الأدمن يضيف فئة كاملة لفني (كارت "التخصصات" الجديد في `/technicians/[id]`)،
يفتح خدمة تحت الفئة دي، ويلاقي "مفيش فنيين مؤهلين" — رغم إن الفني ده فعليًا هيتوزّعله الطلب صح لو
اتحجز حقيقةً (`matching.service.ts` بيطبّق الشرط الكامل، مش الاستعلام الضيّق ده). اتأكد إن الأهلية
الحقيقية شغالة صح بمراجعة حية (`matching-technician-category-eligibility.spec.ts` — 3/3 نجحوا
ضد Postgres حقيقي: فني بالفئة بس بيتأهّل، فني بالخدمة المباشرة بس لسه شغال، فني بلا اعتماد بيتستبعد)
و`admin-orders.service.ts`'s `listEligibleTechniciansForReassign()` (إعادة تعيين الأدمن) اللي بيستخدم
`listForServiceBooking()` الصح أصلاً — مفيش أي مسار حقيقي (مطابقة، إعادة تعيين، اختيار العميل اليدوي)
كان بيعتمد على القايمة الضيّقة دي، الأثر كان بصري/إداري بس (تضليل الأدمن)، مش خلل في التوزيع الفعلي.

**الإصلاح**: الكارت اتشال بالكامل من `/catalog/services/:id` (`apps/admin`). الـbackend
(`listEligibleTechnicians`/`assignTechnician`/`removeTechnician` في `AdminCatalogService`) اتسيّب
زي ما هو (نفس فلسفة §29.2 — إضافي، مش بديل)، بس بتعليق واضح يوضّح حدوده عشان محدّش يستخدمه تاني
كمصدر أهلية. تفاصيل كاملة: `docs/08-pricing-engine-and-platform-vision.md` §30.

## هيكل الحجز الجديد — `allows_individual`/`allows_team` (صُنّاع، `docs/06` §1، `docs/07` الجزء أ)

عمودين جداد على `services` (migration `0051`, `Boolean default true/false` بالترتيب) — نفس نمط `allows_scheduling`/`allows_emergency` الموجودين بالحرف: الأدمن يحدد لكل خدمة هل بتدعم وضع "أفراد" (شغل سريع، فرد واحد بالكتير اتنين) و/أو وضع "اعتماد" (شغل كبير محتاج فريق/شركة). إدارة كاملة من `/admin/services` الموجود أصلاً (`CreateServiceDto`/`UpdateServiceDto`/`AdminServiceResponseDto` — مفيش endpoint جديد).

- **`GET /services?booking_mode=individual|team|emergency`** (جديد، عام) — فلترة على `allows_individual`/`allows_team`/`allows_emergency` بالترتيب. `apps/customer-app`'s `BookingModeScreen` (أول شاشة بعد تسجيل الدخول) بتبعت الفلتر ده لـ`ServicesScreen` بعد ما العميل يختار نوع الحجز.
- **قرار معماري لفجوة موثّقة صراحة** (docs/06 §5 #1 — هل كاتيجوريز "اعتماد" منفصلة عن "أفراد"؟): **لأ، نفس `service_categories`/`services` الموجودة**. صاحب المشروع نفسه قال صراحة "مش فارق أنا بالنسبة لي التلاتة موجودين في أول صفحة" — فبنى شجرة كتالوج تانية بالكامل كان هيكرر جهد من غير داعي واضح. لو ظهر مستقبلاً احتياج فعلي لكاتيجوريز مخصوصة "اعتماد" بس (مثلاً تسعير مختلف جذريًا مش مجرد فلتر)، القرار ده قابل للمراجعة وقتها.
- تفاصيل كاملة لاستهلاك الفلتر ده في إنشاء الطلب (`booking_mode` على `orders`، والتحقق إن الخدمة بتدعم الوضع المختار) في `../orders/README.md`.

## بيانات قياسية للخدمات + محرك الإنتاجية — صُنّاع (`docs/06` §3.1-§3.6، `docs/07` الجزء ج)

جدول جديد `service_standard_data` (migration `0054`) — صفوف متعددة لكل خدمة (نفس نمط `service_addons`/`service_zone_pricing` بالحرف)، كل صف بيمثّل "نوع تنفيذ" (مثلاً محارة داخلي/خارجي/أسقف — `execution_type_ar`، افتراضي `'عام'` للخدمات اللي مالهاش أنواع فرعية) بـ: يومية الصنايعي/المساعد (بالقرش)، الإنتاجية اليومية (`productivity_per_day`)، الحد الأدنى للعمالة (`min_technicians`/`min_assistants`). **الجدول فاضي عمداً** — مفيش seed تلقائي من أرقام الفيديو المرجعي في `docs/06` §3.1، لأنها أرقام تجريبية غير مؤكدة والقاعدة الحاكمة في `CLAUDE.md` واضحة ("مفيش اختراع أرقام عمل من غير أساس"). إدارة كاملة عبر `/admin/services/:id/standard-data` (`POST`/`PATCH`/`DELETE`، نفس نمط الإضافات بالحرف، `catalog.manage`).

### محرك الإنتاجية — `POST /services/:id/estimate-duration` (عام)

بيرجّع **المدة المتوقعة بس** (`docs/06` §3.5) — التكلفة الداخلية (`internal_labor_cost_cents`) بتتحسب داخليًا في `CatalogService.estimateDuration()` لكن **مش بترجع في الـ response العام أبداً** (§3.6 صريح: "الرقم ده داخلي بس... مش المفروض يظهر للعميل النهائي") — الفصل ده على مستوى الـ TypeScript `interface` نفسه (`DurationEstimate` بدون تكلفة، `DurationEstimateWithInternalCost extends` بيها)، مش بس اتفاق توثيقي.

- **الصيغة**: `estimated_days = ceil(requested_units ÷ effective_productivity)`، حيث `effective_productivity = productivity_per_day × (assigned_technicians ÷ min_technicians)` — مثال المصدر بالحرف: 150م² ÷ 30م²/يوم = 5 أيام؛ 250م² = 8.3 يوم → **9 أيام** (تقريب لأعلى دايمًا). ضِعف عدد الصنايعية (2 بدل 1) على نفس الـ150م² رجّع 3 أيام (150÷60=2.5→3)، إثبات إن التوسعة شغالة.
- **قرار موثّق صراحة**: المصدر الأصلي (`docs/06` §3.3) بيدّي مثال واحد بس محدد لتأثير المساعدين ("فرد+مساعدين اتنين = إنتاجية أعلى")، ومش بيدّي صيغة عامة لأثر كل صنايعي/مساعد إضافي — المالك نفسه قال "طبعا ليها حسابات، الحساب مش موجود حاليا". النموذج الخطي البسيط فوق (الإنتاجية بتتناسب طرديًا مع نسبة عدد الصنايعية المُعيَّن) قرار عمل موثّق صراحة كتبسيط قابل للمراجعة، **مش** الصيغة النهائية المؤكدة.
- **§3.4 مُطبّق حرفيًا**: طلب بعدد عمالة أقل من `min_technicians`/`min_assistants` بيترفض `400` بوضوح ("الشغلانة دي محتاجة X صنايعي + Y مساعد على الأقل") — مش تحذير، رفض فعلي.
- **`standard_data_id` لازم يبقى بتاع نفس الخدمة (`:id` في المسار)** — بيترفض `404` واضح لو مش كده، مش افتراض ضمني.
- **اتعمله اختبار حي كامل**: بيانات قياسية حقيقية (محارة داخلي، يومية 700/500ج، إنتاجية 30م²/يوم، حد أدنى 1+1) — 150م² رجّعت 5 أيام بالظبط، 250م² رجّعت 9 أيام بالظبط (تطابق تام مع أمثلة المصدر)، ضِعف الصنايعية رجّعت 3 أيام، وصف تاني بحد أدنى 3 صنايعي رفض تعيين صنايعي واحد بوضوح. اتأكد إن `internal_labor_cost_cents` مش موجود في الـ response العام خالص (`'internal_labor_cost_cents' in response == False`).

### `GET /services/:id/standard-data` جديد + ربط `apps/customer-app` — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

**الفجوة اللي اتلقطت**: `POST /services/:id/estimate-duration` (فوق) محتاجة `standard_data_id` — بس مفيش أي endpoint عام كان بيوفّر للعميل إيه الـids دي أو إيه نوع التنفيذ/الوحدة بتاعتهم، فمستحيل عملياً إن أي عميل حقيقي يستخدم `estimate-duration` من غير ما يدخل الـid يدوياً (من Postman/curl). الحل: `GET /services/:id/standard-data` (`@Public()`) جديد بيرجّع `{id, execution_type_ar, unit_ar}[]` بس (نفس فلسفة استبعاد التكلفة الداخلية فوق — الأجور/الإنتاجية/الحد الأدنى مُستبعدين هنا كمان، مش محتاجينهم للعميل).

`CreateOrderScreen` (customer-app) بقى فيها قسم "المدة المتوقعة (اختياري)" لخدمات `pricing_model != formula` (مستقل تمامًا عن محرك التسعير الديناميكي — نظامين منفصلين عمدًا، راجع `pricing/README.md`) — بيظهر بس لو الخدمة عندها `service_standard_data` فعلاً (قايمة فاضية = القسم مختفي بهدوء، مفيش رسالة خطأ). لو أكتر من نوع تنفيذ، dropdown لاختيار الواحد المناسب؛ حقل كمية (بوحدة `unit_ar` الصح)؛ معاينة حية مُدبّاسة (debounced) للمدة المتوقعة. **معلوماتي بحت، مأثّرش على السعر خالص** (§3.6 صريح).

**اتأكد حي بالكامل عبر curl**: خدمة "سباكة بيت كامل" الحقيقية (عندها صفّين `service_standard_data` فعليين) — `GET /standard-data` رجّع الصفّين بالشكل المتوقع بالحرف، `POST /estimate-duration` بـ`standard_data_id` حقيقي و`requested_units:20` رجّع `estimated_days:1` صح. حالات سلبية: `standard_data_id` بتاع خدمة تانية → `404` واضح؛ خدمة `fixed` جديدة من غير أي `service_standard_data` → `GET /standard-data` رجّع `[]` نظيف (مش خطأ). بيانات الاختبار اتعملها soft-delete بعد التأكيد.

## تاريخ سريان لتسعير المناطق — `valid_from`/`valid_until` — كانت فجوة موثّقة، اتقفلت (صُنّاع، `docs/06` §3.10، `docs/07` الجزء د)

**اكتشاف مهم قبل أي كود**: `service_zone_pricing.valid_from`/`valid_until` (`timestamptz`) كانوا موجودين فعليًا من أول يوم (`infra/migrations/0006_catalog.sql`) — نفس فئة `service_level_pricing`/`service_addons` (أعمدة/جداول "خامدة" اتوثّقت فوق) — **من غير أي mapping في الـ entity ولا استخدام في الكود قبل كده**. مفيش migration جديدة اتضافت هنا، بس الكود اللي بيستخدمهم.

- **`PUT /admin/services/:id/zone-pricing`** بقى ياخد `valid_from` اختياري: من غيره أو بتاريخ ماضي/حالي = تعديل بأثر فوري (upsert في مكان الصف الساري حاليًا، زي زمان بالظبط). تاريخ **مستقبلي** = جدولة سعر جاي — الصف الساري الحالي بيتقفل تلقائيًا عند نفس لحظة السريان الجديدة (`valid_until` بتتحدد له)، وصف جديد منفصل بيتفتح من عندها. الاتنين بيتحفظوا كتاريخ، مفيش أي صف بيتكتب فوقه.
- **`CatalogService.estimate()`** بيختار الصف اللي `valid_from <= الآن < valid_until` (أو `valid_until IS NULL`) — مش أي صف `is_active=true` عشوائي زي ما كان قبل كده (كان بيفترض ضمنيًا صف واحد بس نشط لكل زوج خدمة/منطقة).
- **الجزء التاني من طلب المالك ("الطلبات القديمة تفضل بأسعارها الأصلية") كان متحقق بالفعل هيكليًا من غير أي تغيير**: `orders.estimated_price_cents`/`total_amount_cents` بتتخزن على الطلب نفسه وقت الإنشاء (`orders.service.ts`)، ومفيش أي إعادة حساب لاحقة من `service_zone_pricing` — تغيير سعر منطقة (فوري أو مجدول) مبيأثرش على طلبات قديمة أصلاً بحكم التصميم الموجود.
- **اتعمله اختبار حي كامل**: تسعير فوري (400ج) طُبّق فورًا على `estimate`؛ جدولة سعر (500ج) بعد سنة كاملة — `estimate` النهاردة **فضل يرجّع 400ج** (السعر المستقبلي لسه ما بدأش)، والصف القديم اتأكد إن `valid_until` اتضبط تلقائيًا لنفس لحظة سريان الجديد.

## محرك الإنتاجية الذاتي التعلّم — `service_productivity_actuals`/`service_productivity_suggestions` (صُنّاع، `docs/06` §3.9، `docs/07` الجزء د)

المالك اعتبره "أهم إضافة على الإطلاق": بعد كل شغلانة، تسجيل المساحة/الوقت/عدد العمالة **الفعليين** (مش النظريين) عشان تتجمع بيانات حقيقية بمرور الوقت، وبعدين استخدامها لاقتراح تحديث الرقم القياسي.

### مرحلة 1 (migration `0056`) — تسجيل، يدوي بس وقتها

`POST/GET /admin/services/standard-data/:standardDataId/actuals` — تسجيل/عرض. `computed_productivity_per_day` (`actual_units ÷ actual_days`) بيتحسب ويترجع مباشرة للمقارنة اليدوية بالرقم القياسي. **اتعمله اختبار حي**: شغلانة محارة داخلي (قياسي 30م²/يوم) اتسجّلت بـ150م²/4أيام حقيقيين → `computed_productivity_per_day=37.5` بالظبط.

### مرحلة 2 (migration `0077`، 2026-08-13) — ✅ خلصت: التقاط تلقائي + اقتراح + موافقة الأدمن

كانت فجوة موثّقة صراحة: "تسجيل يدوي فقط، لسه مش مربوطة تلقائيًا بالطلبات... مفيش automatic learning من completed orders ولا suggested standard update." الـpipeline الكامل دلوقتي في `productivity-learning.service.ts` (`ProductivityLearningService`):

1. **التقاط تلقائي** (`captureFromCompletedOrder()`، بيتنادى من `OrderCompletedProductivityCaptureListener` على `ORDER_STATUS_CHANGED_EVENT` لحظة ما طلب بـ`standard_data_id` يوصل `COMPLETED`) — صف `service_productivity_actuals` جديد بـ`source='system_auto'` تلقائيًا، من غير أي تدخل يدوي:
   - `actual_units` من `orders.requested_units` (عمود جديد، migration `0077` — snapshot للوحدات المطلوبة وقت الحجز، مكانش متسجّل على الطلب نفسه قبل كده رغم إنه بيتحسب وقت `estimateDuration()`).
   - `actual_days` من فرق `work_started_at`/`work_completed_at` (يوم واحد على الأقل).
   - `actual_technicians`/`actual_assistants` من عدد `order_team_members` الفعليين + قائد الطلب.
   - فشل الالتقاط (بيانات ناقصة، نادر) بيتسجّل بس ومايكسرش دورة إكمال الطلب.
2. **تجميع دوري** (`generateSuggestions()`، فحص كل ساعة عبر `setInterval` — نفس فلسفة `OrderAutoCancelService`، مش BullMQ، عشان الاستقلال عن مشكلة Worker/Redis reconnection الموثّقة في `../technicians/README.md`؛ `POST /admin/services/productivity-suggestions/generate` بيسمح بفحص فوري كمان): لكل `service_standard_data` نشطة، بيجمع observations `system_auto` الجديدة (بعد آخر اقتراح، أو كلها لو مفيش)، لو العدد ≥ `productivity_learning.min_sample_size` (افتراضي 5، `/settings`) بيحسب **median** معدّل الإنتاجية المُطبّع على أساس `min_technicians` (عكس صيغة `estimateDuration()`'s `effectiveProductivity` بالظبط، عشان يتقارن مباشرة بـ`productivity_per_day`)، ولو الفرق عن القيمة الحالية ≥ `productivity_learning.min_change_percentage` (افتراضي 5%) بيولّد اقتراح `pending` جديد — مع `confidence_score` استرشادي (0-1، مبني على حجم العينة + ثبات القيم، **مش قرار آلي**). بيتجاهل `service_standard_data` لو عندها اقتراح `pending` بالفعل (مفيش تراكم).
3. **موافقة/رفض الأدمن الصريحة** (`POST /admin/services/productivity-suggestions/:id/approve|reject`) — **مفيش تحديث تلقائي لـ`productivity_per_day` بلا موافقة صريحة أبدًا**؛ الموافقة بتحدّث الرقم القياسي فورًا + `audit_log` (`productivity_suggestion.approved`، بالقيمة القديمة/الجديدة). `GET /admin/services/productivity-suggestions?status=pending` لعرض قايمة الانتظار.

**اتعمله اختبار حي كامل** عبر curl مباشر ضد Postgres حقيقي: 5 صفوف `system_auto` (38/39/40/41/42 م² في يوم واحد بفني واحد، رقم قياسي حالي 30) → `generate` ولّد اقتراح واحد بـ`median=40` بالظبط، `sample_size=5`، `confidence_score=0.538` (اتحقق يدويًا بنفس الصيغة). إعادة تشغيل `generate` رجّعت `created:0` (مفيش تكرار لاقتراح `pending` موجود). الموافقة حدّثت `productivity_per_day` من 30 لـ40 بالظبط + سجّلت `audit_log` صح، ومحاولة موافقة تانية على نفس الاقتراح اترفضت 409 ("الاقتراح ده اتراجع بالفعل").

## اختيار الفني قبل الحجز — صُنّاع (`docs/08` §3) — ✅ خلص

كانت فجوة موثّقة صراحة: العميل مبيشوفش قايمة فنيين خالص للحجز العادي (فرد) — auto-match تلقائي بالكامل، الاستثناء الوحيد كان اختيار **شركة** (مش فرد) في وضع "اعتماد". المالك طلب صراحة: العميل يبحث/يقارن/يختار الفني بنفسه، الترتيب دايمًا "الأحسن فوق" (تقييم → قرب → عدد نقط).

- **`GET /services/:id/technicians?address_id=...`** (عام، `CatalogController` — مش `TechniciansController`، لأنه سؤال "مين يقدر يعمل الخدمة دي في المنطقة دي" مش سؤال عن فني بعينه). `TechniciansService.listForServiceBooking()` (جديدة): بيحل `address_id` لمدينة/منطقة خدمة (نفس `GeoService.findZoneForPoint()` المستخدمة في إنشاء الطلب بالظبط، مش منطق مكرر)، بعدين استعلام PostGIS حقيقي (`ST_Distance` على `current_location` الفعلي للفني، مش تقريب) لكل فني مؤهّل (`technician_services`+`technician_zones` نشطين، `verification_status=approved`).
- **الترتيب مطابق تمامًا لطلب المالك**: `ORDER BY average_rating DESC, distance_km ASC NULLS LAST, service_completed_count DESC`. `service_completed_count` من `technician_services.completed_count` (خاص بالخدمة دي بالذات، مش إجمالي الفني — أدق لقياس خبرته في الحرفة دي تحديدًا؛ كانت فجوة إحصائية اتقفلت سابقًا، راجع `../technicians/README.md`).
- كل صف بيرجّع: اسم، صورة، بايو مختصر، تقييم، عدد التقييمات، عدد الطلبات المكتملة (لنفس الخدمة)، المسافة بالكيلومتر — مطابق تمامًا للحقول اللي المالك طلبها ("اسم، صورة، تقييم، عدد طلبات، بايو مختصر").
- العميل يدوس على فني من القايمة → يشوف بروفايله الكامل (`GET /technicians/:id/profile`، موجود من قبل) → يشوف سلوتاته الفاضية (`GET /technicians/:id/schedule`، §2) → يحجز.
- **اتعمله اختبار حي**: خدمة حقيقية عندها فنيين اتنين مؤهلين — واحد بتقييم 4 و4 طلبات مكتملة (من بيانات اختبار حقيقية سابقة في نفس السيشن)، التاني بتقييم 0 و0 طلبات — القايمة رجّعت الأول فوق التاني بالظبط زي ما مطلوب. عنوان غير موجود اترفض بوضوح، `address_id` ناقص اترفض من الـDTO مباشرة.

## تحسينات الطوارئ — رسوم صريحة + SLA معلن — صُنّاع (`docs/08` §8) — ✅ خلص جزئيًا

فوق اللي كان خلص من قبل (بث لكل الفنيين بتجاهل `is_available`، دفعة أكبر، إشعار فوري للأدمن، عمولة داخلية إضافية). **اكتشاف قبل أي كود**: `orders.surge_amount_cents` عمود راكد من migration `0007` الأولى (معرّف بس معمول عليه أي استخدام خالص) — بيتفعّل هنا كـ"رسوم الطوارئ الصريحة"، **مختلفة تمامًا** عن `commission.emergency_adjustment_percentage` (migration `0052`) اللي عمولة داخلية بين المنصة والفني مش رسوم على العميل.

- **`CatalogService.estimate()` بقت تاخد `isEmergency` اختياري** — لو `true`، بترجّع `emergency_surcharge_cents` (نسبة `pricing.emergency_surcharge_percentage` مئوية على السعر التقديري، إعداد جديد قابل للتعديل من `/admin/settings` الموجود، مفيش endpoint جديد) و`emergency_sla_minutes` (رقم معلن للعميل "هيوصلك خلال X دقيقة" — إعداد `emergency.sla_minutes`، **مش ETA محسوب من مسار/زحمة فعلية**، بس وعد معلن قابل للتعديل). القيمتين الافتراضيتين (20%، 60 دقيقة) تجريبيتين مش نهائيتين، نفس فلسفة migration `0052` بالحرف.
- **`POST /services/:id/estimate?booking_mode=emergency`** (معاينة قبل التأكيد) و**`POST /orders` بـ`booking_mode=emergency`** (الطلب الفعلي) بيرجّعوا نفس القيمتين — العميل يشوف الرسوم والـ SLA **قبل** ما يأكّد، ونفس القيمة بالظبط بتتقفل في `orders.surge_amount_cents`/`total_amount_cents` وقت الإنشاء (مفيش فرق بين المعاينة والفعلي).
- **نطاق متعمّد لسه برّه — أولوية حقيقية داخل الدفعة نفسها**: الاستعلام في `matching.service.ts`'s `findEligibleTechnicians()` أصلاً بيرتب المرشحين بالمسافة (`ORDER BY distance_km ASC`) وقت اختيار مين يدخل الدفعة (أقرب N فنيين بس، مش عشوائي) — ده موجود من قبل. الجزء الناقص الحقيقي هو **staggering** زمني (الأقرب ياخد فرصة يرد الأول قبل ما العرض يتفتح للباقي) — اتأجل عمداً: بيلمس آلية البث الأساسية (queue-based rounds, مُختبرة ومستقرة)، ومفيش قرار عمل واضح لمدة "الأفضلية" (كام ثانية للأقرب قبل ما يتفتح؟) في المصدر الأصلي، فمش هيتخترع بدون تأكيد صريح.
- **اتعمله اختبار حي**: `POST /services/:id/estimate?booking_mode=emergency` رجّع `emergency_surcharge_cents=100000` (20% من `estimated_total_cents=500000`) و`emergency_sla_minutes=60`؛ نفس الطلب من غير `booking_mode=emergency` رجّع صفر/`null`. طلب حقيقي `booking_mode=emergency` اتعمل → `surge_amount_cents=8000` (20% من `estimated_price_cents=40000`)، `total_amount_cents=48000` بالظبط (40000+8000+0 تفتيش).

## `CatalogService.estimate()` بقت عارفة `pricing_model=formula` — كانت أخطر فجوة تسعير في المشروع، اتقفلت (بناء 2026-08-12)

**البَقّة**: `estimate()` (النقطة الوحيدة اللي `orders.service.ts`/`promotions.service.ts`/`catalog.controller.ts` الثلاثة بينادوها) كانت بتتجاهل `service.pricingModel===formula` بالكامل وتستخدم المسار الثابت (`service.basePriceCents=0` لخدمات formula عمدًا) — يعني أي طلب حقيقي لخدمة formula كان بيتحجز مجانًا بصمت. الحل الكامل (استدعاء `PricingEngineService.evaluate()` لو `fieldValues`/`field_values` موجودة، مع threading كامل من `CreateOrderDto`/`ValidatePromoCodeQueryDto`) وتفاصيل الاختبار الحي الكاملة (2110 قرش مطابق تمامًا لـ`evaluate-price`، رفض واضح `400` بدل صفر صامت، صفر orphan rows) موثّقة بالتفصيل في `../pricing/README.md` قسم "الربط بمسار إنشاء الطلب" — عشان تفادي تكرار نفس التوثيق في مكانين.

## `GET /services/:id/technicians` بقت بترجّع مستوى+سعر نهائي لكل فني — صُنّاع (`docs/08` §3) — قرار عمل صريح من المالك، اتقفلت (بناء 2026-08-13)

**الفجوة**: القايمة (القسم فوق) كانت بترجّع اسم/صورة/تقييم/بايو/مسافة بس — العميل ميكنش يعرف السعر النهائي هيختلف إزاي لو اختار فني `platinum` بدل `new` قبل ما يضغط "اختار". المالك طلب صراحة: كل فني مرشّح لازم يظهر معاه رتبته والسعر النهائي المحسوب فعليًا بيه، **قبل** الاختيار — مفيش مفاجأة سعر بعد التأكيد.

- `TechniciansService.listForServiceBooking()` بقت ترجّع `currentLevel` (`technician_profiles.current_level`) مع كل مرشّح، فوق زون الخدمة نفسها (`zoneId`) اللي كانت بتتحسب جوّاها أصلاً.
- `CatalogController.listTechniciansForService()` (الـ handler الفعلي لـ`GET /services/:id/technicians`) بقى يجيب الخدمة نفسها ويتفرّع: لو `pricingModel===formula` (محتاجة `field_values` من العميل، مش متوفرة وقت قايمة الاختيار) → `final_price_cents:null`/`level_price_multiplier:null` لكل الفنيين (سلوك متعمّد، موثّق كـ"مش نقص" — المضاعف مفهوميًا مش بيتفعّل لخدمات formula أصلًا، `estimate()` بترجّع `level_price_multiplier:1` ثابت ليها بغض النظر عن المستوى). غير كده → `Promise.all` بينادي `catalogService.estimate(service.id, zoneId, item.currentLevel, isEmergency)` لكل مرشّح **بالتوازي**، نفس محرك `estimate()` المُختبر أصلًا، بلا أي تكرار حساب.
- `final_price_cents = estimate.estimated_total_cents + estimate.inspection_fee_cents + estimate.emergency_surcharge_cents` — بيشمل رسوم الطوارئ لو `is_emergency=true` في الطلب.
- **قرار تصميم متعمّد لتفادي coupling جديد بين الموديولات**: `ListTechniciansForServiceDto` بقى فيها `booking_mode?` من نوع `BookingModeFilter` (نفس string-literal type المُكرر عمدًا في `list-services.dto.ts`)، **مش** import مباشر لـ`BookingMode` enum من موديول `orders` — نفس الاتفاقية الموجودة بالفعل في نفس الملف.
- **اتأكد حي**: خدمة `fixed` أساسها 1000 ج.م.، فني `premium` (مضاعف `ServiceLevelPricing` = 1.20) ظهر في القايمة بـ`final_price_cents:120000`/`level_price_multiplier:1.20` — مطابق تمامًا لناتج `/orders/preview` وللطلب الفعلي بعدين (تفاصيل كاملة في `../orders/README.md`).

## `cover_image_url`/`icon_url` بقوا معروضين للعميل — Script 6 Part 1-2 (2026-08-19)

**الفجوة**: `service_categories.cover_image_url` موجود في الـschema من migration 0006 القديمة
(نفس الوقت اللي `icon_url` اتضاف فيه)، بس مفيش أي DTO أدمن أو عميل استخدمه خالص — الأدمن ماكانش
عنده حتى حقل فورم يحطه بيه، والعميل ماكانش شايف صورة فئات خالص في `apps/customer-app` (كروت
نص مركزي بس). كمان `services.icon_url` كان معروض للأدمن (`AdminServiceResponseDto`) بس مش
للعميل (`ServiceResponseDto` كان ناقصه تمامًا).

**الإصلاح**:
- `ServiceCategory` entity: عمود `coverImageUrl` جديد (map لـ`cover_image_url` الموجود بالفعل).
- `CreateServiceCategoryDto`/`UpdateServiceCategoryDto` (partial تلقائي): `cover_image_url?`
  اختياري، نفس نمط `icon_url` بالحرف.
- `AdminServiceCategoryResponseDto`/`ServiceCategoryResponseDto` (العام): `cover_image_url`
  مضاف للاتنين. `ServiceResponseDto` (العام): `icon_url` مضاف (كان في نسخة الأدمن بس).
- `apps/admin/src/app/catalog/page.tsx`: حقل نص جديد "رابط صورة الغلاف" في فورمي إنشاء/تعديل
  الفئة، نفس نمط `icon_url` (رابط نصي، مش رفع ملف — قرار قائم بالفعل للأيقونة، اتبع نفسه هنا
  بدل ما نخترع نمط رفع جديد).
- `packages/shared-types/src/catalog.ts`: `cover_image_url` مضاف لـ`AdminServiceCategoryResponseDto`/
  `CreateServiceCategoryBody`.

**اتأكد حي**: فئة حقيقية اتزرعت بـ`cover_image_url`/`icon_url` الاتنين، `GET /service-categories`
رجّع الاتنين مطابقين تمامًا. خدمة حقيقية اتزرعت بـ`icon_url`، `GET /services?category_id=...`
رجّعه صح. بيانات الاختبار اتنضّفت بعدين.

تفاصيل استخدام العميل الكامل (كروت الفئات/صفوف الخدمات في `apps/customer-app`) في
`apps/customer-app/README.md`.

## تسعير المنطقة كمُعدِّل نسبي — `pricing_mode='percentage'` (docs/08 §36.22-23، ADR-0024)

تدقيق حي أثبت إن `service_zone_pricing.price_cents` كان دايمًا استبدال ثابت مطلق — لو الأدمن غيّر
`base_price_cents` بتاع الخدمة بعدين، أي منطقة عندها override تفضل مسمّرة على السعر القديم للأبد
بلا أي تنبيه. التفاصيل الكاملة والبدائل المرفوضة في `docs/adr/0024-zone-price-percentage-modifier.md`.

- **`pricing_mode` جديد** (enum، افتراضي `override` — صفر تغيير سلوك للصفوف الموجودة): `override`
  (السلوك القديم بالحرف، `price_cents` رقم مطلق) أو `percentage` (`modifier_percentage` نسبة مئوية
  فوق `service.base_price_cents` **وقت الحساب نفسه** — `effective_base = round(base_price_cents * (1 + modifier_percentage/100))`،
  فبيتحدّث تلقائيًا مع أي تغيير في السعر الأساسي).
- **`price_cents` بقى Nullable**، **`modifier_percentage` عمود جديد Nullable** — CHECK constraint
  في الداتابيز يمنع أي صف يخلط الاتنين أو يسيبهم فاضيين. `surge_multiplier`/تاريخ السريان بلا أي
  تغيير (بيتطبّقوا فوق الناتج سواء override أو percentage).
- **`CatalogService.estimate()`**: فرع جديد لحساب `effective_base` لـ`percentage` قبل `surge`/
  `level_price_multiplier` — الباقي (formula pricing model، بلا zone override خالص) بلا أي تغيير.
- **`apps/admin`**: فورم تسعير المنطقة (`catalog/services/[id]`) بقى فيه اختيار وضع صريح (radio/select)،
  الجدول بيعرض "+15% من السعر الأساسي" بدل رقم لو الوضع percentage.
- **اختبار حي جديد** (`zone-pricing-percentage-modifier.spec.ts`، 4/4): override بيتصرف بالظبط زي
  الأول (رجريشن)، percentage بيتحسب صح، تغيير السعر الأساسي بينعكس تلقائيًا، صفر zoneId = سعر
  أساسي عادي بلا أي تعديل.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.

## فئة تسعير الفني — `technician_profiles.pricing_tier` (docs/08 §36.24، ADR-0025)

تدقيق حي أثبت إن `service_level_pricing.technician_level` مربوط مباشرة بـ`TechnicianLevel` التشغيلي
(نفس العمود المستخدم لحد القرار المالي، أولوية المطابقة، أهلية "اعتماد"، والـKPI). طلب المالك فئة
تسعير تجارية منفصلة تمامًا. التفاصيل الكاملة والبدائل المرفوضة في `docs/adr/0025-technician-pricing-tier.md`.

- **`TechnicianPricingTier` enum جديد بالكامل** (`standard`/`expert`/`senior`/`premium`) — أسماء
  مختلفة عمدًا عن `TechnicianLevel` (صفر تشابه حتى في التسمية).
- **`technician_profiles.pricing_tier` عمود جديد** (افتراضي `standard` لكل الصفوف — صفر اشتقاق
  تلقائي من `current_level`، الأدمن لازم يصنّف صراحة عبر `PATCH /admin/technicians/:id/pricing-tier`).
- **`service_pricing_tier_pricing` جدول جديد** (مرآة كاملة لـ`service_level_pricing`: service_id،
  pricing_tier، price_multiplier، is_active) — صفر تعديل على الجدول القديم.
- **`CatalogService.resolveLevelPriceMultiplier()`**: فرع أولوية جديد — فئة تسعير نشطة (لو الفني
  عنده `pricingTier` وفيه صف نشط) → **غير كده fallback كامل** لتسعير المستوى القديم → مضاعف=1 لو
  مفيش أي صف. `estimate()` بقى ياخد `technicianPricingTier?` كباراميتر إضافي اختياري (آخر باراميتر
  عمدًا، صفر كسر لأي كولر موجود).
- **`GET /services/:id/estimate`**: `pricing_tier` query param جديد اختياري جنب `technician_level`
  الموجود. **`orders.service.ts`/`catalog.controller.ts`'s `listTechniciansForService`**: تمرير
  `technician.pricingTier` جنب `technician.currentLevel` — بمجرد ما أدمن يضيف صف تسعير-فئة، بيتفعّل
  تلقائيًا في كل مسارات التسعير الحقيقية بلا كود إضافي.
- **إدارة الفئة نفسها**: `GET/PUT /admin/services/:id/pricing-tier-pricing`،
  `DELETE /admin/services/pricing-tier-pricing/:pricingId` (نفس نمط level-pricing بالحرف).
- **`apps/admin`**: قسم "فئة التسعير" في بروفايل الفني (منفصل عن قسم "المستوى") + فورم "فئة تسعير
  الفني" جديد في صفحة تفاصيل الخدمة.
- **اختبارات حية جديدة**: `technician-pricing-tier.spec.ts` (4/4 — الفئة تغلب المستوى، fallback
  للمستوى من غير فئة، رجريشن كامل لخدمة من غير أي صف فئة، فئة بلا صف نشط = مضاعف 1)،
  `../technicians/technician-pricing-tier-assignment.spec.ts` (3/3 — استقلال `changePricingTier()`/
  `changeLevel()` في الاتجاهين + 409 لنفس الفئة).

## `services.cash_allowed` — أول قدرة دفع على محرك الحجز الموحّد (docs/08 §42 Phase A.1، ADR-0026)

طلب مالك استراتيجي كبير (docs/08 §42): توحيد حجز الخدمة العادية/الشغالة/المتكرر في محرك حجز واحد
قابل للتهيئة عبر أعلام قدرة على `Service`، بدل مسار منفصل لكل نوع خدمة غريب. الشريحة الأولى
(Phase A.1) اختارت أصغر تغيير حقيقي وآمن: تدقيق حي أثبت صفر `cash_allowed`/`deposit_required` في
السكيما كلها — أي خدمة بتقبل كاش افتراضيًا بلا أي فحص، والاستثناء الوحيد (حجز الشغالة) بيحقق "مفيش
كاش" بمساره المنفصل بالكامل مش بسياسة على المسار المشترك. التفاصيل والبدائل المرفوضة في
`docs/adr/0026-service-capability-model-payment-policy.md`.

- **`services.cash_allowed` عمود جديد** (`boolean NOT NULL DEFAULT true`، migration 0163) — نفس
  نمط `allows_individual`/`allows_team` بالحرف: علم مباشر على `Service`، مش جدول تهيئة منفصل ولا
  enum `payment_policy` (زيادة سابقة لأوانها — الإيداع/الدفع الجزئي لسه مالوش تصميم تسوية حقيقي،
  Phase A.3 مؤجّلة). الافتراضي `true` عمدًا — صفر تغيير سلوك لأي خدمة موجودة.
- **`OrdersService.create()`**: فحص جديد فور تحميل الخدمة (جنب فحص `allows_individual`/`allows_team`
  بالظبط) — لو `!dto.payment_method` (كاش ضمنيًا، نفس منطق `requestedPrepayMethod`) و`!service.cashAllowed`
  والطلب مش إعادة زيارة تحت الضمان (`original_order_id` — مجانية بالكامل دايمًا، مفيش كاش فعلي
  يتحصّل أصلاً)، يترفض `VAL_001` وقت الإنشاء — مش بعد ما الفني يوصل ويكتشف إنه ملوش طريقة يقبض.
- **`apps/admin`**: checkbox جديد "يسمح بالدفع كاش" في نفس فورم "تفاصيل الخدمة" الموجود
  (`catalog/services/[id]/page.tsx`)، مش شاشة منفصلة.
- **`packages/shared-types`**: تمديد `AdminServiceResponseDto`/`CreateServiceBody`/`UpdateServiceBody`.
  الحقل معروض للعميل كمان (`ServiceResponseDto` في `apps/api`) — تحضيرًا لواجهة الحجز تخفي خيار
  الكاش لو الخدمة قافلاه، بلا استدعاء تاني.
- **اختبار حي جديد**: `orders/service-cash-allowed.spec.ts` (3/3 — كاش على خدمة `cash_allowed=false`
  يترفض، نفس الخدمة بـ`payment_method=card` صراحة تتسجّل عادي، خدمة عادية بالافتراضي `true` لسه
  بتقبل كاش زي ما كانت بالظبط — رجريشن صفري لكل الخدمات الموجودة).
- **خارج نطاق الشريحة دي عمدًا**: صفر لمس لـ`domestic_worker_bookings` (Phase A.4)، صفر إيداع/دفع
  جزئي (Phase A.3، خلصت تحت) — التفاصيل الكاملة والترتيب المرحلي في `docs/08` §42.

## `services.deposit_required`/`deposit_percentage` — سياسة إيداع (docs/08 §42 Phase A.3، ADR-0027)

تصميم "دفعة مقدّمة + باقي لاحقًا" اللي Phase A.1 أجّلته عمدًا (مفيش تصميم تسوية كافٍ وقتها). الحل
النهائي: **صفر آلية تحصيل جديدة** — الإيداع هو ببساطة أول دفعة أقل من الإجمالي، والباقي (الدلتا)
بيتحصّل تلقائيًا عبر نفس آلية `AWAITING_PAYMENT`/`PaymentsService.settleAlreadyPaidOrder()` الموجودة
بالفعل لتحصيل البند الإضافي (ADR-0015). التفاصيل والبدائل المرفوضة في
`docs/adr/0027-service-deposit-policy.md`.

- **`services.deposit_required`** (`boolean NOT NULL DEFAULT false`) + **`services.deposit_percentage`**
  (`numeric(5,2)` nullable، محصور 1-99 بـCHECK constraint، migration 0164) — نفس نمط `cash_allowed`
  بالحرف: علمين مباشرين على `Service`، مش enum واحد (الاتنين مستقلين حقيقة — خدمة ممكن تمنع الكاش
  بالكامل من غير إيداع، أو العكس).
- **`orders.deposit_amount_cents`** (`integer` nullable) — snapshot بالجنيه محسوب وقت إنشاء الطلب
  (بعد كل الخصومات)، مش مربوط ديناميكيًا بنسبة الخدمة بعدين (نفس فلسفة `standardDataId` snapshot).
- **`OrdersService.create()`**: خدمة `deposit_required=true` لازم دفع مقدّم إلكتروني إجباري (كاش
  مينفعش يتقسّم فعليًا) — نفس فحص `cash_allowed` بالحرف بس مستقل عنه. `previewPrice()` بترجّع نفس
  التفصيل (`deposit_amount_cents`/`due_now_cents`/`remaining_amount_cents`) قبل التأكيد.
- **`PaymentsService.amountOwedNow()` — السطر الحرج الوحيد اللي الميزة كلها محتاجاه**: الحالة
  الافتراضية غير-المدفوعة بترجع `order.depositAmountCents ?? order.totalAmountCents` بدل
  `totalAmountCents` دايمًا. أول دفعة (وقت `PENDING_PAYMENT`) بتحصّل الإيداع بس؛ الباقي بيتحصّل
  تلقائيًا لما الطلب يوصل `WORK_COMPLETED` عبر نفس مسار الدلتا — **وممكن يتحصّل كاش** حتى لو
  الإيداع كان إلكتروني إجباري (الباقي بعد الشغل يدًا بيد زي أي دلتا تانية).
- **`apps/admin`**: checkbox "محتاجة إيداع مقدّم" + حقل "نسبة الإيداع %" في نفس فورم "تفاصيل
  الخدمة" (جنب `cash_allowed`)، مش شاشة منفصلة.
- **`packages/shared-types`**: تمديد `AdminServiceResponseDto`/`CreateServiceBody`/`UpdateServiceBody`.
- **اختبار حي جديد**: `orders/service-deposit-policy.e2e.spec.ts` — كاش على خدمة `deposit_required=true`
  يترفض، كارت يتسجّل `PENDING_PAYMENT` بمبلغ إيداع محسوب صح (30% من الإجمالي)، `amountOwedNow()`
  ترجع مبلغ الإيداع قبل أي دفع والدلتا الصحيحة بعد ما الإيداع يتحصّل، `previewPrice()` بتطابق
  `create()` بالحرف، ورجريشن لخدمة `deposit_required=false` (الافتراضي).
- **خارج نطاق الشريحة دي عمدًا**: صفر لمس لـ`domestic_worker_bookings` (Phase A.4) أو توزيع أرباح
  الطاقم للشركات (Phase B.3).

## `services.allows_date_range_booking` — قدرة "نطاق أيام مرن" (docs/08 §42 Phase A.2، ADR-0028)

"مرن — اختار نطاق أيام" (`scheduled_at_range_end`، docs/08 §32.3) كانت موجودة ومختبرة حيًا من قبل
— الشريحة دي حوّلتها من "متاحة لكل خدمة بلا شرط" لقدرة صريحة قابلة للإقفال، **بلا أي لمس لمنطق حل
النطاق نفسه** (`OrdersService.create()`، `TechniciansService.hasEligibleTechnicianForDate()`).
التفاصيل الكاملة والبدائل المرفوضة في `docs/adr/0028-service-date-range-booking-capability.md`.

- **`services.allows_date_range_booking` عمود جديد** (`boolean NOT NULL DEFAULT true`، migration
  0165) — نفس نمط `cash_allowed`/`deposit_required` بالحرف. **الافتراضي `true` عمدًا** (مختلف عن
  `deposit_required`): الخيار متاح فعليًا لكل خدمة اليوم بلا فحص، فالعلم ده تحويل الوضع الحالي لقدرة
  صريحة مش قيد رجعي.
- **`OrdersService.create()`**: فحص جديد جوّه فرع `if (dto.scheduled_at_range_end)` الموجود بالفعل
  — لو الخدمة `allows_date_range_booking=false`، يترفض `VAL_001` قبل ما الحلقة تدوّر على أيام. يوم
  محدد بلا `scheduled_at_range_end` يفضل يشتغل عادي حتى لو الخدمة قافلة القدرة دي.
- **`previewPrice()` صفر تغيير** — نفس نمط `cash_allowed`/`deposit_required` (مش متفحوصين هناك
  كمان)، لأن الجدولة مالهاش أي أثر على السعر أصلاً (`PreviewOrderDto` مالهوش حقل جدولة خالص).
- **`apps/admin`**: checkbox جديد "يسمح بحجز نطاق أيام مرن" في نفس فورم "تفاصيل الخدمة".
- **`packages/shared-types`**: تمديد `AdminServiceResponseDto`/`CreateServiceBody`/`UpdateServiceBody`.
- **`apps/customer-app`**: `CatalogService` model حقل جديد `allowsDateRangeBooking`؛
  `ScheduleSelectionScreen` بقت بتاخد الحقل ده كـparameter إجباري وبتخفي كارت "مرن" لو `false` —
  تجربة استخدام أحسن من رفض بعد الاختيار (نفس فلسفة إخفاء وضع "اعتماد" لو `allowsTeam=false`).
  الاستدعاءين (`catalog_navigation.dart` و`create_order_screen.dart`'s `_pickSchedule()`) اتحدّثوا
  الاتنين.
- **اختبار حي جديد**: `orders/service-date-range-booking-allowed.e2e.spec.ts` (3/3 — نطاق مرن على
  خدمة `allows_date_range_booking=false` يترفض، نفس الخدمة بيوم محدد بس تتسجّل عادي، خدمة عادية
  بالافتراضي `true` تفضل تقبل النطاق المرن زي ما كانت — رجريشن صفري).
- **خارج نطاق الشريحة دي عمدًا**: صفر لمس لـ`domestic_worker_bookings` (Phase A.4).

## [مُلغى] `PricingModel.WORKER_RATE` — نموذج تسعير جديد لهجرة حجز الشغالة (docs/08 §42 Phase A.4 Slice 1، ADR-0029)

**تصحيح لاحق (ADR-0031، 2026-08-21/22)**: القسم ده كله تاريخي — `PricingModel.WORKER_RATE` وموديول
`domestic-workers` كله اتلغيا بالكامل (نظام مزوّد واحد موحّد، مفيش بنية شغالة منفصلة). القدرة اللي
حلّت محله فعليًا هي `PricingModel.HOURLY` **العامة** (موجودة من الأول، مش جديدة) + `durationHours`
باراميتر جديد في `estimate()` — موثّقة في القسم الجديد في آخر الملف ده.

أول شريحة من هجرة حجز الشغالة للمحرك الموحّد — أساس بس، **صفر تغيير سلوك لأي مسار موجود**. القرار
المعماري الكامل (ليه مش `TechnicianProfile`، مين مسؤول عن الحساب، الشرايح الجاية) في
`docs/adr/0029-domestic-worker-unified-booking-migration.md`.

- **`services.pricing_model` قيمة جديدة `worker_rate`** (migration 0166، `ALTER TYPE ... ADD
  VALUE`) — السعر مش من `base_price_cents` الكتالوج خالص، لازم فني (شغالة) يتحدد الأول عشان السعر
  يتحسب من معدّله الشخصي.
- **`CatalogService.estimate()`**: باراميتر اختياري جديد `precomputedWorkerRateCents` (آخر باراميتر،
  نفس نمط `technicianPricingTier`) — لو الخدمة `worker_rate` والباراميتر ده مفقود، يترفض `VAL_001`
  فورًا. لو موجود، بيترجع كـ`estimated_total_cents` بالحرف — **بلا `level_price_multiplier` أو
  `zone override` خالص** (الشغالة مالهاش `TechnicianLevel`، وسعرها هو النهائي المتفق عليه شخصيًا).
  `CatalogService` نفسها ماعندهاش أي علم بـ`DomesticWorkerProfile` عمدًا — حساب `hourlyRateCents ×
  duration_hours` أو `monthlyRateCents` كامل مسؤولية الـcaller (Slice 2، لسه مش منفّذة).
- **`orders.domestic_worker_profile_id`** (nullable FK، migration 0166) — مرجع الفني على الطلب،
  **مش مقروء/مكتوب من أي كود لسه**.
- **اختبار حي جديد**: `catalog/worker-rate-pricing.spec.ts` (3/3 — `precomputedWorkerRateCents`
  مفقودة ترفض، موجودة بترجع بالحرف بلا zone override رغم وجوده على الخدمة، رجريشن لخدمة `fixed`
  عادية صفر تأثير من الباراميتر الجديد).
- **Slice 2a (خلصت)**: `OrdersService.create()` بقت بتاخد `domestic_worker_profile_id`/`duration_hours`
  جديدين — العميل اختار فني (شغالة) بعينه مباشرة (زيرو مطابقة تلقائية، ADR-0004)، الطلب يتسجّل
  `ACCEPTED` فورًا (السعر = `hourlyRateCents × duration_hours`). دفع مقدّم وتأكيد فني صريح مؤجّلين
  عمدًا (تفاصيل كاملة في ADR-0029 §Slice 2a). اختبار حي:
  `orders/domestic-worker-direct-booking.e2e.spec.ts` (5/5).
- **خارج نطاق هذه الشريحة عمدًا**: دفع مقدّم لحجز شغالة، شات (Slice 2c/3)، واجهة Flutter/أدمن
  (Slice 3)، التكرار الشهري عبر `RecurringOrderTemplate` (Slice 4)، وأي تغيير على
  `domestic-workers` module الحالي (صفر لمس بالكامل).

**تصحيح مالك (ADR-0031، 2026-08-21)**: خطة الهجرة فوق (Slice 1/2a) هتتلغي — الاتجاه الصحيح إلغاء
`DomesticWorkerProfile`/`PricingModel.WORKER_RATE` بالكامل، مش نقلهم. راجع
`docs/adr/0031-unified-provider-system-and-avatar-visibility.md`.

## ظهور صورة البروفايل — `CatalogController` بقى محتاج `StorageService` (ADR-0031)

`GET /services/:id/technicians` كان بيرجّع `avatar_url` خام من `users.avatar_url` بلا أي resolve —
لو الفني عنده صورة معتمدة (`users.avatar_storage_key`)، لازم تتفك برابط طازج (presigned S3 URLs
بتنتهي). `CatalogController` بقى فيه `@Inject(STORAGE_SERVICE)` جديد، وبعد ما `TechniciansService.listForServiceBooking()`
ترجع، كل الصفوف بتتحلّ دفعة واحدة (`Promise.all(items.map(resolveAvatarUrl))`) قبل التحويل لـDTO —
صفر تغيير على شكل `TechnicianBookingListItem` نفسه غير حقل `avatarStorageKey` إضافي. تفاصيل كاملة
في `apps/api/src/modules/technicians/README.md`.

## `estimate()` بقى بيضرب سعر الساعة في `duration_hours` لخدمات `pricing_model=hourly` (ADR-0031 Slice H، 2026-08-22)

**فجوة حقيقية اتلقطت واتقفلت** — `PricingModel.HOURLY` قدرة عامة موجودة أصلاً على `Service` من قبل
كل شغل ADR-0031 (مش حاجة جديدة)، لكن `CatalogService.estimate()` ماكانش فيها أي فرع حساب مخصوص ليها
(فرع مخصص موجود بس لـ`FORMULA`) — يعني أي خدمة `hourly` كانت بترجع `base_price_cents` كسعر إجمالي
ثابت، مش سعر ساعة × عدد الساعات فعليًا.

- **الإصلاح**: باراميتر اختياري جديد `durationHours` — آخر باراميتر في `estimate()` (نفس نمط
  `technicianPricingTier` فوقه بالحرف، append-only صفر كسر). لو `service.pricingModel === HOURLY`
  و`durationHours` اتبعتت، السعر الأساسي (سواء من `service.basePriceCents` أو `zone override`)
  بيتضرب فيها **قبل** تطبيق `levelMultiplier`/الطوارئ — نفس ترتيب باقي عوامل السعر تمامًا.
- **الـcallers**: `OrdersService.create()`/`previewPrice()` بيمرروا `dto.duration_hours` (نفس الحقل
  اللي `service.requiresPreciseSchedule` بيتطلّبه — يعني عمليًا الضرب مبيحصلش غير للخدمات اللي
  محتاجة دقة وقت، لأن `duration_hours` مرفوض تمامًا لأي خدمة تانية على مستوى `CreateOrderDto`
  validation، مش على مستوى `estimate()` نفسها. **تحديث (ADR-0032، 2026-08-22)**: `requires_hours_only`
  بقى كمان بيسمح بـ`duration_hours`، فالضرب هنا بيستفيد أوتوماتيك منها بلا أي تعديل — راجع القسم
  تحت). `GET /services/:id/estimate` و
  `GET /services/:id/technicians` (الاتنين `catalog.controller.ts`) بيمرروا `duration_hours` من
  query string كمان — معاينة سعر صحيحة قبل ما العميل يأكّد، نفس فلسفة "مفيش مفاجأة سعر بعد التأكيد".
- **بَقّة بيانات اتلقطت في نفس المراجعة**: seed بيانات "خدمات منزلية" (`migration 0170`) كانت حاطة
  `pricing_model='hourly'` على الأربع خدمات كلهم بما فيهم "تنظيف شهري/إقامة" (سعر شهري ثابت فعليًا،
  مش بالساعة) — لولا `requires_precise_schedule=false` بتاعتها كانت هتمنع `duration_hours` من
  الوصول أصلاً، السعر مكنش هيتأثر عمليًا، لكن `pricing_model` الصحيح دلالياً `fixed`. اتصلحت بـ
  `migration 0171` (تحديث بيانات فقط — `migration 0170` اتعمل commit قبل كده، ما بتتعدلش).
- **اختبار حي جديد**: `catalog/hourly-pricing.spec.ts` (3/3 — خدمة hourly من غير duration_hours
  بترجع السلوك القديم بالحرف، بـduration_hours=3 السعر يتضاعف×3، خدمة fixed بتتجاهل duration_hours
  تمامًا حتى لو اتبعتت غلط).

## أوضاع توقيت الخدمة الأربعة (ADR-0032، 2026-08-22)

`Service` بقى فيها 4 أعلام `boolean` تبادلية (وضع واحد بس فعّال لكل خدمة، `CHECK constraint
chk_services_scheduling_mode_exclusive` على مستوى الـDB): `requiresPreciseSchedule` (موجودة،
ADR-0031 Slice B، صفر تغيير سلوك)، وجداد `requiresStartTimeOnly`/`requiresHoursOnly`/
`requiresStartAndEnd`. القرار الكامل، الأمثلة، والبدائل اللي اتقيّمت في
`docs/adr/0032-service-scheduling-modes.md`.

- **مفيش أي تغيير هنا في `catalog.service.ts`/`estimate()`** — `requiresHoursOnly` بيستفيد
  أوتوماتيك من الضرب الموجود بالفعل فوق (Slice H) لأنه مبني على `pricing_model=hourly` +
  `duration_hours` بس، مش على وضع التوقيت. `requiresStartAndEnd` **مالوش أي أثر على السعر خالص**
  — عمدًا، مفيش ضرب تلقائي بعدد الأيام (مش مطلوب من المالك).
- **`AdminCatalogService.assertSchedulingModeExclusive()`** — تحقق تطبيقي واضح (رسالة عربية) قبل
  الحفظ (create/update)، خط دفاع أول قبل CHECK constraint الـDB (خط دفاع أخير، مش الوحيد).
- **الأدمن**: فورم تعديل الخدمة (`apps/admin/src/app/catalog/services/[id]/page.tsx`) فيه قسم
  "أوضاع توقيت الخدمة" — 4 checkboxes تبادلية بصريًا + مثال استخدام تحت كل واحد. حقل "السعر
  الأساسي" بقى تسميته "سعر الساعة (جنيه)" ديناميكيًا لما `pricing_model=hourly`.

## صور الفئات — رفع ومسح فعليين (docs/08 §98)

بلاغ المالك: «الصورة بتتحط فقط أثناء إنشاء الفئة… ما بقاش فيه إمكانية إنك ترجع تعدل».

**السبب الحقيقي مكانش غياب شاشة التعديل** (كانت موجودة من زمان): الصور كانت خانتين **رابط نصي**
ومفيش أي مكان في المنصة يرفع صورة فئة أصلاً، فالأدمن عمليًا مقدرش يغيّرها بعد الرابط الأولاني.
وكمان المسح كان **مستحيل**: الواجهة بتبعت `undefined` للخانة الفاضية، و`JSON.stringify` بيشيل
المفتاح، فالـ`PATCH` ما بيغيّرش حاجة.

- `POST /admin/service-categories/:id/media/:slot` — `slot` = `icon` (أيقونة صغيرة) أو `cover`
  (غلاف الكارت). نفس الأعمدة الموجودة أصلاً، صفر عمود جديد.
- `DELETE /admin/service-categories/:id/media/:slot` — مسح صريح ومسجّل في سجل النشاط.

**إعادة استخدام `validateBrandingFile()` بالحرف** (ADR-0014) بدل نسخة تانية: MIME معلَن + magic
bytes حقيقية + تطابقهم + حجم + أبعاد، و**مفيش SVG** (وعاء تنفيذ سكربت). صورة الفئة بتتعرض لكل
عملاء المنصة زي البراندنج، فمفيش سبب لمعايير أضعف.

الرفع ملفوف بـ`uploadWithOrphanCleanup()` — فشل تسجيل الرابط في الداتابيز بيمسح الملف المرفوع بدل
ما يسيبه يتيم.

**شاشة الأدمن**: الصور بتتحفظ **لحظيًا** مستقلة عن زرار "حفظ التعديلات"، ولزامًا اتشالت من جسم
الـ`PATCH` — وإلا أي حفظ للاسم كان هيبعت الروابط القديمة اللي في الفورم ويدوس على صورة اتغيّرت لسه.

## سياسة تحديد السعر والمعاينة (ADR-0063/0066)

الـ13 عمود اللي migration 0247 ضافتهم على `services` (`price_certainty_mode`,
`assessment_route_policy`, `remote/onsite_assessment_enabled`, `remote_assessment_fee_cents`,
`assessment_fee_credit_mode/bps`, `onsite_assessor_executes_work`, `quote_validity_minutes`,
`display_price_min/max_cents`, `require_admin_review_above_range`,
`max_quote_increase_without_admin_review_bps`) كانوا في الداتابيز والكيان بس — مش في أي DTO،
مش في رد الأدمن، مش في الحزمة المشتركة، ومش في الشاشة. يعني **القدرة موجودة والأدمن مايقدرش
يشغّلها**. نفس فئة البَقّة اللي ADR-0064 §2 قفلها لحالات الطلب.

- `applyAssessmentPolicy()` في `AdminCatalogService` هي **نقطة الكتابة الوحيدة** للـ13 حقل،
  مشتركة بين الإنشاء والتعديل — لو اتكتبوا في المكانين، أول تعديل في قاعدة تحقق هيسري في واحد بس.
- التحقق في الباك-إند مش في الواجهة، فأي كولر (شاشة/سكربت/تطبيق) بيتمنع بنفس القاعدة:
  «محتاج تقييم» بمسارين مقفولين، «بالصور فقط» والصور مقفولة، خصم بنسبة بصفر، حد أقصى أقل من
  الحد الأدنى، و«نطاق تقديري» بلا حدود عرض — كلها مرفوضة برسائل تخص الحالة نفسها.
- **حدود العرض غير حدود قصّ المعادلة** (`min/max_price_cents`): الأولى رقم بيتقال للعميل،
  والتانية حارس على ناتج الحساب. الفصل ده متعمّد وبند صريح في السكربت.
- الافتراضيات آمنة (`confirmed_price` + كل المسارات مقفولة)، فأي خدمة قديمة أو كولر مابيبعتش
  الحقول دي بيفضل بسلوكه بالحرف.

واجهة الأدمن: قسم «سياسة تحديد السعر والمعاينة» في `/catalog/services/[id]` بإظهار تدريجي —
حقول النطاق بتبان لوضع «نطاق تقديري» بس، ومسارات التقييم ورسومها لوضع «محتاج تقييم» بس.

الاختبار الحي: `assessment-policy-admin.spec.ts`.
