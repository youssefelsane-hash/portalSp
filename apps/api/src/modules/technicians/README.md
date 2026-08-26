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

- **`TechnicianScheduleService`** (جديد، داخل `technicians` مش موديول مستقل — امتداد مباشر لبيانات الفني نفسه): `createSlot()` يحتفظ بفحص التداخل لرسالة UX واضحة، والفرض النهائي موجود في PostgreSQL عبر exclusion constraint على range نصف مفتوح (`[start,end)`) أضافته migration `0118` باستخدام `btree_gist`. طلبا إنشاء متداخلان بالتوازي لا يمكن أن ينجحا معًا، بينما سلوتان متجاوران مثل 10–11 و11–12 مسموحان. `bookSlot()` **ذرّي بالكامل**: `UPDATE ... WHERE status='available'` واحد، و`releaseSlotForOrder()` بترجّع السلوت متاح لو الطلب اتلغى.
- **`POST/GET/DELETE /technician/schedule`** (الفني بيدير جدوله بنفسه — "يخش كل أسبوع يحط اللي هو فاضي فيه" زي ما المالك طلب بالحرف). `DELETE` بيرفض بوضوح لو السلوت `booked` بطلب فعلي.
- **`GET /technicians/:id/schedule`** (عام، `@Roles(CUSTOMER, ADMIN)` — الأدمن اتضاف docs/08 §25.2، 2026-08-15، عشان يقدر يختار سلوت حقيقي وقت حل نزاع "زيارة فاشلة" في `admin-orders`) — نسخة العميل "أخضر/أحمر" بس (`is_available` boolean)، مفيش `order_id` ولا `notes_ar` داخلية (`PublicScheduleSlotResponseDto` منفصل عمداً عن `ScheduleSlotResponseDto`).
- **اتعمله اختبار حي كامل**: فني أنشأ سلوت متاح + سلوت "إجازة" (`blocked`) لنفس اليوم، محاولة سلوت تالت متداخل زمنيًا اترفضت بوضوح. العميل شاف الجدول العلني — السلوت الأول `is_available:true` (أخضر) والتاني `false` (أحمر)، من غير أي بيانات داخلية مسرّبة. **اختبار سباق حقيقي على مستوى الداتابيز**: تحديثين متزامنين (`psql` بالتوازي) بيحاولوا يحجزوا نفس السلوت — `UPDATE 1` / `UPDATE 0` بالظبط، واحد بس نجح. محاولة حذف سلوت وهو محجوز اترفضت بوضوح.

### الربط الكامل مع `OrdersService.create()` — كانت فجوة موثّقة صراحة، اتقفلت (بناء 2026-08-12)

`bookSlot()`/`releaseSlotForOrder()` كانوا primitives جاهزين ومختبرين بلا أي caller خالص — العميل مكانش يقدر يحجز على سلوت محدد من التطبيق أصلاً. اتقفلت:

- **`CreateOrderDto.schedule_slot_id`** اختياري — لو اتبعت، `OrdersService.create()` بينادي `TechnicianScheduleService.findAvailableSlotOrThrow()` (فحص واضح قبل أي التزام) وبيشتق منها **تلقائيًا**: `requestedTechnicianId = slot.technicianId` (أقوى من تفضيل عادي — الفني نفسه أعلن التوافر في الوقت ده صراحة، مش تخمين)، و`scheduledAt = combine(slot.slotDate, slot.startTime)` بصيغة UTC مباشرة (نفس اتفاقية المشروع، `${slotDate}T${startTime}Z`).
- **متبادل استبعادياً مع**: `booking_mode=emergency` (استجابة فورية، مش موعد مستقبلي بمعنى مختلف تمامًا)، و`original_order_id` (إعادة الزيارة بترجع لنفس الفني الأصلي تلقائيًا أصلاً). لو `requested_technician_id` اتبعت كمان بقيمة **مختلفة** عن فني السلوت، بترفض بوضوح ("اختار واحد بس") — مش هنفترض أنهيهم يكسب.
- **الحجز الذرّي جوّه نفس transaction إنشاء الطلب**: `bookSlot()` بقت تاخد `manager: EntityManager` اختياري — `OrdersService.create()` بتبعتلها manager الـtransaction بتاعتها، فلو حد تاني حجز نفس السلوت في نفس اللحظة (سباق حقيقي)، الطلب كله بيترول باك (رفض `409` واضح) مش يتعمل بلا سلوت فعلي بيشاور عليه.
- **`ScheduleSlotReleaseListener`** — بيسمع `ORDER_STATUS_CHANGED_EVENT` مركزيًا، وبيحرر السلوت (`releaseSlotForOrder`) عند الإلغاء أو رجوع الطلب لإعادة المطابقة/اختيار بديل. listener مش ضمان وحيد: `reconcileReleasedSlots()` تعمل فحص PostgreSQL محدودًا (25 صفًا كل دقيقة) لحالات الإلغاء، إعادة الاختيار، أو اختلاف فني الطلب عن فني السلوت، ثم تحررها بـupdate ذرّي. crash بعد commit وقبل event لا يحجز موعد الفني للأبد، وتشغيل أكثر من instance idempotent.
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

## زرار أونلاين/أوفلاين — Script 4 §8 (2026-08-18)

كانت فجوة موثّقة صراحة (اكتشفتها مراجعة Script 4 التحضيرية): `PATCH /technician/availability`
كان مبني ومختبر بالكامل من زمان (`is_available`/`is_on_duty`، راجع السطر التاسع فوق)، بس **مفيش
شاشة في `apps/technician-app` كانت بتناديه خالص** — الفني مالوش أي طريقة يوقف/يبدأ استقبال طلبات
جديدة غير إن الأدمن يلمسها له. الفجوة كانت UI بحتة، صفر شغل backend مطلوب غير حاجة واحدة صغيرة:
`TechnicianProfileResponseDto` (بروفايل الفني الذاتي) كان ناقص `is_on_duty` رغم إن
`admin-technician-response.dto.ts` (بروفايل نفس الفني من عين الأدمن) بيرجّعه من زمان — اتضاف هنا
(`dto/technician-profile-response.dto.ts`).

**قرار تصميم**: زرار واحد مش اتنين. فحصت كل مكان بيقرر أهلية المطابقة
(`matching.service.ts:137`, `technician-assignment-guard.service.ts:29`,
`assistant-matching.service.ts` مرتين) ولقيت `is_available`و`is_on_duty` شرط "و" معًا في كل
واحدة منهم من غير أي فرق دلالي مفيد للفني نفسه — فمفيش داعي لتوجيهين، الزرار بيبدّل الاتنين مع
بعض دايمًا عبر نداء واحد.

**التنفيذ**: `AvailableOrdersScreen` (الشاشة الرئيسية للفني بعد تسجيل الدخول، `main.dart`'s
`_VerificationGate`) بقى فيها `_DutyToggleBar` أعلى قايمة الطلبات المتاحة مباشرة — أهم فعل تشغيلي
على الشاشة، مش داخل بروفايل ثانوي. `OnboardingRepository.setOnDuty()` جديدة بتنادي
`PATCH /technician/availability` بـ`{is_available, is_on_duty}` الاتنين بنفس القيمة.

**اختبار حي**: اتعمل login حقيقي بالفني المزروع (`+201055501234`, `TECH-000011`) عبر OTP الحقيقي،
`PATCH .../availability` اتنادى بـ`false` ثم `true` والقيمتين اتأكدوا في `technician_profiles`
مباشرة بـ`psql` مش بس رد الـAPI (`is_available`/`is_on_duty` رجعوا `f`/`f` ثم `t`/`t` في الجدول
فعلاً). `flutter analyze` و`flutter test` (5/5) عدّوا نضيف على `apps/technician-app`.

**فشل آمن متعمّد**: `_loadMe()` بتلبّس الفشل بـ`ApiException` صامت — الشريط بيختفي بس، مش بيمنع
عرض قايمة الطلبات المتاحة العادية (نفس فلسفة `_VerificationGate` في `main.dart`).

## تصريح مهارات ذاتي + موافقة أدمن — Script 4 §2-7 (2026-08-18)

كانت فجوة موثّقة صراحة (Script 4 Part B): الفني ≠ مجرد `technician=true` — لازم نعرف بالظبط إيه
الشغل المسموح له يستلمه. `technician_services` كان 100% معيّن من الأدمن يدوياً
(`AdminCatalogService.assignTechnician()`)، صفر مسار للفني يطلب خدمة بنفسه.

**Schema (`infra/migrations/0130_technician_service_self_declaration.sql`)**: أضاف
`verification_status` (`pending_verification`/`approved`/`rejected`/`suspended`)،
`is_self_declared`، `rejection_reason`، `reviewed_by_user_id`، `reviewed_at` لـ`technician_services`.
Default `approved` للصفوف الموجودة وأي تعيين أدمن جديد (`assignTechnician()` اتعدّل يحطها صراحة) —
صفر خطر ترحيل، صفر مطالبة رجعية بإعادة اعتماد شغل شغّال بالفعل. `DECLARED`/`PENDING_VERIFICATION`
اتدمجوا في حالة واحدة (`pending_verification`) — نفس فلسفة الحالات الوسيطة في
`technician-verification-state-machine.ts` (مفيش endpoint حقيقي يفرّق بينهم لسه).

**أهلية المطابقة (non-negotiable, server-side)**: `matching.service.ts`،
`assistant-matching.service.ts`، `technician-assignment-guard.service.ts` التلاتة اتعدّلوا يضيفوا
`AND verification_status = 'approved'` صراحة جنب `is_active = true` الموجود من زمان — دفاع مزدوج
(is_active وحده كافي فعليًا بحكم البناء، بس صريح أوضح وأقوى ضد أي تغيير مستقبلي).

**الفني (`technicians.controller.ts`)**: `GET/POST/DELETE /technician/services` —
`declareService()` بيرفض تصريح مكرر لخدمة `pending`/`approved`/`suspended` بالفعل (409)، بس بيسمح
بإعادة التصريح لو الحالة `rejected` (نفس الصف بيترقّى لـ`pending_verification` تاني، مش تكرار).
`withdrawService()`: `pending`/`rejected` → حذف فعلي (مفيش تاريخ يستاهل)، `approved` → تعطيل بس
(`is_active=false`، السجل التاريخي فاضل)، `suspended` → 403 (قرار أدمن، الفني ميقدرش يلمسه).

