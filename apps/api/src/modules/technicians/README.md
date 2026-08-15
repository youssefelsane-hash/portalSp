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
- ~~فجوة موثّقة متبقية: مفيش endpoints للحالات الوسيطة~~ — **اتقفلت** (تفاصيل تحت). ~~تعيين technician_services/technician_zones لسه يدوي عبر SQL~~ — `technician_services` كان اتقفل قبل كده (`/admin/services/:id/technicians` في `catalog`)، و`technician_zones` اتقفل هنا. باقي S9 (متابعة الطلبات لحظياً + تدخل يدوي، والتقارير) لسه الخطوة الجاية.

### الحالات الوسيطة لاعتماد الفني — كانت فجوة موثّقة، اتقفلت

`POST /admin/technicians/:id/mark-documents-submitted` / `mark-under-review` / `schedule-interview` /
`mark-test-passed` — كل واحدة بتاخد `{notes?: string}` اختياري (بيتخزن في `verification_notes`
الموجود بالفعل، مفيش عمود جديد). المسار الخطي `pending→documents_submitted→under_review→
interview_scheduled→test_passed→approved` موثّق بالتفصيل في `technician-verification-state-machine.ts`
— **قرار تصميم صريح**: القاموس مالوش أي عمود لتاريخ مقابلة أو درجة اختبار، فمفيش أي أتمتة هنا —
كل انتقال قرار أدمن يدوي بالكامل، بالظبط زي `approve`/`reject`/`suspend` الموجودين أصلاً. الاختصارات
القديمة (أي حالة → `approved`/`rejected` مباشرة) اتحفظت بالكامل من غير كسر توافق — الأدمن يقدر
يقفز أو يمشي بالتسلسل حسب الحاجة.

