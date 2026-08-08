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
- **`/admin/services/:id/technicians`**: تحديد الفنيين المؤهلين لخدمة معيّنة (`technician_services`) — `POST` (تعيين بمستوى مهارة، بيرفض تكرار وفني غير موجود)، `DELETE .../technicians/:technicianId`.
- **كل عملية بتتسجّل في سجل التدقيق** (`../audit/README.md`) — `service.created`/`updated`/`deleted`, `service_category.*`, `service_zone_pricing.*`, `technician_service.assigned`/`removed`.
- اتعمله اختبار end-to-end فعلي شامل مطابق لمثال المستخدم بالحرف: فئة "خدمات منزلية" ← فئة فرعية "تنظيف" (بإعادة ربط فئة موجودة بأب جديد) ← خدمة "تنظيف كنب" — ظهرت فوراً في `GET /services` العام. تعديل السعر (من 250 لـ 300 جنيه) اتطبّق فوراً على `estimate`. تعطيل الخدمة خفاها من القائمة العامة فوراً. تسعير منطقة مخصص (350 جنيه + surge 1.2) اتطبّق صح على `estimate` وقفل السطر الأول لما اتعدّل تاني بدل ما يكرّره. تعيين فني كمستوى "خبير" نجح، تكراره اترفض، فني وهمي اترفض بـ404، وشيله نجح. حذف فئة فيها خدمة لسه اترفض بوضوح، وبعد حذف الخدمة الحذف نجح (soft-delete حقيقي — اختفت من قائمة الأدمن). عميل عادي اترفض بالكامل من كل مسارات الإدارة (403 من `RolesGuard` قبل حتى `PermissionsGuard`).
- **`catalog.manage`** صلاحية جديدة (`infra/migrations/0022_catalog_manage_permission.sql`) — `super_admin` و`ops_manager` بس.

## `service_level_pricing` و `service_addons` — كانت فجوة موثّقة، اتقفلت

**ملحوظة مهمة**: الجدولين كانوا موجودين فعلياً في `infra/migrations/0006_catalog.sql` من أول يوم (فاضيين، من غير entity/service/endpoint) — مفيش migration جديدة اتضافت، بس الكود اللي بيستخدمهم.

- **`service_level_pricing`** (فرق السعر حسب مستوى الفني اللي هيتنفّذ الطلب): إدارة كاملة عبر `GET/PUT /admin/services/:id/level-pricing` (upsert بيدوّر على صف موجود لنفس (خدمة، مستوى) بدل ما يكرّر) و`DELETE /admin/services/level-pricing/:pricingId` (تعطيل، مش حذف فعلي). القيم المسموحة لـ `technician_level` هي القيم الحقيقية المستخدمة فعلاً في الكود (`new`/`verified`/`professional`/`premium`/`team_leader` من `TechnicianLevel` enum بعد الـ rename في `0027_technician_level_tiers.sql`) — **مش** الأسماء التوضيحية القديمة (`bronze`/`silver`/`gold`/`platinum`) المكتوبة كتعليق في `02-data-dictionary.md` §5.4، اتجنّبنا اختراعها بالتحقق من الـ enum الحقيقي في الكود قبل الكتابة.
- **`POST /services/:id/estimate`** بقى بياخد query param اختياري `technician_level` — لو فيه صف `service_level_pricing` نشط لنفس (خدمة، مستوى)، بيتضرب في السعر (بعد أي `zone_pricing` override لو موجود). ده **معاينة سعر بس**، مش تطبيق تلقائي على الطلب الفعلي:
  - **قرار معماري متعمّد، مش سهو**: `POST /orders` (في `orders.service.ts`) بيستدعي `estimate()` من غير `technician_level` لأن الفني مش معروف لسه وقت إنشاء الطلب (الطلب لسه في `searching_technician`، والمطابقة بتحصل بعد كده). تطبيق المضاعف تلقائياً على السعر الفعلي بعد ما فني معيّن يقبل الطلب معناه تغيير سعر شافه العميل بالفعل وقت الحجز — قرار عمل (business decision) مش موجود بالتفصيل في القاموس (هل يتقبل العميل السعر الجديد؟ يتلغي؟ يتقفل على المستوى وقت المطابقة؟)، فمش هنخترعه. فجوة موثّقة صراحة.
