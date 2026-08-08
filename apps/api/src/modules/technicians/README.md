# modules/technicians

الفنيين، المستندات، المستويات (جديد→موثّق→محترف→بريميوم→قائد فريق)، التوافر. جداول: technician_profiles, technician_documents, technician_services, technician_zones, technician_level_history, technician_level_config, technician_availability (قاموس §4.2-4.7).

**الحالة: شغال جزئياً (S2 + S4 + بداية S9 — اعتماد الفنيين).**
- `technician_profiles` بيتعمل تلقائياً لما فني يسجل (مستمع لحدث `user.registered`)، مع `technician_code` مولّد من sequence في الداتابيز (`infra/migrations/0017`, صيغة `TECH-000123` من غير سنة).
- `national_id_encrypted` بيفضل NULL لحد ما الفني يكمّل مسار القبول (§9.3 في الماستر بلان) — اتعدّل الـ schema في `infra/migrations/0018` عشان يسمح بده.
- `GET /technician/me`, `GET /technician/level` — للفني بس (`@Roles(TECHNICIAN)`), جُرِّب فعلياً إن عميل بيتاخد 403 لو حاول يوصلهم.
- `PATCH /technician/availability` (`is_available`, `is_on_duty`), `POST /technician/location` (`latitude`/`longitude` → بيتخزن كـ `geography(Point)`) — أضيفوا عشان `matching` (S4) محتاجهم فعلياً يشتغل، اتعمله اختبار حقيقي مع 5 فنيين وإحداثيات مختلفة والمسافة اتحسبت صح بـ PostGIS.
- **رفع المستندات (`POST/GET /technician/documents`)**: الفني بيرفع مستنداته (بطاقة، سجل جنائي، شهادة مهنية، ...) بنفس نمط `orders/order-media.service.ts` (multipart عبر `StorageService`)، وكل مستند بيبدأ `pending` لحد ما الأدمن يراجعه.
- **`technician-verification-state-machine.ts`**: state machine مقفولة لـ `verification_status`. ملحوظة تصميم صريحة: القاموس بيعرّف حالات وسيطة (`documents_submitted`, `under_review`, `interview_scheduled`, `test_passed`) بس مفيش endpoints بنتها لسه تنقل الفني بينهم يدوياً (جدولة مقابلة، رصد نتيجة اختبار) — فالـ state machine بتسمح بالانتقال المباشر لـ `approved`/`rejected` من أي حالة وسيطة، عشان القرارين المتاحين فعلياً (موافقة/رفض) يشتغلوا من أي نقطة. **بَقّة حقيقية اتصلحت قبل ما توصل للاختبار**: النسخة الأولى من الـ state machine كانت بترفض `pending→approved` مباشرة (بتطلب `under_review` الأول) مع إن مفيش endpoint أصلاً ينقل لـ `under_review` — يعني فني جديد ماكانش هيتوافق عليه أبداً. اتصلحت بجعل `approved`/`rejected` متاحين من كل حالة وسيطة.
- **`AdminTechniciansController`** (`/admin/technicians`, `@Roles(ADMIN)`): `GET` (قائمة مفلترة بـ `verification_status`/`level` + صفحات)، `GET /:id` (تفاصيل + كل المستندات)، `POST /:id/approve`, `POST /:id/reject` (سبب إلزامي 5-500 حرف)، `POST /:id/documents/:documentId/review` (approve/reject لمستند واحد، `rejection_reason` إلزامي لو `rejected`، ومستند اتراجع قبل كده يترفض تاني مراجعة — قرار نهائي مش قابل للتراجع، الفني يرفع نسخة جديدة لو محتاج).
- حدث `technician.verification_changed` بيتصدر بعد كل قرار approve/reject — `notifications` بيسمعه ويبعت للفني نفسه (تهنئة أو سبب الرفض).
- اتعمله اختبار end-to-end فعلي شامل: فني رفع مستندين حقيقيين (وترفض نوع ملف غير مسموح)، أدمن راجع واحد approved وواحد rejected بسبب، حاول يراجع المُوافَق عليه تاني فاترفض (409)، وافق على الفني (`pending→approved` نجح بعد التصحيح) والإشعار وصله فوراً بمحتوى صحيح، حاول يوافق تاني فاترفض (مفيش self-loop)، رفض فني تاني بسبب ووصله إشعار فيه نص السبب بالظبط، عميل حاول يوصل لمسارات الأدمن فاترفض 403، وفلترة/صفحات القائمة اتأكد منها.
- **`POST /admin/technicians/:id/suspend`** (`technicians.approve`، كانت فجوة موثّقة اتقفلت): تعليق فني معتمد — `technician-verification-state-machine.ts` كان أصلاً بيسمح بـ `APPROVED→SUSPENDED` ورجوع `SUSPENDED→APPROVED`/`REJECTED` من زمان، بس مفيش method/route كانت بتستخدمه. الفني المُعلَّق بيتشال أوتوماتيك من الـ matching (`matching.service.ts` بيفلتر `verification_status='approved'` بس)، فمفيش حاجة تانية لازم تتلمس يدوياً. اتعمله اختبار حي: فني معتمد اتعلّق بسبب، اترفض تعليق تاني بسبب قصير من 5 أحرف (تحقق DTO)، اترجّع للاعتماد تاني بنجاح، وسجل التدقيق سجّل الانتقالين بالظبط (`technician.verification_suspended` ثم `technician.verification_approved`).
- **فجوة موثّقة متبقية**: مفيش endpoints للحالات الوسيطة (`documents_submitted`/`under_review`/`interview_scheduled`/`test_passed`) — القرارين المتاحين دلوقتي approve/reject/suspend بس. ~~تعيين technician_services/technician_zones لسه يدوي عبر SQL~~ — `technician_services` كان اتقفل قبل كده (`/admin/services/:id/technicians` في `catalog`)، و`technician_zones` اتقفل هنا (تفاصيل تحت). باقي S9 (متابعة الطلبات لحظياً + تدخل يدوي، والتقارير) لسه الخطوة الجاية.