**اتعمله اختبار حي كامل**: فني حقيقي جديد اتسجّل (`pending`)، اتحرّك بالتسلسل الخطي الكامل الخمس
خطوات لحد `approved` — كل خطوة اتأكد `verification_status` الراجع مطابق تماماً، و`audit_logs`
سجّل الخمس انتقالات بقيم `old_values`/`new_values` صحيحة (بما فيها الـ`notes`). فني تاني اتسجّل
واتعمله `approve` مباشر من `pending` (الاختصار القديم) — نجح عادي. محاولة `mark-documents-submitted`
على فني **بالفعل approved** (الاتنين) اترفضت بوضوح ("مينفعش تنقل حالة اعتماد الفني من approved
لـ documents_submitted") — يثبت إن الـ state machine بتمنع الرجوع للخلف مش بس بتسمح بالتقدّم.
عميل حاول ينفّذ أي خطوة اترفض 403 قبل حتى يوصل لمنطق النقل.

### تسجيل/onboarding فني جديد من `apps/technician-app` — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

**الفجوة اللي اتلقطت**: كل السابق (الحالات الوسيطة، رفع المستندات `POST/GET /technician/documents`،
`GET /technician/me`) مختبر حي في الباك-إند — بس `apps/technician-app` معندهوش شاشة "تسجيل حساب جديد"
أصلاً (`AuthRepository` فيه `verifyOtp()` بس، مفيش `register()`)، ومفيش أي شاشة بتنادي
`GET/POST /technician/documents` خالص. فني جديد كان (لو سجّل عبر Postman/curl) بيوصل مباشرة لـ
`AvailableOrdersScreen` الفاضية للأبد — `matching.service.ts` بيرفض أي فني `verification_status != approved`
(`WHERE tp.verification_status = 'approved'`)، فمفيش أي طريقة يعرف بيها ليه، ولا طريقة يكمّل بيها.

**الحل**:
- `AuthRepository.register()` جديدة (`user_type='technician'` ثابت) — نفس نمط `apps/customer-app`
  بالحرف (راجع `apps/customer-app/README.md`). `LoginScreen` بقى فيها مود تسجيل جديد + اقتراح تلقائي
  لو فني حاول دخول برقم مش مسجّل.
- `OnboardingScreen` جديدة بالكامل (`features/onboarding/`) — بتعرض `verification_status` الحالي
  بترجمة عربية واضحة (٨ حالات، من `pending` لحد `approved`/`rejected`/`suspended`)، فورم رفع مستند
  (نوع المستند من `TechnicianDocumentType` السبعة + `image_picker` لالتقاط/اختيار صورة)، وقايمة
  المستندات المرفوعة بحالة مراجعتها (`review_status` + سبب الرفض لو موجود).
- `main.dart`'s `_AuthGate` بقى فيه `_VerificationGate` جديدة — بتفحص `GET /technician/me` مرة واحدة
  بعد تسجيل الدخول، وتوجّه لـ`OnboardingScreen` لو `verification_status != 'approved'` بدل
  `AvailableOrdersScreen` مباشرة. **فشل آمن متعمّد**: لو الفحص فشل (مشكلة شبكة عابرة)، بيفضّل
  `AvailableOrdersScreen` العادية — الباك-إند (`matching.service.ts`) أصلاً بيرفض أي فني مش approved
  بغض النظر، فمفيش مخاطرة أمنية، بس مفيش قفل غير ضروري لفني approved فعلاً بسبب خطأ تقني عابر.

**اتأكد حي بالكامل عبر curl** (Flutter SDK مش متاح في بيئة السيشن دي — تفاصيل كاملة في
`apps/customer-app/README.md`، نفس القيد ينطبق هنا): تسجيل فني جديد → `verification_status:"pending"`
فورًا من `GET /technician/me`؛ رفع مستند حقيقي (PNG) عبر `POST /technician/documents` (multipart،
نفس شكل `AuthRepository.authedUpload()`) → رجع بنجاح بشكل `TechnicianDocumentResponseDto` الكامل؛
`GET /technician/documents` بعد كده رجّع المستند في القايمة. بيانات الاختبار اتعملها حذف/soft-delete
بعد التأكيد.

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
  - `POST /technician/company/staff` (بـ`technician_code`، مش UUID — أسهل للفني يعرفه) و`PATCH`/`DELETE /technician/company/staff/:userId` — `owner`/`manager` بس، وممنوع يلمسوا الـ`owner` نفسه من المسارات دي.
  - **`POST /technician/company/transfer-ownership`** (`{new_owner_user_id}`) — كانت فجوة موثّقة صراحة ("نقل الملكية خارج النطاق دلوقتي")، اتقفلت: **المالك بس** (مش أي manager) يقدر ينقل الملكية لعضو موجود بالفعل في نفس الشركة (`requireOwner()` جديدة، أشد من `requireManager()` الموجودة). المالك القديم بيتحوّل `manager` تلقائياً جوّه transaction واحدة (يفضل عضو فعّال، مش بيتشال أو يضيع دوره فجأة) بدل ما يبقى بلا دور. بيستخدم نفس `findOwnStaffOrThrow()` الموجودة للتحقق إن الهدف عضو حقيقي في نفس الشركة (بترمي 404 لو مش عضو، و403 لو الهدف هو المالك نفسه بالفعل — ده بيغطي محاولة نقل الملكية لنفسك تلقائياً من غير كود إضافي). **اتعمله اختبار حي كامل**: فني A اتترقّى لمستوى `premium` (`can_lead_team`) عشان ينشئ شركة، أنشأ شركة وضاف فني B كـ`manager`؛ B (manager مش owner) حاول ينقل الملكية اترفض 403 برسالة واضحة؛ نقل لمستخدم برّه الشركة تماماً اترفض 404؛ A (owner) نقل الملكية لـB نجح — `company.owner_user_id` اتحدّث، B بقى `owner`، A بقى `manager` (اتأكد الاتنين مباشرة من `technician_profiles.team_role` في الـ DB، مش بس من الـ response)؛ A حاول ينقل الملكية تاني (مش owner دلوقتي) اترفض 403 صح؛ `audit_logs` سجّلت `technician_company.ownership_transferred` بالمالك القديم والجديد صح.
- **إشراف الأدمن (`/admin/technician-companies`) read-only بالكامل عمداً** — `GET` (قائمة بعدد الفروع/الأعضاء) و`GET /:id` (تفاصيل + الفريق كامل)، مفتوحة لأي أدمن زي باقي الـ`GET`s، مفيش `@RequirePermission` لأن مفيش فعل بيتغيّر.
- **واجهة `apps/admin` (`/technician-companies`, `/technician-companies/:id`) — كانت فجوة موثّقة، اتقفلت**: قايمة (اسم، سجل تجاري، عدد فروع/أعضاء، الحالة) + تفاصيل (بيانات الشركة، جدول الفروع، جدول الأعضاء بالدور/المستوى/حالة التوثيق — بتستخدم نفس تسميات `technician-labels.ts` الموجودة). مفيش أي تعديل باك-إند — الشاشة read-only مطابقة تماماً لطبيعة الـ endpoints. **اتعمله اختبار حي عبر Playwright** على الشركات الحقيقية التلاتة الموجودة من اختبارات سابقة: القايمة عرضت الثلاثة، الانتقال لتفاصيل "شركة النظافة المثالية" عرض فرع واحد وعضوين ببياناتهم الصح (owner/professional/معتمد، manager/جديد/قيد الانتظار).
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
- **واجهة `apps/admin` (`/technician-levels`) — كانت فجوة موثّقة، اتقفلت**: بطاقة لكل مستوى من الخمسة، عرض للقيم الحالية وزرار "تعديل" بيفتح فورم مضمّن (الاسم المعروض، تعديل العمولة %، وزن الأولوية، حد قرار الفني بالجنيه أو checkbox "بلا حد"، checkbox قيادة فريق). مفيش أي تعديل باك-إند — `GET/PATCH /admin/technician-levels` كانوا موجودين ومختبرين بالكامل من زمان. **اتعمله اختبار حي عبر Playwright**: تعديل وزن أولوية مستوى `new` من 0 لـ7 اتأكد مباشرة من `technician_level_config` في الـ DB، وتفعيل "بلا حد" لمستوى `professional` صفّر `decision_limit_cents` فعلاً — **القيمتين اترجعوا لأصلهم بعد الاختبار** (`order_priority_weight=0`, `decision_limit_cents=150000`) عشان الاختبار الحي القديم فوق ده لسه بيوصف سلوك حقيقي مطابق للقيم المزروعة.
- **فجوة موثّقة**: مفيش خوارزمية ترقية تلقائية بناءً على `quality_score`/عدد الطلبات — كل تغيير مستوى دلوقتي يدوي بس عبر الأدمن (`manual_override`)، والترقية/التخفيض الأوتوماتيكي (لو حصل مستقبلاً) هيستخدم نفس جدول `technician_level_history` بـ`change_type=promotion/demotion` الحقيقي.

## إحصائيات محسوبة بمهمة خلفية (`TechnicianStatsService`) — جديد (S10، نقطة 12)

`completed_orders_count`, `average_rating`, `total_ratings_count` على `technician_profiles` بقوا بيتحدّثوا فعلياً — كانوا معطّلين تماماً من أول يوم (دايماً صفر، مفيش كود كان بيلمسهم). `TechnicianStatsService.enqueueRecalculation()` (مصدّرة من الموديول ده) هي نقطة الدخول الوحيدة اللي `payments`/`ratings` بيستخدموها — بتجدول job على طابور `technician-stats` (BullMQ)، مش بتلمس الأعمدة مباشرة، مطابقة لـ`docs/02-data-dictionary.md` §14.4. التفاصيل الكاملة والاختبار (بما فيه باگ حقيقي خطير اتلقط واتصلح — طلب كان بيعلّق دقايق لو Redis واقع) في `../ratings/README.md`.

**تحديث — نفس الفجوة اتلقيت في `technician_services.completed_count`/`average_rating` كمان (لكل زوج فني+خدمة، `migration 0006`)**: أثناء مراجعة الفجوات المفتوحة بعد بَقّة `customer_profiles` (`../customers/README.md`)، اكتشفنا إن `technician_services.completed_count`/`average_rating` (المعروضين في `apps/admin` تحت "الفنيين المؤهلين" و`EligibleTechnicianResponseDto`) كانوا نفس القصة بالظبط — مجمّدين على `0`/`NULL` للأبد. عكس بَقّة `customer_profiles`، الأثر هنا **عرضي بس** (العمودين دول مش مستخدمين في أي منطق `matching`/ترتيب فعلي — تأكدنا بـ`grep` صريح). الإصلاح: `RecalculateStatsJobData` بقى ياخد `serviceId` اختياري، ولو موجود `TechnicianStatsProcessor.recalculatePerServiceStats()` بتحدّث صف `technician_services` المطابق (نفس فلسفة إعادة الحساب الكامل من `orders`/`ratings`، مش زيادة/تقليل رقم متخزّن). الأماكن الأربعة اللي بتنادي `enqueueRecalculation()` (`payments.service.ts` ×3: `collectCash`/`payWithWallet`/webhook البطاقة، و`ratings.service.ts rateAsCustomer` ×1) بقوا بيمرّروا `order.serviceId` كمان. **اتعمله اختبار حي**: فني كمّل 4 طلبات لنفس الخدمة بتقييمات (4، 3، 5 نجوم من عميل، طلب رابع من غير تقييم) → `technician_services.completed_count=4` و`average_rating=4.00` بالظبط ((4+3+5)/3) عبر نفس `GET /admin/services/:id/technicians` اللي الشاشة بتستخدمه.

**تحديث تاني — نفس الفجوة بالظبط في `technician_profiles.cancelled_orders_count`، بس الأثر هنا حقيقي مش عرضي (ثقة/أمان مش مجرد شاشة)**: `TechnicianStatsProcessor` الأصلي (فوق) كان بيحدّث `completed_orders_count`/`average_rating`/`total_ratings_count` بس — **مش `cancelled_orders_count`** رغم إنه نفس الجدول ونفس الفلسفة. النتيجة: `public-technician-profile-response.dto.ts` بيحسب `cancellation_rate = cancelledOrdersCount/(completedOrdersCount+cancelledOrdersCount)` ويعرضه للعميل مباشرة في `GET /technicians/:id/profile` (شاشة اختيار الفني) — بما إن العمود مجمّد على `0` للأبد، **كل فني كان بيظهر بمعدل إلغاء 0% كاذب** حتى لو كان عنده تاريخ إلغاءات حقيقي، يعني العميل بيتخذ قرار اختيار الفني على بيانات مصنوعة، مش مجرد رقم ناقص في لوحة إدارة داخلية. الإصلاح: استعلام `completed_orders_count` الأصلي اتوسّع (`FILTER` واحد بدل استعلامين) عشان يحسب `cancelled_orders_count` كمان (`order_status IN cancelled_by_customer/technician/system`) في نفس الـ`UPDATE`. **مشكلة إضافية اتكشفت أثناء الإصلاح**: `enqueueRecalculation()` للفني كان بيتنادى بس عند الاكتمال (`payments`) أو التقييم (`ratings`) — **مفيش نقطة استدعاء عند الإلغاء خالص**، فحتى لو العمود بقى محسوب صح، مفيش حاجة كانت هتشغّل الحساب أصلاً وقت الإلغاء الفعلي. اتضاف `technician-stats-recalculation.listener.ts` جديد (نفس نمط `customers/customer-stats-recalculation.listener.ts` بالحرف) بيسمع `ORDER_STATUS_CHANGED_EVENT` ويجدول إعادة حساب لما `newStatus` يبقى أي `cancelled_by_*` و`technicianId` موجود. **اتعمله اختبار حي حاسم**: فني اتعيّنله طلب (`technician_id` اتحط فعليًا)، العميل لغاه وهو لسه `accepted` → `cancelled_orders_count=1` فورًا، وأهم حاجة — `GET /technicians/:id/profile` (نفس الـ endpoint اللي العميل بيشوفه) رجّع `cancellation_rate: 20` بالظبط (1 إلغاء من أصل 5 قرارات: 4 مكتملة + 1 ملغاة) بدل الـ`0` الكاذب قبل الإصلاح.

### تحقيق عميق في بَقّة "الـ Worker مبيرجّعش يعالج وظايف جديدة بعد انقطاع Redis طويل" — لسه من غير حل

الجانب المنتِج (`enqueueRecalculation` → `queue.add()`) مؤكّد بالاختبار: بيفشل بسرعة (<0.1 ثانية) وبأمان لو Redis واقع، ومايعلّقش الطلب الحقيقي أبداً. لكن الجانب المستهلك (`TechnicianStatsProcessor`) — وبنفس الشكل بالظبط `MatchingRoundExpiryProcessor` في `../matching/README.md` — بعد انقطاع Redis يعدّي شوية (اتعمل اختبار بـ20-25 ثانية outage عدة مرات)، الـ Worker بيوقف عن جلب وظايف جديدة من الطابور تماماً، حتى بعد ما Redis يرجع ويفضل شغال لأكتر من دقيقة — الوظايف تفضل قاعدة بأمان في `wait` list (اتأكد بفحص Redis مباشرة عبر `redis-cli`، مفيش فقدان بيانات إطلاقاً)، لحد ما الـ process يتعاد تشغيله بالكامل.

**اتعمل تحقيق حي مكثّف على 3 محاولات إصلاح متتالية:**

1. **اتصال Redis منفصل للـ Worker عبر `BullModule.forRootAsync(configKey, ...)` + `@Processor({configKey})`** — اكتشفنا إن ده **بيتصرف زي مفيش تأثير خالص**: `@nestjs/bullmq`'s `BullExplorer.getQueueOptions()` بيحل اتصال الـ Worker بالبحث عن Queue متسجّل بنفس اسم الطابور أولاً، ولو لقاه (وهو موجود دايماً هنا، مسجّل بـ`registerQueue()` للـ producer) بيستخدم اتصاله على طول ويتجاهل `configKey` تماماً — الـ fallback لـ`configKey` بيحصل بس لو مفيش Queue متسجّل بنفس الاسم خالص. اتأكد ده بقراءة الكود المصدري لـ`@nestjs/bullmq` نفسه (`bull.explorer.js`).
2. **اتصال منفصل ممرَّر مباشرة (مش عن طريق `configKey`) بـ`enableOfflineQueue` الافتراضي (`true`)** — الفرضية كانت إن `enableOfflineQueue:false` (ضروري للـ Queue) هو اللي بيمنع الـ Worker من التعافي. النتيجة: **أسوأ من قبل**. اتأكد عبر heartbeat تشخيصي مباشر (`worker.isRunning()`/`worker.isPaused()` كل 5 ثواني) إن الـ mainLoop فضل `isRunning()=true` (مش متوقف ظاهرياً) لكن عالق تماماً — أوامر زي الـ`EVALSHA` بتاعة `moveToActive` بتتحجز صامتة في طابور ioredis الداخلي للأبد لو الاتصال لسه مش "ready" فعلياً، من غير أي خطأ يوصّل لمنطق إعادة المحاولة بتاع BullMQ (`retryIfFailed`). اكتشاف جانبي مفيد من المحاولة دي: مفيش مستمع لـ`'error'` event على الـ Worker — Node's EventEmitter بيرمي الخطأ نفسه (throw) لو `'error'` اتبعت وماحدش مستمع ليه، وده كان بيسبب crash صامت لـ`setInterval` بتاع الـ stalled-check timer (ظاهر كـ stack trace خام في اللوج، مش عن طريق الـ logger). اتصلح بإضافة `@OnWorkerEvent('error')` — بَقّة حقيقية اتصلحت، محفوظة في الكود لحد دلوقتي.
3. **نفس الاتصال المنفصل بس بـ`enableOfflineQueue: false` صريحة + مستمع `'error'`** — الفرضية المعاكسة: `enableOfflineQueue:false` بيخلي الأمر يترفض فوراً بدل ما يتحجز، فيدخل مسار `retryIfFailed`'s إعادة المحاولة (اللي بقى آمن دلوقتي بفضل مستمع `'error'`). النتيجة: **نفس العلة بالظبط** — `isRunning()=true` باستمرار، صفر تقدّم، حتى بعد أكتر من دقيقة من رجوع Redis.

**الخلاصة**: البَقّة مش في `enableOfflineQueue` ولا في `configKey` — دول أعراض جانبية اتصلحت فعلاً (ضجيج اللوج، crash صامت). السبب الجذري مطابق لبَقّة موثّقة رسمياً في BullMQ نفسه: [GitHub issue #4479](https://github.com/taskforcesh/bullmq/issues/4479) — الاتصال الـ blocking (اللي بيستخدمه `waitForJob`/`bzpopmin`) مابيتعافاش صح بعد إعادة اتصال، حتى مع الـ "watchdog" mitigation اللي BullMQ نفسه ضايفه في v6.0.9 بالذات (`redis-queue-backend.js`, race بين الأمر الـ blocking وtimeout بيقطع الاتصال ويعيده لو الوقت عدّى) — الـ mitigation ده اتأكد إنه مش كافي في بيئة الاختبار هنا. اتأكد إن مكتبة `bullmq` مثبّتة على أحدث إصدار متاح (`6.0.9`، مفيش نسخة أحدث في الـ registry وقت التحقيق).

**القرار**: وقف محاولات الإصلاح من كود التطبيق (3 محاولات كفاية للتأكد إن المشكلة مش في إعداداتنا)، والاحتفاظ بالتحسينات الحقيقية اللي اتكشفت في الطريق (اتصال Worker منفصل، `@OnWorkerEvent('error')`، `process.on('unhandledRejection', ...)` في `main.ts`).

**تحديث (2026-08-12) — خطة supervisor/health-check/restart اتنفّذت بالكامل، الفجوة اتقفلت عمليًا**:
- **جزء 1 — الاكتشاف (in-process)**: `apps/api/src/modules/ops/queue-watchdog.service.ts` (`QueueWatchdogService`) بيفحص كل الطوابير الثلاثة (`matching-rounds`, `customer-stats`, `technician-stats`) على فترة دورية (`ops.queue_watchdog_check_interval_minutes`, افتراضي دقيقتين) — لو أقدم وظيفة في `wait` list قاعدة أكتر من `ops.queue_watchdog_stall_threshold_minutes` (افتراضي 5 دقايق) **و**`getWaiting()` نفسها نجحت (يعني Redis متاح فعلاً وقت الفحص، مش مجرد انقطاع عادي)، ده بالظبط توقيع البَقّة الموثّقة فوق — بيتسجّل `CRITICAL` واضح وبيتعمل `process.exit(1)` نظيف فورًا (مفيش محاولة "إصلاح" تانية من جوّه نفس الـprocess، التحقيق فوق أثبت إنها مستحيلة).
- **جزء 2 — الاستعادة (خارجي)**: `infra/systemd/baytak-api.service` — وحدة systemd بـ`Restart=always`/`RestartSec=5` بتعيد تشغيل الـprocess تلقائيًا خلال ثواني من الـexit. `main.ts` بقى بينادي `app.enableShutdownHooks()` عشان `onModuleDestroy` (بما فيها إيقاف الـwatchdog نفسه) يتنفّذ نظيف وقت `SIGTERM` بدل ما systemd يستنى `TimeoutStopSec` كامل.
- إعدادات كاملة قابلة للتعديل من `/settings` (`group_name='ops'`, migration `0073`) — بما فيها `ops.queue_watchdog_enabled` لتعطيل الميكانيزم كله لو لزم الأمر.
- **اتعمله اختبار حي حقيقي كامل**: طابور `technician-stats` اتعمله `pause()` مباشرة (بيتاخة نفس أثر الـWorker العالق — الطابور بيستقبل وظايف بس محدش بيعالجها)، وظيفة اتضافت فعليًا، إعدادات الفحص اتأقّتت لثواني بدل دقايق، السيرفر اتعاد تشغيله — الـwatchdog اكتشف الوظيفة الواقفة بالظبط بعد أول دورة فحص، سجّل رسالة `CRITICAL` كاملة، وعمل `process.exit(1)` فعليًا (اتأكد بـ`ps aux` إن الـprocess اختفى). الطابور اترجع `resume()` والوظيفة التجريبية اتشال والإعدادات ارجعت لقيمها الافتراضية بعد التأكيد.
- **الفرق الجوهري عن المحاولات التلاتة السابقة**: دول مكنوش بيحاولوا يصلحوا الاتصال العالق من جواه — كانوا بيحاولوا يمنعوه يعلق أصلاً (فشلوا، البَقّة في المكتبة). الحل ده مختلف فلسفيًا: يقبل إن الـprocess ممكن يعلق أحيانًا، ويكتفي إنه **يكتشف** ده بسرعة ويموت نظيف، ويسيب الاستعادة لطبقة تانية (نفس مبدأ orchestration بتاع Kubernetes/systemd — liveness probe + restart policy، مش محاولة self-healing من جوّه نفس العملية اللي عندها المشكلة).

## بروفايل الفني العام + "إعادة الحجز" — طلب صريح ضمن اقتراحات بروفايل الفني MVP

- **`PATCH /technician/profile`** (جديد): أول endpoint للفني يعدّل نبذته الشخصية (`bio`). العمود نفسه (`technician_profiles.bio`) كان موجود في الـ schema من أول يوم (migration `0005`) بس **مش متربط في الـ entity ولا عنده أي endpoint** — نفس فئة `years_of_experience` (اتضاف للـ response DTO كمان، كان موجود بردو من غير استخدام).
- **`GET /technicians/:id/profile`** (جديد، `PublicTechniciansController`, `@Roles(CUSTOMER)`): بروفايل الفني العام اللي العميل يشوفه — اسم/صورة (من `users`)، نبذة، سنين خبرة، حالة التوثيق (`verification_status` خام، الترجمة لعلامة ✅ مسؤولية الواجهة)، متوسط تقييم + عدد التقييمات، طلبات مكتملة، **معدل الالتزام بالمواعيد**، **معدل الإلغاء**، مناطق العمل (join مع `service_zones`)، الخدمات المؤهّل لها بأسعارها (join مع `technician_services`/`services`)، وآخر 5 تقييمات منشورة بتعليقاتها.
  - **معدل الإلغاء**: بيتحسب مباشرة من `completed_orders_count`/`cancelled_orders_count` الموجودين على `technician_profiles` أصلاً — مفيش استعلام إضافي. `null` (مش `0`) لو مفيش طلبات خالص لسه، عشان مايتفهمش غلط إنه "معدل إلغاء صفر".
  - **معدل الالتزام بالمواعيد** أعقد شوية: `orders.scheduled_at`/`orders.technician_arrived_at` موجودين من زمان بس **مش مستخدمين في أي حساب حقيقي قبل كده**. الحساب هنا مقصور على الطلبات اللي عندها `scheduled_at` فعلي بس (`technician_arrived_at <= scheduled_at + 15 دقيقة` = "في الميعاد") — الطلبات الفورية (ASAP، الغالبية العظمى دلوقتي) **مالهاش وقت متوقّع تتقاس عليه أصلاً**، فمُستبعدة من الحساب مش معتبرة "متأخرة". `null` لو مفيش طلبات مجدولة اتنفّذت لسه (الحالة الحالية لكل الفنيين الحقيقيين في بيانات الاختبار — الحقل جاهز يشتغل صح أول ما طلبات مجدولة حقيقية تتعمل).
- **"إعادة الحجز" — `orders.requested_technician_id` عمود جديد (migration `0046`)**: `POST /orders` بقى ياخد `requested_technician_id` اختياري. **تفضيل بس، مش ضمان**: `matching.service.ts`'s `dispatchNextRound()` بيحاول يعرض **أول جولة بس** حصرياً على الفني المطلوب (نفس شروط الأهلية العادية كاملة — خدمة/منطقة/متاح/معتمد/مش مشغول بالفعل)؛ لو مش متاح دلوقتي، بيكمّل فوراً بالتوزيع العادي لنفس الجولة (**مش** بيلغي الطلب بسبب إن فني واحد بالذات مش متاح). التصميم بإعادة استخدام `findEligibleTechnicians()` الموجودة بس بإضافة فلتر UUID اختياري (`AND ($7::uuid IS NULL OR tp.id = $7)`) — صفر تكرار منطق، صفر جولة/بنية بيانات جديدة.
- **اتعمله اختبار حي كامل**: نبذة اتحدّثت وظهرت في البروفايل العام فوراً؛ عميل شاف بروفايل فني حقيقي (38 طلب مكتمل، 7 تقييمات، منطقتين، خدمة واحدة، آخر تقييماته بالنص الحقيقي)؛ فني حاول يشوف نفس الـ endpoint اترفض 403 (مقصور على العميل)؛ طلب اتعمل بـ`requested_technician_id` — الجولة الأولى اتبعتت **لنفس الفني وبس** (اتأكد مباشرة من `order_assignments`)، وقبلها بنجاح؛ لما نفس الفني بقى مشغول (طلب نشط آخر)، طلب تاني بنفس التفضيل رجع فوراً للتوزيع العادي من غير ما يتلغي بسبب "الفني المفضّل مش متاح" (اتأكد إن السيناريو ده تحديداً بيقفل بصفر فنيين مؤهّلين تانيين حقيقيين في بيانات الاختبار — نفس نتيجة أي طلب عادي بدون تفضيل بالظبط، مش سلوك خاص بالتفضيل). تفاصيل واجهة `apps/customer-app` (`TechnicianProfileScreen`, زرار "إعادة الحجز") في `apps/customer-app/README.md`.

## معرض أعمال الفني عبر لينكات السوشيال ميديا — طلب صريح ضمن اقتراحات بروفايل الفني MVP

جدول جديد `technician_portfolio_links` (migration `0047`) — بدل رفع وتخزين فيديوهات (تكلفة مساحة عالية)، الفني بيحط لينك لفيديو موجود بالفعل على حسابه (تيك توك/يوتيوب/انستجرام/فيسبوك)، ويتشغل مضمّن (embed) جوّه بروفايله في التطبيق. تخزين شبه صفر (نص بس)، وتسويق عضوي مجاني.

- **`POST/GET/DELETE /technician/portfolio-links`** (`PortfolioLinksService`، جديد بالكامل): إضافة لينك (حد أقصى 12 لكل فني)، قايمة، حذف — ownership check صريح على الحذف.
- **كشف المنصة من الدومين تلقائي** (`detectPlatform()`) — `tiktok.com`, `youtube.com`/`youtu.be`, `instagram.com`, `facebook.com`/`fb.watch`. أي دومين تاني بيترفض `400` بوضوح.
- **جلب معاينة (thumbnail/title) عبر oEmbed وقت الإضافة — فشل صامت ومقصود في كل خطوة**: تيك توك ويوتيوب عندهم oEmbed عام بلا مفتاح، شغالين فوراً. انستجرام/فيسبوك بقى محتاج Facebook Graph API access token حقيقي (`social.facebook_graph_access_token`, إعداد جديد في `/settings` — migration `0048` — مش env var، عشان يتغيّر من غير نشر كود جديد). من غير المفتاح، بنتجاهل نداء الـ oEmbed من الأساس (مش بنحاول ونفشل) — اللينك لسه بيتحفظ عادي بس من غير `thumbnail_url`. أي فشل تاني (رابط غلط، المنصة رجّعت خطأ) بيتلقّط ويتسجّل تحذير — أبداً مايمنعش حفظ اللينك نفسه.
- **معروض في `GET /technicians/:id/profile` العام** (قسم فوق) — `portfolio_links` جديدة في الـ response، مرتبة بـ`display_order`.
- **اتعمله اختبار حي كامل**: لينك يوتيوب حقيقي اتضاف — `platform` اتكشف صح، `thumbnail_url` رجع `null` بأمان (البروكسي في بيئة التطوير دي بيمنع الوصول لـ`youtube.com` — نفس القيد الموثّق لباقي التكاملات الخارجية، مش بَقّة في الكود؛ اتأكد السلوك السليم من اللوج: تحذير واضح + `200` نجاح مش `500`)، لينك انستجرام من غير مفتاح Graph API اتحفظ عادي بـ`thumbnail_url=null`، لينك من دومين مش مدعوم اترفض `400`، القايمة والحذف اشتغلوا صح، واللينكات ظهرت في البروفايل العام للعميل.
- **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي (مش في الباك-إند — في `apps/technician-app`)**: `core/api_client.dart`'s `_send()` مكانتش بتدعم `DELETE` method خالص (بس `GET`/`POST`/`PATCH`) — أول استخدام لـ`DELETE` في التطبيق ده كان `PortfolioRepository.remove()`، فالبَقّة اتكشفت أول ما اتعمل. اتصلحت بإضافة `case 'DELETE': return http.delete(...)`. `apps/customer-app`'s نسخة كانت أصلاً بتدعم `DELETE` (مستخدمة لحذف العناوين من زمان).

## `GET /technician-companies` — تصفّح "اعتماد" للعميل (صُنّاع، `docs/06` §1.5، `docs/07` الجزء أ)

`PublicTechnicianCompaniesController` (جديد، `@Roles(CUSTOMER)`) — العميل يقدر يشوف الشركات/الفرق **النشطة بس** عشان يختار واحدة يحجزها كاملة لطلب "اعتماد" (بدل ما يسيب المطابقة تختار له). `TechnicianCompaniesService.listActiveCompanies()` (جديدة) بتفلتر `is_active=true` — مختلفة عمداً عن `listForAdmin()` الموجودة (بترجع الكل، نشطة أو لأ، للإشراف). `toPublicCompanyResponseDto()` (جديدة) بترجّع `id`/`name`/`branch_count`/`staff_count` بس — **من غير** `owner_user_id`/`commercial_registration_number` اللي بترجعهم `toCompanyResponseDto()` العادية (بيانات إدارية داخلية مالهاش داعي تتعرض للعميل).

كمان `findActiveCompanyOrThrow()` (جديدة، عامة) — مستخدمة من `orders.service.ts` وقت إنشاء طلب "اعتماد" بشركة محدّدة (`requested_technician_company_id`)، بترمي 404 واضح لو الشركة مش موجودة أو مش نشطة. تفاصيل كاملة لاستهلاك ده في إنشاء الطلب في `../orders/README.md`.

**اتعمله اختبار حي**: فني اترقّى لـ`premium` (`can_lead_team`) وأنشأ شركة حقيقية، `GET /technician-companies` (عميل) عرضها صح بالحقول المسموحة بس، وربطها بطلب حقيقي عبر `requested_technician_company_id` نجح (تفاصيل الاختبار الكامل في `../orders/README.md`).

## "معاه مساعد؟" + تصنيف نوع الفني الأربعة — صُنّاع (`docs/06` §3.7-§3.8، `docs/07` الجزء د)

`technician_profiles.assistant_technician_id`/`assistant_link_status` (enum `none`/`pending_approval`/`approved`, migration `0055`) — الفني بيطلب ربط مساعد بكود موظفه (`technician_code`, `POST /technician/assistant-request`)، الإدارة توافق/ترفض (`POST /admin/technicians/:id/assistant/approve|reject`, صلاحية `technicians.approve` الموجودة). إزالة الربط ذاتية (`DELETE /technician/assistant`) — مفيش داعي موافقة إدارة لفك ربط، بس لتكوينه من الأول.

- **قرار معماري قبل أي كود**: راجعت الكود القديم قبل ما أبدأ ولقيت "فريق"/"شركة" (docs/06 §3.8، نقطتين 3-4) **متعمَّلين بالفعل** عن طريق `technician_companies` (migration `0026`) — الفرق الوحيد `commercial_registration_number` (موجود=شركة، فاضي=فريق، قرار سابق موثّق في هذا الملف). يعني التصنيف الرباعي (`TechniciansService.classifyType()`, جديد) دالة على بيانات موجودة، مش مفهوم جديد: `company_id`/`team_role` (شركة/فريق) له أولوية، وإلا `assistant_link_status=approved` (فرد+مساعد) وإلا فرد.
- **`GET /technician/me`** بقى بيرجّع `technician_type` (`individual`/`individual_with_assistant`/`team`/`company`) محسوب لحظياً — مش عمود مخزّن، تفادي احتمال عدم اتساق.
- **اتعمله اختبار حي كامل**: فني عضو شركة (بدون سجل تجاري) رجع `team`؛ بعد ما أضاف سجل تجاري لشركته رجع `company` فورًا؛ فني تاني (مستقل، بدون شركة) رجع `individual`؛ طلب ربط مساعد بكود حقيقي رجّع `pending_approval` (والنوع فضل زي ما هو لحد الموافقة)، الأدمن وافق ورجّع `approved`، محاولة موافقة تانية على نفس الطلب اترفضت بوضوح (مفيش `pending` تاني).
- **فجوة موثّقة صراحة**: زرار "طلب مساعد" (المالك: "النظام يدور على مين متاح من المساعدين ويربطهم مع بعض") — auto-matching تلقائي مش موجود هنا؛ محتاج مفهوم "مساعدين متاحين للربط" مش موجود في القاموس، فمش هنخترعه. المسار الحالي: الفني بيحدد المساعد بنفسه بكوده (زي ما المصدر الأصلي وصف "بربط Employee ID" بالحرف).

## جدولة الفني الحقيقية (Scheduler) — صُنّاع (`docs/08` §2، ADR-0002) — ✅ خلص بالكامل (العرض/الإدارة + الربط بإنشاء الطلب)

كانت فجوة موثّقة صراحة في `docs/08`: `technician_profiles.is_available`/`is_on_duty` مفتاحين on/off بس، مفيش تاريخ/وقت مرتبط بيهم خالص — مفيش جدول أسبوعي/شهري. اتقفلت بجدول جديد `technician_schedule_slots` (migration `0058`) — سلوتات كصفوف صريحة (تاريخ + وقت بداية/نهاية + حالة `available`/`booked`/`blocked`)، **مش نمط تكراري** (القرار الكامل وسبب رفض RRULE في `docs/adr/0002-technician-scheduler.md`).

- **`TechnicianScheduleService`** (جديد، داخل `technicians` مش موديول مستقل — امتداد مباشر لبيانات الفني نفسه): `createSlot()` بيرفض التداخل مع سلوت موجود لنفس اليوم (فحص كود، مش DB constraint — Postgres مالوش EXCLUDE بسيط على range زمني من غير امتداد `btree_gist` اتجنبناه في أول نسخة). `bookSlot()` **ذرّي بالكامل**: `UPDATE ... WHERE status='available'` واحد (مش SELECT-then-UPDATE) — لو طلبين حاولوا يحجزوا نفس السلوت بالتوازي، واحد بس ياخده. `releaseSlotForOrder()` بترجّع السلوت متاح لو الطلب اتلغى.
- **`POST/GET/DELETE /technician/schedule`** (الفني بيدير جدوله بنفسه — "يخش كل أسبوع يحط اللي هو فاضي فيه" زي ما المالك طلب بالحرف). `DELETE` بيرفض بوضوح لو السلوت `booked` بطلب فعلي.
- **`GET /technicians/:id/schedule`** (عام، `@Roles(CUSTOMER, ADMIN)` — الأدمن اتضاف docs/08 §25.2، 2026-08-15، عشان يقدر يختار سلوت حقيقي وقت حل نزاع "زيارة فاشلة" في `admin-orders`) — نسخة العميل "أخضر/أحمر" بس (`is_available` boolean)، مفيش `order_id` ولا `notes_ar` داخلية (`PublicScheduleSlotResponseDto` منفصل عمداً عن `ScheduleSlotResponseDto`).
- **اتعمله اختبار حي كامل**: فني أنشأ سلوت متاح + سلوت "إجازة" (`blocked`) لنفس اليوم، محاولة سلوت تالت متداخل زمنيًا اترفضت بوضوح. العميل شاف الجدول العلني — السلوت الأول `is_available:true` (أخضر) والتاني `false` (أحمر)، من غير أي بيانات داخلية مسرّبة. **اختبار سباق حقيقي على مستوى الداتابيز**: تحديثين متزامنين (`psql` بالتوازي) بيحاولوا يحجزوا نفس السلوت — `UPDATE 1` / `UPDATE 0` بالظبط، واحد بس نجح. محاولة حذف سلوت وهو محجوز اترفضت بوضوح.

### الربط الكامل مع `OrdersService.create()` — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

`bookSlot()`/`releaseSlotForOrder()` كانوا primitives جاهزين ومختبرين بلا أي caller خالص — العميل مكانش يقدر يحجز على سلوت محدد من التطبيق أصلاً. اتقفلت:

- **`CreateOrderDto.schedule_slot_id`** اختياري — لو اتبعت، `OrdersService.create()` بينادي `TechnicianScheduleService.findAvailableSlotOrThrow()` (فحص واضح قبل أي التزام) وبيشتق منها **تلقائيًا**: `requestedTechnicianId = slot.technicianId` (أقوى من تفضيل عادي — الفني نفسه أعلن التوافر في الوقت ده صراحة، مش تخمين)، و`scheduledAt = combine(slot.slotDate, slot.startTime)` بصيغة UTC مباشرة (نفس اتفاقية المشروع، `${slotDate}T${startTime}Z`).
- **متبادل استبعادياً مع**: `booking_mode=emergency` (استجابة فورية، مش موعد مستقبلي بمعنى مختلف تمامًا)، و`original_order_id` (إعادة الزيارة بترجع لنفس الفني الأصلي تلقائيًا أصلاً). لو `requested_technician_id` اتبعت كمان بقيمة **مختلفة** عن فني السلوت، بترفض بوضوح ("اختار واحد بس") — مش هنفترض أنهيهم يكسب.
- **الحجز الذرّي جوّه نفس transaction إنشاء الطلب**: `bookSlot()` بقت تاخد `manager: EntityManager` اختياري — `OrdersService.create()` بتبعتلها manager الـtransaction بتاعتها، فلو حد تاني حجز نفس السلوت في نفس اللحظة (سباق حقيقي)، الطلب كله بيترول باك (رفض `409` واضح) مش يتعمل بلا سلوت فعلي بيشاور عليه.
- **`ScheduleSlotReleaseListener`** (جديد، نفس نمط `TechnicianStatsRecalculationListener` بالحرف) — بيسمع `ORDER_STATUS_CHANGED_EVENT` مركزيًا، وبيحرر السلوت (`releaseSlotForOrder`) لو الطلب اتلغى بأي طريقة (عميل/فني/إداري/تلقائي — 4 أماكن مختلفة في `orders` module، استماع مركزي واحد بدل تعديل الأربعة). idempotent تمامًا (`WHERE order_id=X` بس)، صفر أثر جانبي لطلب مالوش سلوت أصلاً.
- **قرار موثّق صراحة**: التوزيع (`matching.dispatchNextRound`) لسه **فوري** وقت إنشاء الطلب مش مؤجّل لوقت السلوت نفسه — نفس السلوك الحالي بالظبط لـ`scheduled_at` العادي (اللي أصلاً مالوش أي توزيع مؤجّل حقيقي، `OrderDispatchListener` بينادي فورًا مهما كانت القيمة). توزيع مؤجل حقيقي محتاج queue جديدة بالكامل مش موجودة حتى للحقل القديم، فمش هنخترعها بس هنا.
- **`apps/customer-app`**: `TechnicianProfileScreen` بقى بيعرض قسم "مواعيد فاضية" (السلوتات `is_available` بس من `GET /technicians/:id/schedule`)، الضغط على سلوت بيفتح نفس تدفق اختيار الخدمة اللي "إعادة الحجز" بيستخدمه، وبعدها `CreateOrderScreen` بـ`scheduleSlotId` بدل `requestedTechnicianId`.
- **اتعمله اختبار حي كامل**: طلب حقيقي بـ`schedule_slot_id` أنتج `requested_technician_id` مطابق لفني السلوت بالظبط، `scheduled_at` مطابق لتاريخ/وقت السلوت، `order_assignments` الجولة الأولى اتوزعت **حصريًا** على فني السلوت (صف واحد بس). إلغاء الطلب (عميل، وبعدين فني بعد قبول منفصل) حرّر السلوت فورًا (`status=available, order_id=NULL`) في الحالتين. **سباق حقيقي**: عميلين حاولوا يحجزوا نفس السلوت بالتوازي — واحد بس نجح، التاني اترفض `409` واضح، صفر صف orphan. رفض واضح للتوليفات المتعارضة الثلاثة: طوارئ+سلوت، إعادة زيارة+سلوت، فني مطلوب مختلف+سلوت.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.

## بروفايل الفني العام — تحسينات (صُنّاع، `docs/08` §4) — ✅ خلص

فجوات كانت موثّقة صراحة في `docs/08` §4، اتقفلت كلها ما عدا الضمان (`docs/08` §7 — قسم منفصل عمداً):

- **متوسط وقت الوصول (`avg_arrival_minutes`) ومتوسط مدة التنفيذ (`avg_completion_minutes`)** — مقاييس جديدة في `GET /technicians/:id/profile`. مبنيين على أعمدة موجودة من زمان في `orders` بس **مش مستخدمين في أي حساب قبل كده**: وقت الوصول = المتوسط بين `technician_departed_at` ("طالع للعميل") و`technician_arrived_at` (وصل فعليًا) — مش من وقت القبول، عشان القبول ممكن يسبق الوصول بساعات/أيام في الحجز المسبق ووقت الرحلة نفسه هو اللي بيعبّر عن السرعة. مدة التنفيذ = المتوسط بين `work_started_at` و`work_completed_at`. زي `on_time_rate`، بيرجعوا `null` (مش صفر مضلّل) لو مفيش طلبات كفاية عندها الطابعين الزمنيين.
  - **ملاحظة صريحة من الاختبار الحي**: مراجعة `on_time_rate` نفسه (المذكور في `docs/08` كأنه "دايمًا null") لقيت إن الحساب أصلاً **صحيح ومش بَقّة** — بيرجّع `null` لسبب سليم (مفيش طلبات مجدولة `scheduled_at` اتنفّذت لسه في بيانات الاختبار)، مش خطأ في المنطق. اتسجّل هنا صراحة عشان محدش "يصلّح" حاجة مش فعلاً عطلانة.
- **شهادات/كورسات الفني (`technician_certificates`, migration `0059`)** — جدول جديد منفصل تمامًا عن `technician_documents` (مستندات KYC خاصة، بتتراجع وقت التسجيل، أبداً مبتتعرضش للعميل). ده تسويقي بالكامل: الفني بيرفع شهادة/كورس (عنوان + جهة مانحة اختيارية + تاريخ اختياري + ملف صورة/PDF نفس قيود `technician_documents`)، **ولازم مراجعة أدمن (`approve`/`reject`) قبل ما تبان في البروفايل العام** — بالظبط نفس منطق `reviewDocument()` (بما فيه: قرار نهائي مش قابل للتكرار، `pending`→`approved`/`rejected` بس)، وبيعيد استخدام نفس enum `document_review_status` ونفس صلاحية `technicians.review_documents` بدل ما يخترع جديدة.
  - **`POST/GET/DELETE /technician/certificates`** (`TechnicianCertificatesService`، جديد بالكامل) — نفس نمط رفع الملفات في `technician-documents.service.ts` بالظبط (نفس أنواع MIME المسموحة، نفس حد 10MB).
  - **`POST /admin/technicians/:id/certificates/:certificateId/review`** — مراجعة الأدمن، مسجّلة في `audit_log` (`technician.certificate_reviewed`).
  - **`GET /technicians/:id/profile`** بقى بيرجّع `certificates` — **المعتمدة (`approved`) بس** (`listApprovedForTechnician()`)، بحقول عامة محدودة (بدون `review_status`/`rejection_reason`/`reviewed_by_user_id` الداخلية — `PublicCertificateResponseDto` منفصل عمداً عن `CertificateResponseDto` بنفس فلسفة الفرق بين `ScheduleSlotResponseDto`/`PublicScheduleSlotResponseDto`).
  - **Admin UI لمراجعة الشهادات — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)**: `POST /admin/technicians/:id/certificates/:certificateId/review` كان جاهز ومختبر بلا أي شاشة أدمن — الأدمن كان لازم يوافق/يرفض عبر curl/Postman يدويًا. `GET /admin/technicians/:id` (تفاصيل الفني في `apps/admin`) بقى بيرجّع `certificates` كمان (زي `documents` بالظبط) — `AdminTechnicianDetailResponseDto`/`toAdminTechnicianDetailResponseDto()` اتوسّعوا، والـcontroller بقى بينادي `certificatesService.listForTechnician(id)`. صفحة تفاصيل الفني (`apps/admin/src/app/technicians/[id]/page.tsx`) بقى فيها كارت "الشهادات" جديد — نفس نمط كارت "المستندات" الموجود بالحرف (جدول: عنوان/جهة مانحة/حالة/فتح الملف/إجراء اعتماد-رفض). **اتأكد حي بالكامل**: فني رفع شهادة حقيقية → ظهرت `pending` في تفاصيل الفني بالأدمن → Playwright ضغط "اعتماد" فعليًا في المتصفح الحقيقي → الحالة اتحوّلت لـ"معتمدة" في الجدول فورًا (screenshot يثبت ده). `packages/shared-types` اتحدّث (`CertificateResponseDto` جديد، `AdminTechnicianDetailResponseDto.certificates`).
- **اتعمله اختبار حي كامل**: فني رفع شهادة PDF حقيقية (عنوان + جهة مانحة + تاريخ) — ظهرت `pending` في قايمته الخاصة، **ومحجوبة تمامًا** من البروفايل العام في نفس الوقت (اتأكد من `certificates: []` في استجابة العميل). أدمن حاول يرفض من غير سبب — اترفض `VAL_001` بوضوح (نفس تحقق `ReviewDocumentDto`). أدمن وافق — ظهرت فورًا في البروفايل العام بالحقول العامة بس. محاولة مراجعة تانية لنفس الشهادة اترفضت `409` ("اترجع عليها قبل كده"). فني رفع ملف `.exe` — اترفض `400` بوضوح (نفس فلترة MIME). فني حذف الشهادة بنفسه — اختفت من البروفايل العام فورًا. متوسطات الوصول/التنفيذ اتحسبت صح على طلبات اختبار حقيقية سابقة (قيم قريبة من صفر دقيقة، متوقّع لأن الطلبات دي كانت محاكاة سريعة زمنيًا — مش بَقّة، الحساب نفسه `EXTRACT(EPOCH FROM ...) / 60` سليم ومتحقق منه رياضيًا).
- **نطاق متعمّد لسه برّه**: الضمان (`docs/08` §7) قسم منفصل تمامًا، مش جزء من التحسينات دي. معرض الصور (بخلاف لينكات السوشيال ميديا الموجودة أصلاً) لسه مش مطلوب توسيع فيه — لينكات السوشيال ميديا بتغطي الاحتياج الأساسي دلوقتي.

### **فجوة UI حقيقية اتلقطت لاحقًا واتقفلت (بناء 2026-08-12، تدقيق backend-vs-UI شامل)**: `avg_arrival_minutes`/`avg_completion_minutes`/`certificates` كانوا مختبرين حي في الباك-إند فوق، بس `TechnicianPublicProfile.fromJson()` (customer-app) **مكانتش بتقرأهم خالص من الـJSON**، و`TechnicianProfileScreen` معندهاش أي widget يعرضهم — العميل ميكنش يشوف شهادات الفني ولا متوسطات الوصول/التنفيذ خالص رغم إن الباك-إند بيرجّعهم من زمان. الموديل بقى فيه الحقول التلاتة + كلاس `TechnicianCertificate` جديد، والشاشة بقى فيها سطر متوسطات تحت كارت الإحصائيات وقسم "الشهادات" (أيقونة + عنوان + جهة مانحة + تاريخ). **اتأكد حي بالكامل**: فني حقيقي رفع شهادة، أدمن وافق عليها، `GET /technicians/:id/profile` رجّع الشهادة بالحقول الأربعة بالظبط اللي الموديل الجديد بيتوقعها، ونفس الطلب أكّد وجود `avg_arrival_minutes`/`avg_completion_minutes` في الرد.

## `GET /services/:id/technicians` مربوط فعليًا بـCustomer App — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

**الفجوة اللي اتلقطت (تدقيق backend-vs-UI شامل)**: الـ endpoint نفسه (`@Public()`, `docs/08` §3 — قايمة فنيين مؤهّلين للخدمة في منطقة العميل، مرتبة تقييم→قرب→طلبات مكتملة) كان موجود ومختبر حي من سيشن سابقة — **بس مفيش أي شاشة في `apps/customer-app` بتناديه خالص**. `ServicesScreen` كانت بتودّي العميل مباشرة من اختيار الخدمة لـ`CreateOrderScreen` (auto-match بس)، و`TechnicianProfileScreen` (اللي بيستخدم نفس الـ endpoint التاني `GET /technicians/:id/profile`) كان متاح بس من مسار "إعادة الحجز" (`order_detail_screen.dart`)، مش من تدفق الحجز الجديد. مطابق تمامًا لتعريف "backend-only مش complete" — العميل ميكنش يقدر يختار فني بنفسه قبل الحجز أصلاً.

**الحل**: `TechnicianSelectionScreen` جديدة في `apps/customer-app` — بتظهر بعد اختيار الخدمة (بس لـ`booking_mode=individual`؛ "اعتماد" ليها اختيار شركة/فريق منفصل جوّه `CreateOrderScreen`، و"طوارئ" بتتوزّع تلقائيًا بالكامل زي ما هي). بتطلب عنوان الأول (`GET /services/:id/technicians` محتاج `address_id` إجباري)، وبعدين بتعرض "اختار لي تلقائيًا (أسرع)" بشكل بارز فوق كروت الفنيين (اسم/تقييم/عدد طلبات مكتملة/مسافة)، مع زرار "البروفايل الكامل" لكل كارت بيوديك لـ`TechnicianProfileScreen` الموجودة. `CreateOrderScreen` بقى فيه `initialAddress` اختياري عشان العنوان اللي اتاختار هنا يتوصّل من غير ما العميل يضطر يختاره تاني. اتأكد حي: `GET /services/:id/technicians?address_id=...` بـcurl على بيانات حقيقية رجّع نفس الشكل بالظبط اللي الموديل الجديد `TechnicianBookingListItem` بيتوقعه.

## مطابقة المساعد التلقائية — موديول منفصل جديد، راجع `../assistant-matching/README.md`

قرار عمل صريح من المالك (2026-08-13، ADR-0007) — بعد ما الفني القائد يقبل الطلب، لو الطلب محتاج مساعد (`orders.required_assistants`)، النظام بيدوّر على المساعد الشخصي المعتمد بتاع الفني (`assistant_link_status`/`assistant_technician_id` الموجودين هنا فوق) أولاً، وبعدين مجمع مساعدين مؤهلين بالبث التنافسي الذرّي لو مفيش. **مش موديول `technicians` نفسه عمدًا** — منطق مختلف تمامًا (قبول تنافسي على شريحة عمل، مش طلب كامل)، تفاصيل التصميم والاختبار الحي الكامل في `../assistant-matching/README.md`.

## بَقّة حقيقية اتلقطت واتصلحت (2026-08-13) — `deleted_at` ناقص من إحصائيات البروفايل العام

ثلاث استعلامات في `getPublicProfile()` (معدّل الالتزام بالمواعيد `on_time_rate`، متوسط وقت
الوصول، متوسط مدة إنهاء الخدمة) كانت بتحسب على `FROM orders WHERE technician_id=...` من غير
`AND deleted_at IS NULL` — طلب اتعمله soft-delete كان لسه بيؤثّر على مقاييس أداء الفني الظاهرة
للعميل (`GET /technicians/:id/profile`) رغم إن الطلب نفسه مش ظاهر لحد. نفس البَقّة موجودة كانت
في `technician-stats.processor.ts` (`completed_orders_count`/`cancelled_orders_count`/
`technician_services.completed_count` — الأعمدة المخزّنة اللي بتتحدّث دوريًا) — كلهم اتصلحوا
بإضافة `AND deleted_at IS NULL`.

## إعادة الجدولة (docs/08 §22 بند 9-12، 2026-08-15)

`TechnicianScheduleService.rescheduleSlot(orderId, newSlotId, manager)` — تحرير السلوت القديم
وحجز الجديد ذرّيًا جوّه transaction واحدة (بيستخدم `bookSlot()` الذرّية الموجودة وراها) — لو حجز
الجديد فشل (اتحجز من عميل تاني بينهم)، التحرير القديم بيترول باك تلقائيًا (نفس الـtransaction)،
صفر خسارة صامتة لموعد العميل الأصلي وصفر حجز مزدوج للفني ممكن يحصل بأي حال. مُستخدم من
`OrdersService.reschedule()` (`../orders/README.md`).