- **`service_addons`**: إدارة كاملة عبر `POST/PATCH/DELETE /admin/services/:id/addons` و`/admin/services/addons/:addonId` (soft-delete حقيقي عبر `@DeleteDateColumn`)، بالإضافة لـ `GET /services/:id/addons` **عام** (`@Public()`) للتطبيقات تقرأ الإضافات المتاحة وقت إنشاء الطلب. **مش متوصّلة بمسار إنشاء الطلب حالياً** — اختيار العميل لإضافة معيّنة واحتساب سعرها في الطلب محتاج `order_items` (مسار `AWAITING_QUOTE_APPROVAL` الرسمي)، وده أصلاً فجوة موثّقة منفصلة وأكبر في `../orders/README.md` (§S7).
- اتعمله اختبار حي كامل: إنشاء تسعير مستوى `premium` (×1.45) و`new` (×1.00) لخدمة حقيقية، `estimate` من غير `technician_level` رجّع السعر الأساسي، مع `technician_level=premium` رجّع `30000 × 1.45 = 43500` بالظبط، مع مستوى مالوش صف (`verified`) رجع للسعر الأساسي (fallback ×1) بدل ما يفشل، وقيمة enum قديمة غلط (`bronze`) اترفضت `VAL_001` بوضوح. تعطيل صف `new` عبر `DELETE .../level-pricing/:pricingId` اتأكد إنه بيوقف يتطبّق فوراً. إنشاء إضافتين، تعديل سعر واحدة وتعطيلها اختفت فوراً من `GET /services/:id/addons` العام لكن فضلت ظاهرة لقايمة الأدمن، حذفها (`DELETE`) اختفت من الاتنين (soft-delete حقيقي). أدمن `support_agent` (مالوش `catalog.manage`) اترفض 403 من كل عمليات الكتابة على الاتنين لكن قدر يقرا (`GET`) عادي. كل عملية اتسجّلت في `audit_logs` بالقيم القديمة/الجديدة صح.

## بَقّة حقيقية اتلقطت واتصلحت — `zone-pricing`/`technicians` كانوا بيرجّعوا entity خام (camelCase)

اتلقطت وقت بناء شاشة تفاصيل الخدمة في `apps/admin` (تحت). `GET/PUT /admin/services/:id/zone-pricing` و`GET/POST /admin/services/:id/technicians` كانوا الاستثناء الوحيد في `admin-catalog.controller.ts` كله — بيرجّعوا كائن TypeORM entity خام (`{serviceZoneId, priceCents, surgeMultiplier, isActive, createdAt, ...}` بـ camelCase) بدل ما يعدّوا على `toXxxResponseDto()` زي كل مسار تاني في نفس الملف بالظبط (`toServiceLevelPricingResponseDto`، `toServiceAddonResponseDto`، إلخ). اتأكدت البَقّة حياً بـ`curl` مباشر (رد فعلي فيه `serviceZoneId`/`priceCents` بدل `service_zone_id`/`price_cents`) قبل الإصلاح. اتصلحت بإضافة `ServiceZonePricingResponseDto`/`toServiceZonePricingResponseDto` و`EligibleTechnicianResponseDto`/`toEligibleTechnicianResponseDto` في `dto/admin-catalog-response.dto.ts`، وتعديل الـ4 مسارات (`GET`/`PUT` zone-pricing، `GET`/`POST` technicians) تعدّي عليهم. اتأكد الإصلاح حياً: نفس الـ`curl` رجّع `service_zone_id`/`price_cents` صح بعد الإصلاح.

## `apps/admin` — شاشة تفاصيل الخدمة (`/catalog/services/:id`) — كانت فجوة موثّقة، اتقفلت

كانت موثّقة في `apps/admin/README.md` ("تسعير حسب المنطقة، الفنيين المؤهلين لكل خدمة... مش متاحين من الواجهة لسه") — كل الـ endpoints فوق كانت API-only. اسم الخدمة في `/catalog` بقى رابط لشاشة تفاصيل فيها 4 أقسام: تسعير حسب المنطقة (إنشاء/تعطيل)، الفنيين المؤهلين (إضافة/إزالة، بالاسم وكود الفني الحقيقي مش UUID خام — بيتحل من نفس قايمة `GET /admin/technicians?verification_status=approved` المُستخدمة في شاشة إعادة تعيين الطلبات)، تسعير حسب مستوى الفني (إنشاء/upsert)، والإضافات الاختيارية (إنشاء/تفعيل/تعطيل). تفاصيل كاملة في `apps/admin/README.md`.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