**الأدمن (`admin-technicians.controller.ts`, صلاحية `technicians.approve` — نفس صلاحية اعتماد
الفني نفسه، قرار مشابه بالطبيعة، مفيش namespace جديد)**:
`GET /admin/technicians/service-declarations` (طابور كل التصريحات المعلّقة عبر كل الفنيين، بأسماء
محلولة بـjoin واحد صفر N+1)، `POST .../:id/approve|reject|suspend`. `assignTechnician()` (التعيين
المباشر القديم) اتعدّل كمان: لو الفني عنده تصريح ذاتي `pending`/`rejected`/`suspended` لنفس
الخدمة، الأدمن يقدر يعتمده مباشرة من هنا (نفس الصف بيترقّى) بدل ما يوصل لطريق مسدود.

**apps/admin**: صفحة جديدة `/technicians/service-declarations` (طابور + اعتماد/رفض بسبب عبر
`PromptDialog` الموحّد). **apps/technician-app**: شاشة "مهاراتي" جديدة (`features/skills/`) —
فئة → خدمة (هرمي، نفس الكتالوج الديناميكي اللي العميل بيشوفه، `@Public()` endpoints بالحرف، صفر
كتالوج تاني منفصل للفني) → تصريح، مع StatusChip لكل حالة وسبب الرفض/الإيقاف لو موجود.

**إشعار (`technician_service.verification_changed` event)**: نفس نمط
`technician.verification_changed` بالحرف — بينبّه بس على القرارات النهائية (اعتماد/رفض/إيقاف).

**اختبار حي**: `technician-service-self-declaration.spec.ts` (9 اختبارات، Postgres حقيقي) —
الدورة كاملة (تصريح→pending→اعتماد→أهلية فعلية في نفس استعلام matching.service.ts الحقيقي)،
تصريح مكرر مرفوض، رفض بسبب + إعادة تصريح، توقيف خدمة معتمدة بيشيلها من الأهلية فورًا، سحب فني
لتصريح فني تاني مرفوض (IDOR)، ونسخة الأسماء المحلولة لواجهة الأدمن. اتأكد كمان حي بـcurl حقيقي
(الفني المزروع TECH-000011: تصريح → `pending_verification`/`is_active=false` في الرد، الرد
اتنضّف بعدين من الداتابيز). **فجوة موثّقة صراحة**: واجهة الأدمن (`/technicians/service-declarations`)
اتبنت واتأكد بناؤها (`tsc`+`eslint`+`next build` نضاف، Route ظهر في الـmanifest) بس مش اتعمل لها
اختبار حي كامل بمتصفح — تسجيل دخول الأدمن في بيئة الـsandbox دي محجوز ببوابة WebAuthn MFA حقيقية
(مفيش حساب أدمن مسجّل فيها من قبل، وتسجيل بصمة WebAuthn جديدة عبر curl مش ممكن فعليًا). التحقق
البديل المتناسب: نفس الـSQL اللي الصفحة هتستخدمه (join الأسماء) اتغطى باختبار جزء من نفس السبك
الحي فوق.

### ترتيب السوق الافتراضي في اختيار الفني — محرك توصية بمرحلتين (Script 6 Part 9، 2026-08-19)

**المشكلة اللي اتصلحت**: `listForServiceBooking()` (بيستخدمها `GET /services/:id/technicians` في
`catalog`) كانت بترتب النتايج `ORDER BY average_rating DESC` مباشرة. ده معناه فني بتقييم 5.0 من
مراجعة واحدة بس كان بيسبق فني بتقييم 4.9 من 200 مراجعة مكتملة — بالظبط المثال المحذّر منه في
الـscript (Part 9): تقييم عالي بعينة صغيرة جداً معندهوش ثقة إحصائية كافية عشان يتصدّر فني بسجل
حقيقي طويل.

**الإصلاح**: متوسط بايزي مرجّح بالثقة (Bayesian confidence-weighted average) — `recommendation_score
= (v×R + m×C) / (v+m)` حيث v=`total_ratings_count`، R=`average_rating`، m=عتبة الحد الأدنى
للعينة (`ranking.bayesian_min_samples`، افتراضي 5)، C=المتوسط الافتراضي المحافظ (`ranking.
bayesian_prior_mean`، افتراضي 4.0) — الاتنين قابلين للتعديل من `SettingsService` من غير كود جديد.
المرحلة 1 (الأهلية الصارمة: `verification_status='approved'` + صف `technician_services` نشط
للخدمة + صف `technician_zones` نشط للمنطقة) فضلت زي ما هي — أي فني ماعندوش الثلاثة دول مش بيظهر
خالص مهما كان تقييمه؛ التغيير بس في ترتيب المرحلة 2. الترتيب النهائي:
`ORDER BY recommendation_score DESC NULLS LAST, distance_km ASC, completed_count DESC`.

**فرز يدوي منفصل (Part 8)**: `GET /services/:id/technicians?sort=lowest_price|highest_rating`
(افتراضي `recommended` بدون باراميتر) — بيتطبّق في `CatalogController` بعد حساب السعر النهائي
الحقيقي لكل فني (نفس `estimate()` اللي `POST /orders` هيستخدمه بالحرف)، مش استعلام SQL تاني.
صريح في `list-technicians-for-service.dto.ts`: الفرز اليدوي مش نفس ترتيب "الأنسب" الافتراضي.

**بَقّة حقيقية اتلقطت أثناء كتابة الاختبار الحي**: أول نسخة من صيغة SQL استخدمت
`$5 * $6` (اتنين parameters من غير أي سياق نوع بيانات ملموس في نفس التعبير) — PostgreSQL بيرفضها
فوراً بـ`operator is not unique: unknown * unknown` لأنه مش قادر يحل نوع العملية بين اتنين
placeholders "unknown" في نفس الوقت، حتى لو نفس الـparameter ($5) بيتحل لاحقاً من استخدام تاني
في نفس الاستعلام (`tp.total_ratings_count + $5`). الفحص اليدوي الأول (استعلام SQL خام بقيم حرفية
5 و4.0 بدل placeholders) فات على البَقّة دي تماماً لأنه معندوش parameters خالص. الإصلاح: casts
صريحة (`$5::int * $6::numeric` و`$5::int` في الـNULLIF) — اتأكد بالاختبار الحي تحت.

**اختبار حي** (`technician-ranking.spec.ts`، Postgres حقيقي): فني اتزرع بتقييم 5.0/مراجعة واحدة،
وفني تاني بتقييم 4.9/200 مراجعة، الاتنين مؤهلين لنفس الخدمة/المنطقة بالظبط. اتأكد إن الفني الأول
(200 مراجعة) بيترتب **قبل** الفني التاني (مراجعة واحدة) في `listForServiceBooking()` — مطابقة
حرفية للمثال المحسوب في التوثيق أعلى الميثود (`4.878` مقابل `4.17`). اتأكد كمان إن `average_rating`/
`total_ratings_count` الخام لسه بترجع زي ما هي في الاستجابة (الترتيب بس اتغير، مش البيانات
المعروضة للعميل).

**فجوة موثّقة صراحة**: مفيش fair-distribution/load-balancing factor لسه (جزء من Part 9's الأوسع —
"avoid over-favoring one provider forever") — الـrecommendation_score حالياً بيعتمد بس على
التقييم البايزي، مش على عدد الطلبات الأخيرة أو التوزيع العادل. مؤجّل عمداً لحد ما يكون فيه بيانات
كفاية لقياسه بمعنى.

**بَقّة حقيقية رابعة اتلقطت واتصلحت (2026-08-19، بلاغ المالك — سيناريو "يوسف")**: "الأهلية
الصارمة" فوق كانت فعليًا أوسع من أهلية `matching.service.ts`'s `findEligibleTechnicians()`
الحقيقية — القايمة هنا مكانتش بتشترط `current_location IS NOT NULL`، بينما التوزيع الفعلي بعد
اختيار العميل للفني بيشترطه صراحة (لازم لحساب `distance_km` والتتبع اللحظي). النتيجة: فني اتسجّل
من الأدمن ومحدّش فتحله تطبيق الفني الحقيقي (معندوش موقع GPS حي اتسجّل قط) كان يظهر في القايمة
ويتختار يدويًا ("اختار الفريق بنفسك")، والطلب بعد كده يتلغى بحجة "مفيش فني متاح" رغم إن العميل
اختار فني بعينه بالظبط. الإصلاح: `tp.current_location IS NOT NULL` بقى شرط في `listForServiceBooking()`
كمان — فني من غير موقع حي مسجّل مش هيظهر للاختيار من الأساس. `technician-ranking.spec.ts` (فنيينها
مزروعين بموقع أصلاً) اتأكد لسه بيعدي بلا تغيير.

## تأهيل الفني بمستوى الفئة/التخصص (trade) — ADR-0018 §8 (طلب صريح من المالك 2026-08-19)

راجع `docs/adr/0018-emergency-vs-scheduled-and-trade-eligibility.md` للتصميم الكامل. تصحيح
جوهري فوق قسم "تصريح مهارات ذاتي" فوق مباشرة — سطر 351-352 هناك ("صف `technician_services`
نشط للخدمة") بقى **جزء واحد بس من قاعدة أوسع**، مش القاعدة الوحيدة، بعد التصحيح ده.

**المشكلة**: `technician_services` (خدمة بخدمة) كانت الطريقة الوحيدة لتأهيل فني. سباك حقيقي محتاج
يتربط بعشرات صفوف منفصلة (سدّ حوض، تسريب مياه، تركيب سخان، تغيير خلاط...) كل واحدة تصريح مستقل
+ اعتماد أدمن مستقل — عملية مرهقة إداريًا وللفني، ومش منطقية: لو الفني اتعمد كسباك، المفروض
يبقى مؤهّل تلقائيًا لكل خدمات السباكة، مش يحتاج يكرر التصريح لكل خدمة فرعية.

**الحل — `technician_categories` (`infra/migrations/0148_technician_categories.sql`)**: جدول
جديد **إضافة جنب `technician_services` مش بديل ليها**. نفس سير عمل تصريح ذاتي → مراجعة أدمن
بالحرف (نفس enum `technician_service_verification_status`، نفس أعمدة `is_active`/
`is_self_declared`/`rejection_reason`/`reviewed_by_user_id`/`reviewed_at`)، بس على مستوى فئة
(`service_categories`) كاملة بدل خدمة واحدة — بلا `skill_level`/`completed_count`/
`average_rating`/`tested_at` (المفاهيم دي معناها بس على خدمة واحدة محددة).

**أهلية الفني بقت "خدمة معتمدة مباشرة OR فئة الخدمة معتمدة"** — الأربعة مواقع المشتركة (نفس
القايمة اللي "تصريح مهارات ذاتي" فوق وثّقها) اتعدّلت كلها بنفس القاعدة بالحرف:
- `matching.service.ts`'s `findEligibleTechnicians()` (التوزيع الفعلي + بث الطوارئ).
- `technician-assignment-guard.service.ts`'s `assertEligible()` (قبول الفني الذاتي + تعيين
  الأدمن القسري).