### مناطق عمل الفني (`technician_zones`) — كانت فجوة موثّقة ("يدوي عبر SQL")، اتقفلت

`GET/POST /admin/technicians/:id/zones` + `DELETE /admin/technicians/:id/zones/:zoneId` — نفس نمط
`technician_services` في `catalog/admin-catalog.service.ts` بالحرف. `GET` مفتوح لأي أدمن، `POST`/`DELETE`
محتاجين صلاحية جديدة `technicians.manage_zones` (`infra/migrations/0040` — `super_admin`/`ops_manager`،
منفصلة عمداً عن `technicians.approve` لأن تعيين المناطق عملية تشغيلية يومية مش قرار اعتماد/رفض).
التحقق من وجود النطاق نفسه عبر `GeoService.findServiceZoneOrThrow()` جديدة (public method، كانت
`private` جوّه `AdminGeoService` بس).

**بَقّتين حقيقيتين اتلقطوا واتصلحوا وقت الاختبار الحي**:
1. `removeZone()` الأولى كانت بتستخدم `repository.softDelete(criteria)` مباشرة — `softDelete` بيبني
   `UPDATE ... WHERE <criteria>` **من غير** `AND deleted_at IS NULL` تلقائي (الاستبعاد التلقائي للصفوف
   المحذوفة بتاع TypeORM بس لـ `find`/`findOne`، مش لعمليات الكتابة)، يعني نداء الإزالة **مرتين** على
   نفس المنطقة كان بيرجّع نجاح (`{removed: true}`) المرتين بدل 404 في التانية. اتصلح بـ `findOne` أول
   (بيستبعد soft-deleted صح) قبل `softDelete(id)`.
2. **نفس فئة بَقّة `users.phone_number` (0035) بالحرف**: `UNIQUE(technician_id, service_zone_id)` في
   `technician_zones` (من `0005_customers_technicians.sql`) كان قيد عادي بيشمل الصفوف المحذوفة —
   إزالة منطقة من فني وبعدين محاولة تعيينها تاني لنفس الفني كانت بترمي
   `duplicate key value violates unique constraint` (500 خام) بدل نجاح عادي. اتأكدت حياً بالظبط
   (إزالة ثم إعادة تعيين نفس الزوج فعلياً رمت الخطأ ده في الـ server log). اتصلح بـ
   `infra/migrations/0041` — نفس الحل بالحرف: `UNIQUE` عادي → partial unique index
   (`WHERE deleted_at IS NULL`).