- `technicians.service.ts`'s `listForServiceBooking()` (قايمة اختيار الفني اليدوي للعميل).
- `assistant-matching.service.ts`'s `broadcastToPool()` (بث المساعدين — أولوية 2 بس، أولوية 1
  "المساعد الشخصي" مالهاش شرط خدمة/فئة أصلاً من زمان، علاقة مختلفة تمامًا).

في الأربعة، `technician_services` بقى `LEFT JOIN` بدل `INNER JOIN`، وشرط إضافي في `WHERE`:
`ts.id IS NOT NULL OR EXISTS (SELECT 1 FROM technician_categories tc WHERE tc.technician_id = ...
AND tc.category_id = <service>.category_id AND tc.is_active = true AND tc.verification_status
= 'approved')`. فني معتمد بالفئة بس (بلا صف `technician_services` مباشر لخدمة معيّنة) بيفضل
مؤهّل ليها؛ فني معتمد بخدمة مباشرة بس (السلوك القديم) لسه بيشتغل زي ما هو بالحرف — إضافة صافية.

**`listForServiceBooking()` تحديد إضافي**: كانت بتعرض `ts.completed_count` (عدد مرات إتمام
الخدمة دي بالذات) في الرد والترتيب — بقت `COALESCE(ts.completed_count, 0)` عشان فني معتمد
بالفئة بس (`ts` بترجع `NULL` ليه من الـ`LEFT JOIN`) ميكسرش الاستعلام أو يرجع `NULL` مضلّل.

**API الفني (`technicians.controller.ts`)**: `GET/POST /technician/categories`،
`DELETE /technician/categories/:id` — نفس شكل `/technician/services` بالحرف (خدمة `service_id`
→ فئة `category_id`)، سرفيس منفصل `TechnicianCategoriesService` (بريبوزيتوري خاص بيه، مش داخل
`TechniciansService`/`AdminTechniciansService` — قرار مقصود عشان الاتنين دول بينشئهم أكتر من
26 ملف اختبار بـ`new` مباشرة في constructor بارامترات ثابتة؛ إضافة بارامتر جديد كانت هتكسرهم
كلهم لمجرد ميزة إضافية. `TechnicianCategoriesService` منفصل تمامًا ومُسجَّل في DI، الاتنين
التانيين فضلوا زي ما هم بلا أي تغيير).

**API الأدمن (`admin-technicians.controller.ts`, صلاحية `technicians.approve` — نفس صلاحية
اعتماد الخدمة)**: `GET /admin/technicians/category-declarations` (طابور، بأسماء محلولة)،
`POST .../category-declarations/:id/approve|reject|suspend` — نفس نمط `service-declarations`
بالحرف. الموافقة بلا body (مفيش `skill_level` على مستوى فئة كاملة يحتاج تعديل وقت الاعتماد).

**إشعار (`technician_category.verification_changed` event)**: نفس نمط
`technician_service.verification_changed` بالحرف — بينبّه بس على القرارات النهائية.