**اتعمله اختبار حي كامل**: تعيين منطقة لفني حقيقي نجح، تكراره اترفض (409)، القايمة رجّعت الصف الصح،
الإزالة نجحت، إزالتها تاني اترفضت 404 (بعد الإصلاح #1)، إعادة تعيين **نفس** المنطقة اللي اتشالت
نجحت (بعد الإصلاح #2، مش duplicate key)، تعيين لمنطقة مش موجودة اترفض 404، `ops_manager` قدر
يعيّن (الصلاحية اتمنحله)، عميل اترفض تماماً 403 (`RolesGuard` قبل حتى `PermissionsGuard`).

## شركات/فرق الفنيين (`/technician/company`) — جديد (S10)

بتغطي الطلب الأصلي بمفهوم واحد: **فني مستقل** (الوضع الافتراضي، `team_role=independent`) أو **عضو في فريق/شركة**. مفيش تفرقة بين "فريق" و"شركة" في الـ schema عمداً — الفريق ببساطة شركة من غير سجل تجاري رسمي أو فروع، فمفهوم واحد (`technician_companies` + `technician_company_branches`) كافي لمثال شركة النظافة (Manager/Supervisors/Workers) في الطلب. `infra/migrations/0026`.

- **`team_role`**: `independent | owner | manager | supervisor | worker` على `technician_profiles` — منفصل تماماً عن `roles`/`permissions` الإدارية (0003/0020)، ده سلطة داخل الشركة نفسها مش صلاحية على نظام baytak.
- **ذاتية الإدارة بالكامل** — مفيش تدخل أدمن مطلوب لإنشاء/إدارة شركة:
  - `POST /technician/company` — أي فني (مش عضو في شركة بالفعل) بينشئ شركة ويبقى `owner` تلقائياً.
  - `GET /technician/company` — أي عضو (أي دور) يشوف الشركة + الفروع + الفريق كامل.
  - `PATCH /technician/company`, `POST/PATCH /technician/company/branches[/:branchId]` — `owner`/`manager` بس.
  - `POST /technician/company/staff` (بـ`technician_code`، مش UUID — أسهل للفني يعرفه) و`PATCH`/`DELETE /technician/company/staff/:userId` — `owner`/`manager` بس، وممنوع يلمسوا الـ`owner` نفسه من المسارات دي (نقل الملكية خارج النطاق دلوقتي، فجوة موثّقة).
- **إشراف الأدمن (`/admin/technician-companies`) read-only بالكامل عمداً** — `GET` (قائمة بعدد الفروع/الأعضاء) و`GET /:id` (تفاصيل + الفريق كامل)، مفتوحة لأي أدمن زي باقي الـ`GET`s، مفيش `@RequirePermission` لأن مفيش فعل بيتغيّر.
- **اتعمله اختبار end-to-end فعلي كامل** بـ 3 فنيين حقيقيين مسجّلين فعلاً: فني أنشأ شركة وبقى owner، عمل فرع، ضاف فني تاني كـ`manager` على الفرع ده — وبعدين الـ**manager نفسه** (مش الـowner) ضاف فني ثالث كـ`worker`، إثبات إن السلطة المفوّضة شغالة فعلياً مش owner بس. `worker` اترفض (403) من إضافة عضو لكن قدر **يشوف** الفريق كامل؛ owner اترفض من إنشاء شركة تانية (409، عنده واحدة بالفعل)؛ إضافة نفس الفني تاني اترفضت ("عضو بالفعل")؛ owner اترفض من إضافة نفسه؛ كود فني مش موجود اترفض بوضوح (404)؛ manager عدّل دور الـworker لـ`supervisor` ثم شاله من الشركة، ورجع الفني `independent` فعلاً (اترفض تاني `GET /technician/company` بـ404 "مش عضو")؛ محاولة الـmanager يشيل الـowner اترفضت (403)؛ الأدمن شاف قائمة الشركات بعدد فروع/أعضاء صحيح والتفاصيل الكاملة؛ وكل عملية (إنشاء شركة، فرع، إضافة/تعديل/إزالة عضو) اتسجّلت في سجل التدقيق بـ`actor_role=technician`.

## مستويات الفنيين (`technician_level_config`) — جديد (S10، نقطة 4)

كان فيه 4 مستويات (`bronze/silver/gold/platinum`) كـ enum بس، من غير أي سياسة حقيقية مربوطة بيهم — القيمة الوحيدة اللي بتستخدمهم فعلياً كانت `min_technician_level` على الخدمة. دلوقتي:

- **إعادة تسمية + مستوى خامس**: `infra/migrations/0027` عمل `ALTER TYPE ... RENAME VALUE` لكل قيمة (`bronze→new`, `silver→verified`, `gold→professional`, `platinum→premium`) — **البيانات القديمة اتحوّلت تلقائياً**، مفيش migration بيانات يدوية محتاجة — وضاف مستوى خامس `team_leader`. لازم `ADD VALUE` على enum يكون في migration منفصلة (`0027`) عن أي جدول بيستخدم القيمة الجديدة (`0028`) — قيد PostgreSQL (القيمة الجديدة مينفعش تتستخدم في نفس الـ transaction اللي زرعتها).
- **`technician_level_config`** (`infra/migrations/0028`, 5 صفوف مزروعة، `id UUID` منفصل عن `level` عشان يصلح كـ`entity_id` في سجل التدقيق): لكل مستوى — `commission_adjustment_percentage` (فرق سالب عادةً على عمولة الخدمة الأساسية)، `order_priority_weight` (أولوية إرسال جوّه دائرة الفنيين المؤهلين)، `decision_limit_cents` (أعلى قيمة طلب الفني يقبلها لوحده، `NULL`=بلا حد)، `can_lead_team` (بس `premium`/`team_leader` يقدروا ينشئوا شركة). **`GET /admin/technician-levels`** مفتوح لأي أدمن، **`PATCH /admin/technician-levels/:level`** محتاج `technician_levels.manage` (`infra/migrations/0029` — `super_admin` + `ops_manager`).
- **3 مستهلكين حقيقيين، مش CRUD شكلي**:
  1. **العمولة** (`payments/payments.service.ts computeSettlement`): عمولة المنصة = عمولة الخدمة + فرق مستوى الفني (محدودة 0-100% دفاعياً). فني `professional` (-2%) على خدمة عمولتها 20% دفع فعلياً 18%.
  2. **أولوية الإرسال** (`matching/matching.service.ts findEligibleTechnicians`): `ORDER BY order_priority_weight DESC, distance_km ASC` — إضافة على المسافة مش بديل عنها.
  3. **حد القرار** (`matching/matching.service.ts accept()`): طلب أكبر من `decision_limit_cents` بتاع مستوى الفني بيترفض (403) لحد ما يترقّى.
- **`PATCH /admin/technicians/:id/level`** (فجوة كانت موثّقة "لسه من غير" — اتقفلت): ترقية/تخفيض يدوي، بيسجّل في `technician_level_history` (جدول موجود من `0005` بس مكانش مستخدم)، `change_type=manual_override` دايماً بس اسم فعل التدقيق بيفرّق `promotion`/`demotion` حسب الاتجاه.
- **اتعمله اختبار end-to-end فعلي حاسم**: فني مستوى `new` (حد قرار 200 جنيه) اترفض من قبول طلب 300 جنيه (403 برسالة الحد بالظبط)؛ الأدمن رقّاه لـ`professional` (حد 1500 جنيه) وبنفس التوكن القديم قدر يقبل نفس الطلب فوراً؛ اكتمال الطلب ودفعه كاش طبّق عمولة 18% بالظبط (20% - 2%)؛ `ops_manager` غيّر فرق عمولة `professional` لـ-5% عبر الـ API **من غير أي restart**، وطلب تاني لنفس الفني طبّق 15% بالظبط فوراً؛ `finance` (مالوش الصلاحية) اترفض من التعديل لكن قدر يشوف القائمة؛ فني مستوى `new` اترفض من إنشاء شركة (`can_lead_team=false`)، رقّاه الأدمن لـ`premium` ونجح فوراً؛ فني farther-but-premium (وزن أولوية 30) اتأكد إنه بيتقدّم على فني أقرب لكن `professional` (وزن 20) في استعلام الترتيب الحقيقي مباشرة على قاعدة بيانات حية بإحداثيات PostGIS فعلية؛ ترقية لنفس المستوى الحالي اترفضت (409)، ومستوى غير موجود اترفض بوضوح (400)؛ `decision_limit_cents` سالب اترفض.
- **فجوة موثّقة**: مفيش خوارزمية ترقية تلقائية بناءً على `quality_score`/عدد الطلبات — كل تغيير مستوى دلوقتي يدوي بس عبر الأدمن (`manual_override`)، والترقية/التخفيض الأوتوماتيكي (لو حصل مستقبلاً) هيستخدم نفس جدول `technician_level_history` بـ`change_type=promotion/demotion` الحقيقي.

## إحصائيات محسوبة بمهمة خلفية (`TechnicianStatsService`) — جديد (S10، نقطة 12)

`completed_orders_count`, `average_rating`, `total_ratings_count` على `technician_profiles` بقوا بيتحدّثوا فعلياً — كانوا معطّلين تماماً من أول يوم (دايماً صفر، مفيش كود كان بيلمسهم). `TechnicianStatsService.enqueueRecalculation()` (مصدّرة من الموديول ده) هي نقطة الدخول الوحيدة اللي `payments`/`ratings` بيستخدموها — بتجدول job على طابور `technician-stats` (BullMQ)، مش بتلمس الأعمدة مباشرة، مطابقة لـ`docs/02-data-dictionary.md` §14.4. التفاصيل الكاملة والاختبار (بما فيه باگ حقيقي خطير اتلقط واتصلح — طلب كان بيعلّق دقايق لو Redis واقع) في `../ratings/README.md`.

### تحقيق عميق في بَقّة "الـ Worker مبيرجّعش يعالج وظايف جديدة بعد انقطاع Redis طويل" — لسه من غير حل

الجانب المنتِج (`enqueueRecalculation` → `queue.add()`) مؤكّد بالاختبار: بيفشل بسرعة (<0.1 ثانية) وبأمان لو Redis واقع، ومايعلّقش الطلب الحقيقي أبداً. لكن الجانب المستهلك (`TechnicianStatsProcessor`) — وبنفس الشكل بالظبط `MatchingRoundExpiryProcessor` في `../matching/README.md` — بعد انقطاع Redis يعدّي شوية (اتعمل اختبار بـ20-25 ثانية outage عدة مرات)، الـ Worker بيوقف عن جلب وظايف جديدة من الطابور تماماً، حتى بعد ما Redis يرجع ويفضل شغال لأكتر من دقيقة — الوظايف تفضل قاعدة بأمان في `wait` list (اتأكد بفحص Redis مباشرة عبر `redis-cli`، مفيش فقدان بيانات إطلاقاً)، لحد ما الـ process يتعاد تشغيله بالكامل.

**اتعمل تحقيق حي مكثّف على 3 محاولات إصلاح متتالية:**

1. **اتصال Redis منفصل للـ Worker عبر `BullModule.forRootAsync(configKey, ...)` + `@Processor({configKey})`** — اكتشفنا إن ده **بيتصرف زي مفيش تأثير خالص**: `@nestjs/bullmq`'s `BullExplorer.getQueueOptions()` بيحل اتصال الـ Worker بالبحث عن Queue متسجّل بنفس اسم الطابور أولاً، ولو لقاه (وهو موجود دايماً هنا، مسجّل بـ`registerQueue()` للـ producer) بيستخدم اتصاله على طول ويتجاهل `configKey` تماماً — الـ fallback لـ`configKey` بيحصل بس لو مفيش Queue متسجّل بنفس الاسم خالص. اتأكد ده بقراءة الكود المصدري لـ`@nestjs/bullmq` نفسه (`bull.explorer.js`).
2. **اتصال منفصل ممرَّر مباشرة (مش عن طريق `configKey`) بـ`enableOfflineQueue` الافتراضي (`true`)** — الفرضية كانت إن `enableOfflineQueue:false` (ضروري للـ Queue) هو اللي بيمنع الـ Worker من التعافي. النتيجة: **أسوأ من قبل**. اتأكد عبر heartbeat تشخيصي مباشر (`worker.isRunning()`/`worker.isPaused()` كل 5 ثواني) إن الـ mainLoop فضل `isRunning()=true` (مش متوقف ظاهرياً) لكن عالق تماماً — أوامر زي الـ`EVALSHA` بتاعة `moveToActive` بتتحجز صامتة في طابور ioredis الداخلي للأبد لو الاتصال لسه مش "ready" فعلياً، من غير أي خطأ يوصّل لمنطق إعادة المحاولة بتاع BullMQ (`retryIfFailed`). اكتشاف جانبي مفيد من المحاولة دي: مفيش مستمع لـ`'error'` event على الـ Worker — Node's EventEmitter بيرمي الخطأ نفسه (throw) لو `'error'` اتبعت وماحدش مستمع ليه، وده كان بيسبب crash صامت لـ`setInterval` بتاع الـ stalled-check timer (ظاهر كـ stack trace خام في اللوج، مش عن طريق الـ logger). اتصلح بإضافة `@OnWorkerEvent('error')` — بَقّة حقيقية اتصلحت، محفوظة في الكود لحد دلوقتي.
3. **نفس الاتصال المنفصل بس بـ`enableOfflineQueue: false` صريحة + مستمع `'error'`** — الفرضية المعاكسة: `enableOfflineQueue:false` بيخلي الأمر يترفض فوراً بدل ما يتحجز، فيدخل مسار `retryIfFailed`'s إعادة المحاولة (اللي بقى آمن دلوقتي بفضل مستمع `'error'`). النتيجة: **نفس العلة بالظبط** — `isRunning()=true` باستمرار، صفر تقدّم، حتى بعد أكتر من دقيقة من رجوع Redis.

**الخلاصة**: البَقّة مش في `enableOfflineQueue` ولا في `configKey` — دول أعراض جانبية اتصلحت فعلاً (ضجيج اللوج، crash صامت). السبب الجذري مطابق لبَقّة موثّقة رسمياً في BullMQ نفسه: [GitHub issue #4479](https://github.com/taskforcesh/bullmq/issues/4479) — الاتصال الـ blocking (اللي بيستخدمه `waitForJob`/`bzpopmin`) مابيتعافاش صح بعد إعادة اتصال، حتى مع الـ "watchdog" mitigation اللي BullMQ نفسه ضايفه في v6.0.9 بالذات (`redis-queue-backend.js`, race بين الأمر الـ blocking وtimeout بيقطع الاتصال ويعيده لو الوقت عدّى) — الـ mitigation ده اتأكد إنه مش كافي في بيئة الاختبار هنا. اتأكد إن مكتبة `bullmq` مثبّتة على أحدث إصدار متاح (`6.0.9`، مفيش نسخة أحدث في الـ registry وقت التحقيق).

**القرار**: وقف محاولات الإصلاح من كود التطبيق (3 محاولات كفاية للتأكد إن المشكلة مش في إعداداتنا)، والاحتفاظ بالتحسينات الحقيقية اللي اتكشفت في الطريق (اتصال Worker منفصل، `@OnWorkerEvent('error')`، `process.on('unhandledRejection', ...)` في `main.ts`). الحل الفعلي للفجوة دي محتاج إما تحديث مستقبلي من BullMQ نفسه، أو آلية supervisor خارجية (خارج نطاق كود التطبيق) بتعمل health-check دوري (فيه وظايف قاعدة في الطابور من غير حركة لمدة كذا دقيقة رغم إن Redis متاح؟) وrestart تلقائي للـ process لو لزم الأمر.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.