~~**فجوة موثّقة صراحة (نطاق السيشن دي)**: الـbackend كامل ومتاح فعليًا... لكن واجهة الأدمن
وشاشة "مهاراتي" لسه ما اتربطوش بالـcategories الجديدة دي~~ — **اتقفلت (§29، طلب مالك صريح
2026-08-20)**: المالك رفض المنطق خدمة-بخدمة صراحة ("كتير جدًا، وأي خدمة جديدة هضطر أضيفها لكل
فني") وطلب الفئة تبقى المسار الوحيد المتاح من الواجهات من هنا. التفاصيل الكاملة:
`docs/08-pricing-engine-and-platform-vision.md` §29. ملخّص سريع:
- **`apps/technician-app`**: شاشة "مهاراتي" (`features/skills/`) بقت خطوة واحدة (اختار فئة، خلاص)
  بدل فئة→خدمة→طلب، بتنادي `/technician/categories` بدل `/technician/services`.
- **`apps/admin`**: صفحة `/technicians/category-declarations` جديدة (بدّلت `/technicians
  /service-declarations` بالكامل) لمراجعة تصريحات الفني الذاتية. **وكمان تعيين مباشر جديد كليًا**
  لم يكن موجودًا قبل كده حتى بالـAPI: كارت "التخصصات" في `/technicians/[id]` بيسمح للأدمن يعيّن
  فئة لفني مباشرة من غير ما ينتظر تصريح ذاتي أولاً (`POST /admin/technicians/:id/categories`،
  `DELETE .../categories/:categoryId` — endpoints جديدة، `TechnicianCategoriesService
  .adminAssignCategory()`/`adminRemoveCategory()`، idempotent upsert للتعيين وsoft-remove
  للإزالة بيحافظ على السجل التاريخي). نفس الكارت بيعرض طلبات الفني المعلّقة (لو موجودة) بزراير
  اعتماد/رفض مباشرة — الأدمن يقدر يراجع طلب الفني **أو** يعيّن مباشرة من نفس المكان.
- **`technician_services` (الطريقة القديمة خدمة-بخدمة) اتسيّبت في الباك-إند زي ما هي عمدًا** —
  الجدول والـmigrations وشرط الـ`OR` في محرك المطابقة كلهم فاضلين (فنيين اتعمدوا بيها قبل كده
  لسه شغالين بلا انقطاع)، بس **مفيش أي واجهة تفتح مسار خدمة-فردية جديد من هنا** — الفئة هي
  المسار الوحيد. تفاصيل القرار وسببه: §29.2 في docs/08.

**اتأكد بـ`matching-technician-category-eligibility.spec.ts`** (اختبار حي، 3 اختبارات): فني
معتمد بالفئة بس بيبقى مؤهّل لخدمتين مختلفتين جوّه نفس الفئة (بلا أي صف `technician_services`
مباشر خالص)؛ فني معتمد بخدمة مباشرة بس لسه شغال زي ما هو (إضافة مش استبدال)؛ فني بلا أي اعتماد
بيتستبعد تمامًا (ضبط سلبي). لسه محتاج تشغيل حي فعلي بعد ما Postgres يرجع متاح.

## بَقّتين حقيقيتين في `TechnicianAssignmentGuardService.assertEligible()` — طلب مجدول ليوم بعيد كان بيترفض غلط (2026-08-19)

المالك بلّغ سيناريو حقيقي: فني عنده طلب مقبول (ACCEPTED) النهاردة، الأدمن حاول يعيّنه إجباريًا
لطلب تاني مجدول بعد أسبوع (`scheduled_at` بعيد) — النظام رفض بحجة "الفني عنده طلب نشط بالفعل" أو
"الفني غير متاح أو خارج الوردية حاليًا"، رغم إن الطلبين في وقتين مختلفين تمامًا ومفيش أي تعارض
حقيقي. السبب الجذري فحصين في `assertEligible()`:

1. **فحص `isAvailable`/`isOnDuty`** — بيعبّر عن حالة الفني "دلوقتي" (أونلاين وحر هذه اللحظة)، مش
   عن جدول مواعيده المستقبلي. كان بيسري على أي طلب non-emergency بغض النظر عن `scheduledAt` —
   يعني طلب مجدول بعد أسبوع كان بيتطلب الفني يكون أونلاين النهاردة، وهو غير منطقي.
2. **فحص "عنده طلب نشط بالفعل"** — بيستخدم `ACTIVE_TECHNICIAN_ORDER_STATUSES` (نفس الثابت اللي
   `order-tracking.gateway.ts` بيستخدمه لافتراض "فني واحد بياخد طلب نشط واحد بس دلوقتي" — صح لطلبات
   ASAP، غلط لو الطلب الجديد مجدول ليوم تاني خالص) بلا أي فحص لتاريخ/وقت أي من الطلبين.

الإصلاح: الفحصين بقوا يسريان بس على طلبات ASAP (`!order.scheduledAt`) — الطلبات المجدولة بتتفحص
بالجدول الحقيقي (`technician_schedule_slots`، الفحص الأخير في نفس الميثود) اللي أصلاً بيفحص
تاريخ/وقت صحيح ومطابق لمدة الخدمة المقدّرة. **`اختبار حي` جديد**
(`technician-assignment-guard.spec.ts`، 5 اختبارات ضد Postgres حقيقي) بيثبت: (أ) الحالة اللي كانت
بترفض غلط بقت تعدي، (ب) نفس القاعدة لفحص isOnDuty، (ج,د) طلبات ASAP لسه بترفض صح (مفيش تراجع في
السلوك القديم — regression test صريح)، (هـ) استثناء الطوارئ (isOnDuty) لسه شغال زي ما كان.

**تصحيح لاحق (docs/08 §32.2، طلب مالك صريح 2026-08-20)** — بند (ج,د) فوق ("طلبات ASAP لسه بترفض
صح لو الفني عنده أي طلب نشط") بقى **غير صحيح** — نفسه اتضح إنه بَقّة تانية بنفس الفئة بالظبط،
اتلقطت بعد تجربة حقيقية من المالك: فني عنده طلب `accepted` واحد بس (حتى لو قصير جدًا أو مجدول
للأسبوع الجاي) كان بيختفي تمامًا من كل نتائج ASAP، رغم إن `findActiveForTechnician()` بيستبعد
عمدًا أي طلب مجدول لسه معاداش موعده من "الطلب الحالي" — يعني الفني بيبان "فاضي تمامًا" في كل شاشة
حقيقية بينما ASAP بيرفضه بحجة تعارض وهمي. **القاعدة الموحّدة الجديدة**
(`technician-eligibility.sql.ts`، تفاصيل كاملة في docs/08 §32): ASAP بقى حالة خاصة من "مجدول ليوم
= النهاردة" — استبعاد بس لو (الفني منشغل جسديًا فعليًا دلوقتي **واليوم المطلوب هو النهاردة**) أو
(فيه طلب تاني نفس اليوم شاغل يوم كامل). طلب `accepted` قصير لسه ما بدأش **مايستبعدش خالص**، لا
لـASAP ولا لمجدول — نفس القاعدة بالحرف للاتنين. الاختباران (ج,د) اتستبدلوا باختبارين يثبتوا
الإصلاح الجديد + الحماية الحقيقية المحفوظة (منشغل فعليًا لسه بيستبعد).

## `hasEligibleTechnicianForDate()` — فحص وجود خفيف لـ"مرن — اختار نطاق أيام" (docs/08 §32.3)

`TechniciansService.hasEligibleTechnicianForDate(serviceId, zoneId, addressId, date)` — استعلام
`EXISTS(...)` بس، بلا الترتيب البايزي ولا subqueries التزام المواعيد بتاعة `listForServiceBooking()`
(غالية جدًا لو اتكررت لحد 14 مرة). بيستخدم نفس شروط الأهلية الأساسية بالحرف
(`technicianAvailabilityCondition()` الموحّدة) — `OrdersService.create()` بينادّيها يوم بيوم داخل
نطاق العميل المرن (أقصى 14 يوم) لحد ما يلاقي أول يوم فيه فني مؤهّل، أو يرجع بداية النطاق لو محدش.

## تعديل جماعي سريع للإتاحة — `POST /technician/schedule/bulk` (docs/08 §34.3، ADR-0020)

طلب مالك صريح: الفني ميحتاجش يفتح 30 يوم لوحدهم عشان يعدّل شهر — `TechnicianScheduleService.
bulkSetAvailability(technicianProfileId, dates[], action, notesAr?)` جديدة بتاخد مجموعة تواريخ
مرة واحدة (`technician-app` بتوسّع أسبوع/شهر/نطاق لقائمة تواريخ قبل الإرسال، الـbackend مش بيهتم
بمصدر القائمة). لكل تاريخ: تحويل عملي (transaction) بيمسح أي صف موجود ليه الأول (بلا استثناء
سلوت `booked`)، وبعدين لو `action=block` بيتضاف صف `blocked` واحد كامل اليوم (`00:00:00`–
`23:59:59`). `action=unblock` بيمسح الاستثناء بس ويسيب اليوم من غير أي صف — نفس افتراض ADR-0017
("غياب صف = متاح") بالحرف، `unblock` مش معناها إنشاء صف `available` جديد.

**يوم فيه سلوت `booked` فعلي (طلب حقيقي مرتبط بيه) بيتستبعد من العملية الجماعية** — بيرجع
`skipped_booked` واضح في النتيجة بدل ما يتلمس، لأن ده مش استثناء الفني بيتحكم فيه، ده حجز حقيقي.
كل تاريخ في مصفوفة النتيجة بيرجع `applied` أو `skipped_booked` — الـفرونت-إند يقدر يعرض للفني
بالظبط إيه اللي اتغيّر وإيه اللي اتستبعد وليه.

**`apps/technician-app`**: شاشة `ScheduleScreen` (`لib/features/schedule/schedule_screen.dart`)
اتبنت من جديد بالكامل — تقويم شهري (بدون أي مكتبة خارجية، `GridView` بسيط يطابق نظام التصميم
الموجود) بدل نموذج "إضافة سلوت بساعة بداية/نهاية" القديم اللي كان الفعل الأساسي. الفني بيدوس على
أيام متعددة (تحديد فردي، أو "الأسبوع الحالي"/"الشهر المعروض كله" كأزرار سريعة)، وبعدين زرار واحد
"متاح"/"غير متاح" بيطبّق التحديد كله بنداء واحد. أيام `booked` (حجز حقيقي) مش قابلة للتحديد خالص.
مسار "إضافة سلوت بساعة محددة" القديم (`POST/DELETE /technician/schedule` سلوت-سلوت) **لسه موجود
في الـbackend بلا حذف** (توافق كامل مع أي سلوت قديم مخزّن، ومصدر أهلية `technicianAvailability
Condition()` بيفحص أي سلوت بغض النظر عن مصدره) — بس اتشال من الواجهة الأساسية للفني عمدًا (طلب
صريح: "الفني ميحتاجش يحدد ساعات، بس يوم كامل متاح/مش متاح").

**اختبار حي** (`technician-schedule-bulk-availability.spec.ts`، 5 اختبارات ضد Postgres حقيقي):
block على نطاق تواريخ بينشئ صف `blocked` كامل اليوم لكل تاريخ، `unblock` بيمسح الاستثناء ويرجّع
الافتراضي، يوم فيه `booked` بيتستبعد بلا لمس، استدعاء `block` مرتين على نفس اليوم idempotent (بلا
خطأ قيد الـexclusion الحقيقي من migration 0118)، و`block` بيستبدل سلوتات `available` جزئية قديمة
موجودة بصف واحد كامل اليوم.

## تصنيف القدرة الاستيعابية 4 مستويات + طلبات شغل إضافي اختيارية (docs/08 §34.1، ADR-0020)

راجع `docs/adr/0020-technician-workload-tiers-and-fair-allocation.md` للتصميم الكامل. المنطق
الفعلي موزّع كالتالي:

- **`classifyTechnicianCapacity()`** (`technician-eligibility.sql.ts`) — دالة جديدة **فوق**
  `technicianAvailabilityCondition()` الموجودة (بلا تكرار منطق، بتلف حوالين نفس شروط `blocked`/
  تعارض `orders`)، بترجّع تصنيف بدل بوليان: `BLOCKED` (استثناء صريح، أولوية فوق أي حاجة) →
  `HEAVY` (انشغال جسدي فعلي دلوقتي أو شاغل يوم كامل) → `MEANINGFUL` (عنده شغل قصير نفس اليوم بس
  مش شاغله بالكامل) → `LIGHT` (لا تعارض خالص). اختبار حي مستقل (`technician-capacity-classification
  .spec.ts`، 6 اختبارات) يغطي الأربعة بالإضافة لتأكيد عدم وجود تعارض كاذب مع يوم بعيد.
- **`technician_work_opportunities`** (migration `0153`، بلا TypeORM entity — نفس نمط
  `technician_categories`، SQL خام مباشر عبر `TechnicianWorkOpportunitiesService` جديدة) — جدول
  الفرص الاختيارية. **مختلف جوهريًا عن `order_assignments`** (بث الطوارئ): مفيش `expires_at`،
  الفرصة تفضل صالحة لحد ما تتقبل/تترفض/الطلب يتغطى من فني تاني (`closeRemainingForOrder()`).
- **`TechnicianAssignmentGuardService.assertEligibleForWorkOpportunity()`** جديدة — نفس فحوصات
  `assertEligible()` الأساسية (اتستخرجت لـ`assertCoreEligibility()` خاصة مشتركة بين الاتنين) لكن
  بدل بوابة `technicianAvailabilityCondition()` النهائية (اللي بتستبعد `HEAVY` أصلاً — مش مناسبة
  هنا، الفني بيقبل **رغم** إنه `MEANINGFUL`/`HEAVY` عمدًا) فحص `classifyTechnicianCapacity() !==
  'BLOCKED'` بس.
- منطق القرار الفعلي (مين ياخد تأكيد تلقائي مقابل فرصة اختيارية) في `MatchingService
  .autoConfirmScheduledOrder()` — تفاصيل كاملة في `../matching/README.md` (قسم مطابق).
- **إعدادات جديدة** (`settings`, migration `0153`): `matching.offer_heavy_workload_technicians`
  (افتراضي `true`)، `matching.fairness_lookback_days`/`matching.fairness_weight`/`matching.tie_
  break_threshold` (افتراضي `0` = معطّل — محجوزة لـ§34.2، نموذج العدالة، لسه مش منفَّذ).
- **`POST /technician/orders/work-opportunities/:id/accept`** / **`.../decline`** / **`GET
  /technician/orders/work-opportunities`** — endpoints جديدة في `TechnicianOrdersController`
  (موديول `matching`)، منفصلة تمامًا عن `/available` (بث الطوارئ).

**§34.2 (نموذج العدالة بالتاريخ الحديث)** — ✅ خلص، تفاصيل كاملة في `../matching/README.md`.

## شفافية الأدمن + فصل واجهة الفني (docs/08 §34.4، ADR-0020 §W/§X) — ✅ خلص

- **`describeTechnicianCapacity()`** (`technician-eligibility.sql.ts`) — نسخة تشخيصية فوق
  `classifyTechnicianCapacity()`، بترجع سبب مقروء بالعربي + نطاق أيام مشغول (لو السبب مشروع
  متعدد الأيام) بدل تصنيف خام. **`GET /admin/technicians/:id/capacity?date=YYYY-MM-DD`** جديدة
  (`AdminTechniciansController`) بتستخدمها — "الفني ده متاح إمتى ولية؟" سؤال تشخيصي عام، مش قرار
  مطابقة حقيقي لطلب بعينه.
- **`TechnicianWorkOpportunitiesService.listForOrderAdmin()`** جديدة — تاريخ كل الفرص لطلب معيّن
  (مين اتعرضله، بأي تصنيف، وقرر إيه) مع اسم الفني، مش بس معرّفه. **`GET /admin/orders/:id/work-
  opportunities`** جديدة (`AdminOrdersController`) — منفصلة عن `:id/eligible-technicians`
  الموجودة (دي بتسأل "مين مؤهّل دلوقتي"، الجديدة بتسأل "مين اتعرض عليه فعليًا وحصل إيه").
- **بَقّة حقيقية اتلقطت واتصلحت وقت كتابة `describeTechnicianCapacity()`**: `node-postgres`
  بيرجّع أعمدة `date`/`timestamptz` كـ`Date` object جافاسكريبت (مش نص) افتراضيًا — كود أول نسخة
  كان بينادي `.slice(0, 10)` على القيمة دي مباشرة (بافتراض إنها نص) — كان هيرمي `TypeError`
  حقيقي أول ما سبب `HEAVY`/`BLOCKED` فيه `scheduled_at`/`slot_date` غير NULL فعليًا (كل اختبارات
  الوحدة الأولى صادف إنها مرّت لأن القيمة كانت NULL دايمًا في السيناريوهات المُختبرة، فالفرع
  البديل [`params.date`] كان بيتنفّذ بدل الفرع المكسور). الإصلاح: `TO_CHAR(..., 'YYYY-MM-DD')`
  في الـSQL نفسه بدل الاعتماد على تحويل نوع الـdriver الضمني — درس عام لأي كود جديد بيلمس أعمدة
  تاريخ/وقت خام عبر `dataSource.query()` في المشروع ده.
- **`apps/technician-app`**: `AvailableOrdersScreen` بقى فيه قسم "فرص شغل إضافي" منفصل تمامًا
  بصريًا وسلوكيًا عن قسم طلبات الطوارئ — بطاقة `_WorkOpportunityCard` جديدة، لون مختلف (أزرق
  معلوماتي مش أحمر استعجال)، نص بيوضّح "ليه" وصلت الفرصة (عندك شغل تاني نفس اليوم)، بلا أي عدّاد
  وقت (الفرصة ما بتنتهيش بمهلة). قبول متأخر على فرصة اتقفلت من فني تاني بيرجّع خطأ واضح، والقايمة
  بتتحدّث فورًا تختفي الفرصة اللي بقت مش صالحة.
- **اختبار حي**: 3 اختبارات جديدة (`describeTechnicianCapacity` — LIGHT/HEAVY متعدد الأيام/
  BLOCKED) اتضافوا لـ`technician-capacity-classification.spec.ts`، واختبار جديد لـ
  `listForOrderAdmin()` في `../matching/matching-work-opportunity.spec.ts`.

## تتبع أونلاين/آخر نشاط (docs/08 §35.10، ADR-0021 §6)

`TechnicianActivityService.getActivityForUser()`/`getActivitySnapshot()` (batch) — **صفر تخزين
حالة جديد**، الاتنين محسوبين من مصادر حقيقة موجودة بالفعل: `online` من `RealtimeSessionRegistry`
(in-memory، Map موجودة أصلاً في `common/websocket/`، صفر تعديل على أي gateway)، `last_active_at`
من `MAX(refresh_tokens.last_seen_at)` (بيتحدّث تلقائيًا كل تجديد access token، بلا أي كود جديد في
`apps/technician-app`). **قرار متعمّد**: نظام `last_activity_at`/`employee_daily_activity` الموجود
(`WorkforceActivityService`، ADR-0016) اتقصد عدم إعادة استخدامه هنا — مقصور على `user_type='admin'`
عبر heartbeat صريح من `apps/admin`، توسيعه للفنيين كان محتاج آلية heartbeat جديدة في Flutter (تكلفة
غير مبررة لميزة observability). **تحذير موثّق في الكود**: `RealtimeSessionRegistry` in-memory محلية
لكل process — نشر بأكتر من instance هيخلي فني متصل بـinstance تاني يظهر "أوفلاين" هنا.

`online`/`last_active_at` جداد في `AdminTechnicianDetailResponseDto` (`GET /admin/technicians/:id`
بس — مش الـ8 endpoints التانية اللي بترجّع الرد المختصر بعد أفعال إدارية)، منفصلين تمامًا عن
`is_available`/`is_on_duty` القديمين (اتشالوا من الأهلية بالكامل من ADR-0017 — مفيش خلط بينهم).

## مركز عمليات فئة (docs/08 §35.9، ADR-0021 §5)

`AdminTechnicianCategoryOpsService.list()` — `GET /admin/technicians/by-category?category_id=...`
(مسجّل قبل `GET :id` عمدًا، وإلا NestJS يفسّر `by-category` كـUUID). مُصفّح (`LIMIT`/`OFFSET` +
`COUNT(*) OVER()`)، عضوية الفئة بتشمل `pending` كمان مش بس `approved`. حالات غنية لكل صف —
`online`/`last_active_at` (§35.10)، `working_now` (طلب نشط دلوقتي)، `capacity_tier_today`
(`classifyTechnicianCapacity()`، محدود بحجم الصفحة بس)، `open_requests_count`
(`order_assignments`+`technician_work_opportunities`)، `crew_leader_shortage_count`/
`crew_recruit_open_offers_count` (تورط نقص الطاقم)، `has_zone_issue`/`has_category_issue` (تنبيه
تشغيلي: صفر نطاقات/فئات مفعّلة). **قيد متعمّد**: مفيش فلتر `online_only` على مستوى الترقيم —
`online` in-memory محلية، فلترتها قبل `LIMIT`/`OFFSET` هتحتاج جلب المجمّع كله (بالظبط النمط اللي
المالك حذّر منه "avoid expensive synchronous diagnostics at scale").

**فلتر `zone_id` اختياري (docs/08 §36.3، مصفوفة القوى العاملة في مركز العمليات)**: `EXISTS` واحد
إضافي على `technician_zones` (نفس الجدول اللي `zone_count` أصلًا بيتحسب منه) — تعديل جراحي واحد،
صفر تكرار منطق. الأدمن بيتصفّح مدينة→نطاق→فئة→فني (`apps/admin/src/app/operations/page.tsx`)، بس
الـendpoint ده نفسه لسه شغال بلا `zone_id` تمامًا زي ما كان (فلتر اختياري بحت، مايأثرش على
`apps/admin/src/app/technicians/category-declarations` أو أي استهلاك تاني موجود).

## بروفايل فني 360° (docs/08 §35.11، ADR-0021 §5)

`AdminTechnician360Service.getProfile()` — `GET /admin/technicians/:id/360` — تجميعة واحدة: هوية،
فئات/نطاقات، مستوى/اعتماد، `online`/`last_active_at` (§35.10)، طلبات حالية/قادمة (bounded 10)،
أيام محظورة (bounded 20)، قدرة استيعابية النهارده (`describeTechnicianCapacity()`، §34.4)، دور
فريق (شركة/مالك ولا لا)، فرص مفتوحة، سلوك إلغاء، تقييم، شكاوى (bounded 10 + عدّاد كلي)، صرف
(`wallets`+`payouts`، bounded 5). **قراءة بس** — أي فعل إداري بيتعمل عبر endpoints الموجودة فعلاً،
صفر منطق mutation مكرر هنا.

## §36.13 — واجهة بروفايل فني 360° (فوق `GET /admin/technicians/:id/360` الموجود، صفر endpoint جديد)

`GET /admin/technicians/:id/360` (السطر فوق) كان موجود ومختبر حي من §35.11 بلا أي واجهة تعرضه —
فجوة UI موثّقة صراحة في docs/08 §36.13. الإصلاح: قسم "نظرة تشغيلية 360°" جديد في
`apps/admin/src/app/technicians/[id]/page.tsx` (صفحة تفاصيل الفني الموجودة أصلاً، غنية بالفعل
بمستندات/شهادات/مناطق/تخصصات/محفظة/إنتاجية) — **بيعرض بس الحقول اللي مش مكرَّرة من كروت الصفحة
الموجودة** عشان مفيش ازدواجية بصرية: أونلاين/آخر نشاط، القدرة الاستيعابية النهارده (نفس badge/تسمية
`CAPACITY_TIER_LABELS`/`capacityTierBadgeClass` المستخدمة في مركز العمليات §36.3-36.12، صفر لغة
بصرية جديدة)، دور الفريق، الشغل الحالي/الجاي (لينك لصفحة الطلب)، الأيام المحجوبة، الفرص المفتوحة،
سلوك الإلغاء، والشكاوى. صفر endpoint جديد، صفر تعديل باك-إند — نفس نمط `ProductivityReport` الموجود
فعلاً في نفس الملف (تعريف نوع محلي مطابق لشكل الـcontroller بالحرف، مش في `@baytak/shared-types`
عمدًا — endpoint أدمن-بس ضيّق).

**تحقّق**: `tsc --noEmit`/`next build` في `apps/admin` نضاف صفر أخطاء (صفر تعديل في `apps/api`،
فمفيش داعي لإعادة تشغيل جناح jest). تحقق حي بـcurl ضد `apps/api` حقيقي شغال: شكل الاستجابة الكامل
مطابق تمامًا للنوع المحلي الجديد (`tier: LIGHT`, `online: false`, قوائم فاضية لفني بيانات تطوير
حقيقي). **فجوة موثّقة صراحة**: مفيش لقطة شاشة/تحقق حي كامل بمتصفح للقسم الجديد بالذات — الثقة مبنية
على `tsc`/`next build` نضاف + تطابق شكل استجابة الـcurl الحقيقي مع النوع المحلي حرفيًا (نفس درجة
الثقة الموثَّقة في §36.11).

## بَقّة حقيقية: إزالة منطقة الفني كانت soft-delete بس، من غير إلغاء تفعيل فعلي (docs/08 §36.1)

اتلقطت أثناء تحقيق حي لبَقّة "فني بيوقف يستقبل فرص بعد أول شغلانة" (اتضح إنها مش قابلة لإعادة
الإنتاج — راجع docs/08 §36.1 للتفاصيل الكاملة). `AdminTechniciansService.removeZone()` كان بينادي
`technicianZones.softDelete()` بس (`deleted_at`)، لكن استعلامات المطابقة الخام في ~5 أماكن
(`matching.service.ts`، `technicians.service.ts`، `matching-explainability.service.ts`،
`technician-assignment-guard.service.ts`) بتفلتر بـ`tz.is_active = true` **بس**، من غير فحص
`deleted_at` — يعني منطقة "متشالة" فعليًا من الأدمن كانت لسه بتطابق في المطابقة الحقيقية. الإصلاح:
`removeZone()` دلوقتي بيقلب `is_active=false` كمان قبل الـsoft-delete (نقطة كتابة واحدة، بدل تعديل
كل استعلامات القراءة المكرّرة). اختبار حي: `admin-technician-zone-removal.spec.ts` (2/2) —
`is_active`+`deleted_at` الاتنين صح، ونفس شرط الـJOIN الخام بيرجّع صفر صفوف بعد الإصلاح.

## توحيد فلو "اعتماد" مع "فردي" + `eligible_for_team_booking` — طلب مالك صريح 2026-08-21 (docs/08 §38)

المالك طلب إن فلو حجز "اعتماد" (`booking_mode=team`) يبقى **مطابق تمامًا** لفلو "فردي" (اختيار
تلقائي أو تصفّح/مقارنة فنيين حقيقيين، اللي وصفه المالك إنه ممتاز) — الفرق الوحيد المطلوب: فنيين
تحت مستوى محترف ما بيظهروش/يترشّحوش في اعتماد خالص، والشركات تظهر في اعتماد "كده كده" (كارت
موحّد مع الفنيين، مش قايمة منفصلة). التحقيق كشف إن `booking_mode` مكانش بيأثر على الأهلية خالص —
لا في قايمة التصفّح ولا في التوزيع التلقائي — زيرو فلترة مستوى لقيادة فريق موجودة، فطلب اعتماد
كان ممكن يتوزّع تلقائيًا على فني مستواه `new` كقائد مهمة.

- **`technician_level_config.eligible_for_team_booking`** (migration `0158`) — عمود جديد **منفصل
  عمداً** عن `can_lead_team` الموجود من زمان (اللي بيحكم قدرة الفني على إنشاء/امتلاك شركة —
  مفهوم إداري أثقل، افتراضيًا `false` لـ`professional`). طلب المالك هنا مختلف: مين يقدر يبقى
  قائد **مهمة واحدة** (طلب اعتماد)، والمالك ذكر `professional` صراحة كمستوى مؤهّل — استخدام
  `can_lead_team` نفسه كان هيتعارض مع كلامه بالحرف. القيم الافتراضية: `new`/`verified`=`false`،
  `professional`/`premium`/`team_leader`=`true`. قابل للتعديل الكامل من `/admin/technician-levels`
  (نفس نمط `can_lead_team`، حقل checkbox جديد "يظهر ويترشّح كقائد مهمة في حجوزات اعتماد").
- **إنفاذ متسق في 4 نقاط** (نفس فلسفة `decision_limit_cents` الموثّقة في `matching.service.ts` —
  "فلترة الاستعلام مصدر حقيقة واحد، بدل ما التوزيع يكتشف فني غير مؤهّل وبعدين يفشل بصمت وقت
  التأكيد"):
  1. `TechniciansService.listForServiceBooking()` — قايمة تصفّح العميل (`GET
     /services/:id/technicians?booking_mode=team`)، بترفض أي فني تحت محترف.
  2. `MatchingService.findEligibleTechnicians()` — التوزيع التلقائي الفعلي، نفس الشرط على
     `order.bookingMode` (كان زيرو فلترة قبل الإصلاح — أخطر نقطة، لأنها بتحصل بلا أي اختيار
     يدوي من العميل).
  3. `TechnicianAssignmentGuardService.assertCoreEligibility()` — البوابة النهائية (قبول ذاتي +
     تعيين قسري + تأكيد اختيار عميل صريح) تمنع أي تحايل عن طريق نداء API مباشر متجاوز لقايمة
     التصفّح.
  4. `AdminOrdersService.listEligibleTechniciansForReassign()` — قايمة إعادة التعيين اليدوي
     للأدمن على طلب موجود، بترث نفس الفلترة من `order.bookingMode` الحقيقي (كانت بتستخدم
     `listForServiceBooking()` من غيرها خالص قبل الإصلاح — نفس الفجوة).
  `individual`/`emergency` **بلا أي تغيير** في الأربعة — نفس القايمة/نفس التوزيع بالحرف زي
  النهارده، مطابق لكلام المالك "الفرق بالظبط إن في اعتماد الناس اللي تحت محترف ما بتظهرش".
- **الشركات تندمج في نفس قايمة `listForServiceBooking()`** (مش endpoint/radio group منفصل زي
  قبل كده) — بس لما `booking_mode=team`. شركة نشطة عندها فني واحد مؤهّل على الأقل لنفس
  الخدمة/المنطقة/التوفر (نفس شروط أهلية الفرد الأساسية، **بلا فلتر مستوى** — الشركة موثوقة كوحدة،
  مالكها لازم كان `can_lead_team=true` وقت الإنشاء أصلاً) بترجع كصف واحد (`is_company:true`،
  `staff_count`/`branch_count`، `final_price_cents:null` صراحة — مفيش فني محدد بعد يتحسب عليه
  سعر، نفس مبدأ `estimate:null` الموجود بالفعل لخدمات formula من غير field_values). `GET
  /technician-companies` (المستخدم القديم) فضل موجود بلا تغيير — endpoint عام مستقل، مش استبدال.
  **نطاق موثّق صراحة**: الكارت المدمج ده اعتماد بس — فردي/طوارئ بلا تغيير (فردي = فني واحد بيتولى
  الشغلانة بنفسه، مالوش معنى واضح لاختيار شركة بلا آلية تخصيص لفني واحد بعينها منها؛ طوارئ أصلاً
  بلا اختيار يدوي بالتصميم).

**اتأكد حي بالكامل**: `technician-team-booking-marketplace.spec.ts` (2 اختبار، `listForServiceBooking`)
— فني `new` يتحجب واعضاء شركة (مستواهم `new`) ما بيظهروش كصفوف فردية في اعتماد، لكن شركتهم تظهر
كارت منفصل بصح `staff_count`/`branch_count`. `matching-team-booking-level-gate.spec.ts` (2 اختبار،
`findEligibleTechnicians`) — نفس الفلترة على التوزيع التلقائي. `technician-assignment-guard.spec.ts`
اتوسّع بـ3 اختبار للبوابة النهائية (رفض `new`، قبول بعد ترقية `professional`، رجريشن `individual`).
**تحقق HTTP حقيقي كامل** ضد Postgres/Redis حقيقيين شغالين فعلاً (مش mocks): خدمة/نطاق/عنوان
حقيقيين + 3 فنيين (new مستقل، professional مستقل، new عضو شركة) + شركة نشطة — `GET
/services/:id/technicians` بلا `booking_mode` رجّع التلاتة كأفراد؛ بـ`booking_mode=team` رجّع
`professional` بس (سعره النهائي 20000 قرش محسوب صح) + كارت الشركة (`staff_count:1`,
`branch_count:0`, `final_price_cents:null`) — صفر أفراد تحت محترف. كل بيانات الاختبار اتنضّفت
بعد التحقق.

## الفريق المفضّل — `PreferredCrewService` (docs/08 §36.16-19، ADR-0022)

شبكة تفضيل نظير-لنظير دائمة — نموذج **تالت** منفصل تمامًا عن `order_team_members` (طاقم مؤقت لطلب
واحد)، `technician_companies` (توظيف رسمي)، و`assistant_technician_id`/`assistant_link_status`
(علاقة غير متماثلة واحد-لواحد محتاجة موافقة أدمن). التفاصيل المعمارية الكاملة والبدائل المرفوضة في
`docs/adr/0022-preferred-crew-peer-network.md`.

- **الجدول**: `technician_preferred_crew_members` (migration `0159`) — اتجاه واحد بس
  (`owner_technician_id` → `member_technician_id`)، `status` enum (`invited`/`accepted`/
  `declined`/`removed`)، فهرس فريد جزئي (`WHERE status IN ('invited','accepted')`) بيسمح بدعوة
  جديدة لنفس الزوج بعد ما القديمة تتشال/تترفض.
- **صفر موافقة أدمن**: قرار مبرَّر في ADR-0022 — العلاقة تفضيل شخصي بحت، مش توظيف، فمفيش مسؤولية
  قانونية/أجر مرتبط زي علاقة المساعد. `invite()`/`accept()`/`decline()`/`remove()`/`leave()` كلها
  بين الفنيين مباشرة، نفس نمط `TechniciansService.requestAssistant()` (بحث بـ`technician_code`).
- **حد أقصى قابل للتعديل**: `settings.matching.preferred_crew_max_size` (افتراضي 10) — بيتفحص على
  عدد `accepted` بس وقت `invite()` جديدة (المعلّقة `invited` مش محسوبة في الحد).
- **الأولوية في التجنيد (§36.17)**: `OrderTeamService.listRecruitCandidates()` بقى فيه
  `isPreferredCrewMember` (`EXISTS` subquery واحد، نفس أسلوب `isLeaderTeamMember`) — الترتيب
  `isLeaderTeamMember DESC, isPreferredCrewMember DESC, distanceKm ASC, ...`. صفر تأثير على
  الاستبعاد — فني غير مؤهّل لسه بيتستبعد حتى لو في الفريق المفضّل.
- **Endpoints** (`technician/preferred-crew*`، `TechniciansController`): `GET`/`POST` للقايمة/
  الدعوة، `GET .../invitations`، `GET .../memberships` (§36.18 — راجع البَقّة تحت)،
  `POST .../invitations/:id/accept|decline`، `DELETE :id` (إزالة من الـowner)، `POST :id/leave`
  (مغادرة من العضو).
- **بَقّة حقيقية اتلقطت وقت بناء UI التطبيق (§36.18)**: `leave()` كانت موجودة من §36.16 بلا أي
  مسار يوصّل الفني العضو لعضويته أصلاً — `listInvitationsReceived()` بترجّع `status='invited'` بس
  (بتختفي بمجرد القبول)، و`listMine()` من منظور الـowner بس. يعني الفني المدعو اللي قبل دعوة ماكانش
  عنده أي endpoint يشوف بيه "أنا عضو في فريق مين" عشان يقدر يسيبه. الإصلاح: `listMyMemberships()`
  جديدة + `GET /technician/preferred-crew/memberships`.
- **إشعارات (§36.19)**: `PreferredCrewService` بيصدّر `PREFERRED_CREW_INVITED_EVENT`/
  `PREFERRED_CREW_ACCEPTED_EVENT` (حدث بس، صفر معرفة بالإشعارات) — المستمع الفعلي
  (`PreferredCrewNotificationListener`) في `notifications` module، **مش هنا**: `NotificationsModule`
  بيستورد `TechniciansModule` بالفعل، فحقن `NotificationsService` مباشرة هنا كان هيعمل استيراد دائري
  (نفس الحل المتّبع أصلاً لـ`WorkOpportunityOfferedNotificationListener`).
- **رؤية أدمن (§36.19)**: `AdminTechnician360Service.getProfile()` بيرجّع `preferredCrewAsOwner`/
  `preferredCrewAsMember` — قراءة بس، العلاقة لسه بتُدار بالكامل من الفني نفسه (صفر endpoint تعديل
  أدمن جديد، حسب تصميم ADR-0022).
- **اختبار حي** (`preferred-crew.spec.ts`، 16/16): دورة حياة كاملة (دعوة→قبول→مغادرة→دعوة جديدة)،
  رفض دعوة النفس/كود مش موجود/تعارض دعوة حية، حد أقصى قابل للتعديل، `listMyMemberships()` الجديدة،
  وتصدير الحدثين الصحيح بالـpayload الصح. اختبار تكامل في `order-team-recruiting.spec.ts` بيثبت
  الترتيب الحقيقي مع `OrderTeamService`.

## فئة تسعير الفني — `technician_profiles.pricing_tier` (docs/08 §36.24، ADR-0025)

طلب مالك صريح: فئة تسعير تجارية (`standard`/`expert`/`senior`/`premium`) **منفصلة تمامًا** عن
`TechnicianLevel` التشغيلي فوق (نفس العمود المستخدم لحد القرار المالي/أولوية المطابقة/أهلية
"اعتماد"/تقدّم KPI). التفاصيل الكاملة (العمود، الجدول الجديد، منطق تسعير الفئة) في
`../catalog/README.md`'s "فئة تسعير الفني" — هنا بس جانب الإدارة/الأهلية.

- **`PATCH /admin/technicians/:id/pricing-tier`** (`admin-technicians.service.ts`'s `changePricingTier()`)
  — نفس نمط `changeLevel()`/`PATCH .../level` بالحرف، لكن **صفر جدول تاريخ مخصّص** (عكس
  `technician_level_history`) — قرار تجاري بسيط، مفيش تدرّج ترقية/تنزيل يستاهل تتبّع. بيرفض 409 لو
  الفني أصلاً على نفس الفئة، وبيسجّل في `audit_logs` زي أي تغيير أدمن تاني.
  `TechnicianBookingListItem` (اختيار الفني قبل الحجز) بقى فيه `pricingTier` جنب `currentLevel`
  الموجود — بيتحسب من `technician_profiles.pricing_tier` مباشرة (نفس صف `current_level`).
- **اختبار حي** (`technician-pricing-tier-assignment.spec.ts`، 3/3): `changePricingTier()` بيغيّر
  `pricing_tier` بس وcurrent_level يفضل زي ما هو، `changeLevel()` بيغيّر current_level بس وpricing_tier
  يفضل زي ما هو (استقلال في الاتجاهين)، 409 لو نفس الفئة الحالية.

## بَقّة ثقة (مش بَقّة كود) — `is_available`/`is_on_duty` شكلهم بيوحي إنهم بيمنعوا الفني من الشغل، مش صحيح (بلاغ المالك 2026-08-21)

المالك شاف صفحة بروفايل فني في الأدمن فيها "متاح دلوقتي: لأ · في الخدمة: لأ" وافترض إن ده بيمنع
الفني من استقبال طلبات جديدة، وإنه معندوش طريقة يغيّر ده من الأدمن. **الاتنين افتراض غلط** بس
مفهوم — الواجهة نفسها بتوحي بكده:

- `is_available`/`is_on_duty` **اتشالوا من الأهلية بالكامل من ADR-0017** (`findEligibleTechnicians()`
  في `matching.service.ts`، الشرط `AND ($8::boolean IS NULL OR $8::boolean IS NOT NULL)` — tautology
  متعمّد، مش شرط حقيقي). الفني متاح افتراضيًا (نموذج Opt-out) — الحقلين دول مؤشر ذاتي بيضبطه الفني
  بنفسه (`PATCH /technician/availability`) وبيتحسب في تقرير أدمن واحد بس (`admin-reports.service.ts:145`)،
  **مش شرط توزيع خالص**. فعلاً محدّش قدر يغيّرهم من الأدمن — لأنهم مش المفروض يتغيّروا من هناك، مش
  فجوة.
- الشرط الحقيقي الوحيد اللي ممكن يمنع فني معتمد + معينله منطقة + معتمد لفئة/خدمة من استقبال طلبات
  هو `tp.current_location IS NOT NULL` (فرض صريح في `findEligibleTechnicians()`) — يعني الفني لازم
  يكون فتح تطبيق الفني وسمح بالموقع (GPS) مرة واحدة على الأقل، عشان التوزيع بالمسافة يقدر يحسب له.
  الحقل ده **ماكانش ظاهر للأدمن خالص** — مفيش أي مؤشر على صفحة البروفايل يقول "الفني معندوش موقع
  محفوظ"، فالأدمن كان شايف بس الحقلين القديمين المضلّلين.
- **الإصلاح**: حقل جديد `has_current_location` في `AdminTechnicianResponseDto` (`profile.currentLocation
  !== null`، قراءة بس صفر استعلام إضافي — العمود أصلاً محمّل مع الصف). `apps/admin`'s صفحة تفاصيل
  الفني بقت بتوضّح إن `is_available`/`is_on_duty` "مؤشرات ذاتية قديمة (مش بتمنع استقبال الطلبات)"
  وتعرض الشرط الحقيقي (وجود GPS) بشكل صريح، بلون تحذيري لو مفيش موقع محفوظ.

## بَقّة حقيقية اتلقطت (بلاغ المالك، 2026-08-21) — "أونلاين دلوقتي" كان دايمًا `false` لكل الفنيين

نفس اليوم، بلاغ تاني: صفحة "مركز العمليات" (`/operations`) بتعرض "حالة الاتصال" لكل الفنيين وكانت
دايمًا "أوفلاين" — محدّش ظاهر أونلاين خالص، حتى فنيين مسجّلين دخول فعليًا دلوقتي.

**السبب الحقيقي — مش بَقّة في `RealtimeSessionRegistry` نفسه** (تسجيل/قراءة `user_id` سليمين
100%، مثبت بـ`order-tracking-gateway-presence.spec.ts` الجديد تحت). المشكلة إن
`apps/technician-app` ماكانش بيفتح أي اتصال Socket.IO خالص لحد ما الفني يفتح شاشة تنفيذ طلب نشط
(`order_execution_screen.dart`'s `TechnicianTrackingClient`، وبس وقت `order_status` فعّال). فني
قاعد على الشاشة الرئيسية بلا طلب نشط معندوش أي socket مفتوح أصلاً — فـ`isUserOnline()` بترجع
`false` بحق، مش بسبب أي خطأ في القراءة.

**الإصلاح** (`apps/technician-app/lib/main.dart`'s `_AuthGate`): اتصال "حضور" مستقل — نفس
`TechnicianTrackingClient`/namespace `/tracking` الموجود، **بلا `order_id` وبلا `tracking:join`
خالص** (`OrderTrackingGateway.handleConnection()` بيسجّل الفني في `RealtimeSessionRegistry` وقت
الاتصال نفسه، قبل أي انضمام لغرفة — مفيش حاجة تتطلّب order_id أصلاً). بيتفتح بمجرد ما الفني
يسجّل دخول (`AuthRepository.isAuthenticated`)، وبيتقفل عند تسجيل الخروج أو لما التطبيق يروح
الخلفية (`AppLifecycleState.paused`/`detached`، عبر `WidgetsBindingObserver`) ويترجع يفتح تاني
عند الرجوع (`resumed`). **آمن تمامًا مع اتصال تتبع الطلب الموجود** — `RealtimeSessionRegistry`
بيستخدم `Set<Socket>` لكل `user_id` مش قيمة واحدة، فالاتنين بيشتغلوا مع بعض من غير تعارض (لو فني
عنده طلب نشط، عنده socket حضور + socket تتبع في نفس الوقت، وبيفضل أونلاين لحد ما الاتنين يتقطعوا).

- **اختبار حي جديد** (`order-tracking-gateway-presence.spec.ts`، 4/4، `RealtimeSessionRegistry`
  حقيقي مش mock): اتصال بلا `order_id`/`tracking:join` خالص بيسجّل الفني أونلاين فعليًا، قطع
  الاتصال بيرجّعه أوفلاين، اتصالين متزامنين (حضور + تتبع) بيفضلوا أونلاين لحد ما الاتنين يتقطعوا.
- `flutter analyze` نضاف (صفر تحذيرات جديدة من التعديل).

## سياسة إظهار المرشّحين المتعارضين جدوليًا — Slice B (ADR-0030، docs/08 §42)

`listForServiceBooking()` (اختيار الفني قبل الحجز، صُنّاع) بقت بترجّع دلو تاني اختياري "مؤهّل بس
متعارض" جنب الدلو "متاح" الأصلي، لما `Service.showUnavailableProviders=true` و`scheduledAt`
موجودة. القرار الكامل + التدقيق الحي الكامل لكل آلية الأهلية الموجودة في
`docs/adr/0030-schedule-conflict-visibility-policy.md`.

- **`technician-eligibility.sql.ts` refactor (حرج، اتحقق منه بعناية)** — منطق التعارض نفسه
  (`activeOrderConflictExistsExpr()`) اتفصل لدالة داخلية مشتركة، و`technicianAvailabilityCondition()`
  (بتنفيه) و`technicianScheduleConflictCondition()` الجديدة (بتستخدمه زي ما هو) بيتركّبوا منها —
  صفر نسخة منفصلة لنفس المنطق، صفر خطر انحراف مستقبلي. **بَقّة حقيقية اتلقطت واتصلحت أثناء
  الـrefactor نفسه** (قبل أي commit): أول نسخة كانت بتخطّي استثناء `blocked` الصريح بالكامل لما
  `ignoreActiveOrderConflict=true` (ADR-0017 بند 10) — الشرط ده المفروض يفضل ساري دايمًا، مش بس
  الشرط العادي. اتلقطت حيًا (`matching-work-opportunity.spec.ts` فشل بخطأ "could not determine
  data type" — دليل غير مباشر إن الشرط اختفى تمامًا مش مجرد تفاصيل نوع). اتحقق من صفر رجريشن على
  `matching`/`technicians` بالكامل (152/155، نفس الـ3 فشلات المعروفة القديمة بلا علاقة) قبل وبعد.
- **`describeTechnicianCapacity()`/`classifyTechnicianCapacity()` (docs/08 §34.4، ADR-0020 §W)
  بقت مُعاد استخدامها هنا** — كانت تشخيصية للأدمن بس، دلوقتي كمان مصدر "السبب" (`unavailable_reason_ar`)
  للعميل. `findNextAvailableDateForTechnician()` جديدة (تلف حوالين `hasEligibleTechnicianForDate()`
  الموسّعة بفلتر `technicianId` اختياري، نفس نمط "مرن — اختار نطاق أيام" A.2 بس لفني واحد بدل "أي
  فني") — "متاح تاني إمتى".
- **`findScheduleConflictedTechnicians()` جديدة** — نفس بوابة الأهلية الصارمة لـ`listForServiceBooking()`
  بالحرف، بس بشرط التوافر المعاكس + استبعاد أي فني ظهر في الدلو "متاح" بالفعل. محدودة (`LIMIT 10`)،
  دايمًا آخر القايمة (المتاح فعليًا يفضل الأولوية).
- **`TechnicianBookingListItem`/`GET /services/:id/technicians`**: حقول جديدة
  `availability_status`/`unavailable_reason_ar`/`available_again_at`. `'available'` دايمًا لكل
  الصفوف الحالية — رجريشن صفري.
- **اختبار حي جديد**: `schedule-conflict-visibility.spec.ts` (3/3 — الافتراضي `false` يخفي
  المتعارض تمامًا، `true`+`scheduledAt` نفس يوم التعارض يظهره بسبب+معاد توافر، `true` بلا
  `scheduledAt` صفر تأثير).
- **خارج نطاق الشريحة دي عمدًا**: تصفح الشغالة (Slice C — كان صفر تعارض قبل ADR-0030 Slice A،
  المحرك كله لازم يتبني من الصفر بدقة ساعة)، واجهة Flutter (Slice D).

## ظهور صورة البروفايل — كانت بَقّة حقيقية لأي فني (ADR-0031)

**اكتشاف حي (بلاغ مالك 2026-08-21)**: مستند `TechnicianDocumentType.PHOTO` ("صورة شخصية") كان
بيتعامل زي أي مستند KYC عادي (`technician_documents`، مراجعة أدمن) — **صفر ربط بـ`users.avatar_url`
في أي مكان بالكود**، لا وقت الرفع ولا وقت الاعتماد. أخطر من كده: `apps/technician-app`'s
`_VerificationGate` (`main.dart`) بتوجّه أي فني `approved` مباشرة لـ`AvailableOrdersScreen` للأبد —
`OnboardingScreen` (المكان الوحيد اللي فيه رفع مستندات) بتختفي تمامًا بعد أول اعتماد، يعني فني
معتمد معندوش أي طريقة يغيّر/يشوف صورته من التطبيق خالص.

- **`users.avatar_storage_key`** (عمود جديد، migration 0168) — المصدر المعتمد (بعد موافقة الأدمن)،
  storage key ثابت مش رابط presigned جاهز (بينتهي بعد 7 أيام في S3 — نفس نمط
  `branding_assets`/`technician_documents`/`technician_certificates` بالحرف).
  `AdminTechniciansService.reviewDocument()` بيحدّثه بس لما يعتمد مستند `documentType=photo`.
- **`resolveAvatarUrl(storage, avatarUrl, avatarStorageKey)`** جديدة (`common/storage/`) —
  `avatarStorageKey` موجود → `storage.getUrl()` طازج دايمًا؛ غير كده → `avatarUrl` الخام كما هو
  (توافق خلفي). متوصّلة لأهم سطحين "العميل بيتصفّح/يختار مزوّد": `GET /technicians/:id/profile`
  (كان أصلاً async+storage-aware للشهادات) و`GET /services/:id/technicians` (`CatalogController`
  بقى محتاج `StorageService` جديد، بيحلّ كل الصفوف دفعة واحدة بـ`Promise.all` بعد الاستعلام).
- **معاينة ذاتية فورية منفصلة تمامًا** — `GET /technician/me` بيرجّع `avatar_url` = آخر مستند
  `photo` رفعه الفني نفسه (`TechnicianDocumentsService.findLatestOfType()` جديدة)، **بغض النظر
  عن حالة المراجعة** — الفني بيشوف اللي رفعه هو فورًا، بلا أي بوابة اعتماد. مصدر مختلف تمامًا عن
  `avatar_storage_key` فوق (اللي بس بيتحدّث بعد الاعتماد، للعميل).
- **`ProfileScreen` (`apps/technician-app`)** — كانت شاشة "بروفايلي" بلا أي عرض/رفع صورة خالص.
  بقى فيها `CircleAvatar` (من `TechnicianMe.avatarUrl` الجديد) + زرار كاميرا صغير بيعيد استخدام
  `OnboardingRepository.uploadDocument(documentType:'photo')` الموجودة أصلاً — صفر endpoint جديد،
  صفر منطق رفع مكرر.
- **خارج نطاق الإصلاح ده عمدًا**: سطوح داخلية تانية (`favorites`، `order-team`/team recruit) لسه
  بتعرض `avatar_url` الخام بلا resolve — مش "تصفّح/اختيار مزوّد" مباشر، مؤجّلة (ADR-0031 Slice G).
- اختبار حي جديد: `avatar-visibility.spec.ts` (5/5) — معاينة ذاتية فورية بغض النظر عن حالة
  المراجعة، `avatar_storage_key` بيتحدّث بس عند الاعتماد (مش الرفض)، `resolveAvatarUrl()` أولوية
  المفتاح على الرابط الخام. صفر رجريشن على `technicians`/`catalog`/`auth` بالكامل (171/171).
- **ده جزء من تصحيح اتجاه Phase A.4 الأكبر (إلغاء بنية الشغالة المنفصلة، مش نقلها) — التفاصيل
  الكاملة في `docs/adr/0031-unified-provider-system-and-avatar-visibility.md`.**

## مساحة عمل الشركة — `GET /technician/company/orders` (ADR-0033، 2026-08-22)

طلب مالك مباشر: شاشة "شركتي/فريقي" (فوق) كانت بتغطي الإدارة الذاتية (فروع/أعضاء/رتب) بس، صفر
ربط بالشغل الفعلي الجاي للشركة — مهم كـ"دعاية" لجذب شركات حقيقية للمنصة. القرار الكامل في
`docs/adr/0033-company-workspace-orders.md` (كان موثّق كقرار متّخذ في `docs/08` §42 Phase B.1 من
جلسة سابقة، اتنفّذ دلوقتي فعليًا).

- **`orders.assigned_company_id`** (migration 0173) — snapshot، مش استعلام حي: بيتسجّل مرة واحدة
  في `MatchingService` (المكانين الوحيدين اللي `order.technicianId`/`ACCEPTED` بيتسجّلوا فيهم —
  `confirmTechnicianForOrder()` التأكيد التلقائي و`accept()` القبول الصريح) من `companyId` بتاع
  الفني وقتها. **بعد كده مش بيتغيّر** حتى لو الفني سايب الشركة (نفس فلسفة الحفاظ على التاريخ).
- **`TechnicianCompaniesService.listOrders(userId)`/`listOrdersForAdmin(companyId)`** — SQL
  مباشر (4 جداول join: orders/services/service_zones/technician_profiles+users)، آخر 100 طلب
  للشركة، الأحدث أولًا. `GET /technician/company/orders` (أي عضو، نفس مستوى `GET /technician/company`)
  و`GET /admin/technician-companies/:id/orders` (إشراف read-only). صف ملخّص بس (`CompanyOrderSummaryResponseDto`)
  — مش تفاصيل تنفيذ كاملة، القائمة دي متابعة/نظرة عامة.
- **صفر endpoint إحصائيات منفصل عمدًا** ("نشط دلوقتي"/"مكتمل"/إجمالي القيمة) — كل حاجة محسوبة على
  مستوى العرض (`apps/admin`، `apps/technician-app`) من نفس القائمة، بإعادة استخدام تجميع
  `ACTIVE_TECHNICIAN_ORDER_STATUSES` (`order-state-machine.ts`) مترجم محليًا. طلب مالك صريح: "ما
  ترهصش الدنيا... اختار الأسهل".
- **خارج نطاق ADR-0033 عمدًا**: توزيع أرباح الطاقم (Phase B.3 في `docs/08` §42) — فجوة مالية
  حقيقية موجودة من قبل (قائد الطلب بياخد كل الفلوس، أعضاء الفريق صفر)، قرار مالي مستقل، مش بيتحل
  هنا. حجز الشغالة المباشر (ADR-0031 Phase A.4) برضه خارج النطاق — مسار بيتخطى `MatchingService`
  بالكامل، مفهوم "شركة" مش منطبق عليه.

---

## علامة التوثيق (Trust Badge) — ADR-0039 / docs/08 §62.1

**بلاغ المالك**: «العلامة الزرقاء … أي حد بيسجل جديد بياخدها عادي من غير حاجة. لأ، المفروض الأدمن
يتحكم مين اللي ياخد العلامة دي».

**السبب في الكود** (متأكَّد منه، مش استنتاج): `listForServiceBooking()` كانت بتحط `isVerified: true`
**حرفيًا** في التلات مسارات (الأفراد، الشركات، والمتعارضين جدوليًا)، بتبرير إن فلتر
`verification_status = 'approved'` فوق بيضمن إن الصف "موثّق". التبرير ده تقنيًا صح وتجاريًا غلط:
`approved` = "استوفى أوراقه ومسموح له يشتغل"، مش "المنصة بتضمنه".

**الشكل الحالي**:

- `technician_profiles.is_trust_verified` و`technician_companies.is_trust_verified` (migration 0194)
  + `trust_verified_at/by/note` للتدقيق. الافتراضي `false` للكل، **بلا backfill** (مقصود — راجع ADR).
- `verification_status` وكل بوابات الأهلية/المطابقة **ما اتلمسوش خالص**. سحب العلامة مبيمنعش الفني
  من الشغل، ومنحها مش شرط للظهور في القوايم.
- `PATCH /admin/technicians/:id/trust-badge` و`PATCH /admin/technician-companies/:id/trust-badge`،
  الاتنين تحت `@RequirePermission('technicians.approve')` ومسجّلين في `audit_log`
  (`technician.trust_badge_granted/revoked` ونظائرهم للشركة).
- **الكونترولر `admin-technician-companies.controller.ts` كان read-only بالكامل** — العلامة هي
  الكتابة الوحيدة فيه، لأن الإدارة الذاتية للشركة مينفعش تشمل منح إشارة ثقة لنفسها.

## عرض الشركة في قايمة اختيار مقدّم الخدمة — docs/08 §62.2

- **السعر بقى بيظهر.** `catalog.controller.ts` كانت بترجّع `estimate: null` لأي صف شركة بحجة
  "مفيش فني محدد بعد فأي سعر تخمين". التبرير كان غلط: `OrdersService.create()` بيسعّر حجز الشركة
  بـ`knownTechnicianLevel = undefined` (مضاعف = 1) — يعني السعر الأساسي هو **بالظبط** اللي هيتحصّل.
- **بَقّة حقيقية اتصلحت معاها**: `LevelPremiumService.applyOnAutoAssignment()` كانت بتتخطّى بس لو
  `requestedTechnicianId` موجود. حجز الشركة بيسيبه `null`، فأول ما المطابقة تعيّن عضو مستواه أعلى
  كان فرق "فني مميّز" بيتضاف **بعد** تأكيد العميل. الحارس بقى بيشمل `requestedTechnicianCompanyId`.
- `serviceCompletedCount` للشركة كان `0` ثابت (رقم كاذب معروض للعميل) — بقى
  `SUM(technician_services.completed_count)` لأعضاء الشركة المؤهلين للخدمة.

### فجوة موثّقة (مفتوحة عن قصد)

`apps/customer-web` مبيعرضش كروت الشركات ولا علامة التوثيق أصلاً (بيقرأ `final_price_cents` بس من
نفس الـendpoint). الحقول راجعة له في الرد وبيتجاهلها — مفيش كسر، بس التجربة الجديدة موجودة في
`apps/customer-app` بس دلوقتي.
