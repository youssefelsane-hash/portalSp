# ADR-0031: نظام مزوّد واحد موحّد — إلغاء بنية الشغالة المنفصلة + تصحيح اتجاه Phase A.4

**الحالة:** معتمد — يستبدل بنية "الشغالة كنوع مستخدم منفصل" في ADR-0004، ويلغي مسار الهجرة الموصوف
في ADR-0029 (كان قايم على نقل نفس البنية المنفصلة للمحرك الموحّد، مش إلغاءها). Slice A (تصحيح
ظهور صورة البروفايل) منفّذ في الـcommit ده. باقي الشرائح (توحيد التسجيل/الكتالوج/الحجز) موثّقة تحت،
لسه مفتوحة — دي نقطة التتبع الحية بديلة عن `docs/08 §42`'s الفرع القديم.

**التاريخ:** 2026-08-21

## السياق

طلب مالك تصحيحي صريح (2026-08-21، فوق شغل A.4 نفسه اللي كان قايم على ADR-0029): البنية اللي
اتبنيت لحد دلوقتي (`DomesticWorkerProfile` ككيان مستخدم مستقل تمامًا، `userType='domestic_worker'`،
مسار تسجيل/اعتماد/حجز/دفع منفصل بالكامل) **غلط من الأساس**، مش تفصيل ينفع يتظبط لاحقًا. المطلوب
الحقيقي:

> "الشغلانة سريعة" ما ينفعش يبقى لها نظام مزوّد تاني — الشغالة/المربية/عامل التنظيف لازم يكونوا
> **فنيين عاديين بالظبط**، بيسجّلوا بنفس مسار تسجيل الفني، بيرفعوا نفس المستندات، الأدمن بيعتمدهم
> بنفس شاشة اعتماد الفنيين، وبعد الاعتماد بيختاروا تخصصاتهم من كتالوج عادي فيه فئة "خدمات منزلية"
> (جليسة أطفال، مربية، تنظيف بالساعة، إقامة شهرية...) بالظبط زي ما فني تاني يختار سباكة/كهرباء.

**مفيش بيانات إنتاجية حقيقية لازم تتحفظ** — المالك صريح: "There is no production historical data
that needs to be preserved." فالإلغاء الكامل للبنية القديمة (مش مجرد "توقف عن الاستخدام") قرار
سليم ومطلوب، مش خطر يستأهل حذر زيادة.

**بلاغ عاجل مصاحب (نفس الطلب)**: صورة البروفايل ("لما الشخص يرفع صورته، الصورة تظهر في البروفايل
بتاعه، إن هي ما بتظهرش") — بَقّة حقيقية مستقلة تمامًا عن قرار توحيد المزوّدين، بس اتلاقيت أثناء
نفس التدقيق، واتصلحت في نفس الـcommit (Slice A تحت) لأنها جزء أساسي من "مسار تسجيل فني واحد يشتغل
صح فعليًا" اللي المالك طلبه.

### تدقيق حي قبل أي كود

1. **`apps/technician-app/lib/main.dart`** — `if (auth.user?.userType == 'domestic_worker') return const WorkerHomeScreen();`
   قبل `_VerificationGate` — **ده بالظبط المسار التاني اللي المالك رافضه**. `WorkerHomeScreen`
   (`features/domestic_worker/`) بيعدّي `_VerificationGate` بالكامل (تعليق الكود نفسه صريح:
   "الشغالة مالهاش مسار تحقق مستندات زي الفني (KYC كامل)") — يعني شغالة تقدر تسجّل وتستقبل طلبات
   بمراجعة أضعف بكتير من الفني العادي، فجوة أمان/جودة حقيقية مش بس تكرار كود.
2. **`apps/technician-app/lib/features/auth/login_screen.dart`** — `ButtonSegment(value:
   'domestic_worker', label: Text('شغالة / مربية'))` في شاشة التسجيل — اختيار صريح لنوع حساب
   مختلف وقت التسجيل، بالظبط الحاجتين اللي المالك قال "ميلاقيش فوق حاجتين".
3. **الباك-إند**: `DomesticWorkersModule` كيان كامل مستقل (`DomesticWorkerProfile` entity، جدول
   `domestic_worker_profiles`، تسجيل/اعتماد/تصفّح/حجز منفصلين تمامًا — `domestic-workers.service.ts`,
   `admin-domestic-workers.controller.ts`, `domestic-worker-bookings.service.ts`) — مش مجرد
   Service إضافية في الكتالوج، نظام مستخدم (`UserType`) مستقل بمنطقه الخاص بالكامل.
4. **`apps/customer-app`**: `features/domestic_workers/` شاشات منفصلة تمامًا (`DomesticWorkersScreen`,
   `WorkerDetailScreen`, `WorkerBookingsScreen`) — تصفّح/حجز مختلف تمامًا عن `TechnicianSelectionScreen`/
   `TechnicianMarketplaceScreen` اللي أي خدمة تانية (سباكة، كهرباء...) بتستخدمهم.
5. **صورة البروفايل**: `TechnicianDocumentType.PHOTO` ("صورة شخصية") مستند مراجعة عادي زي أي
   مستند KYC تاني (`technician_documents` جدول، `review_status`) — **صفر ربط بـ`users.avatar_url`
   في أي مكان بالكود**، لا وقت الرفع ولا وقت اعتماد الأدمن. `onboarding_screen.dart`'s قايمة
   المستندات بتعرض `ListTile` نصي بس (نوع المستند + حالة المراجعة)، صفر معاينة صورة فعلية.
   وأخطر من كده: `main.dart`'s `_VerificationGate` بتوجّه أي فني `verification_status='approved'`
   مباشرة لـ`AvailableOrdersScreen` **للأبد** — `OnboardingScreen` (المكان الوحيد اللي فيه رفع
   مستندات) بتختفي تمامًا بعد أول اعتماد، يعني فني معتمد أصلاً معندوش أي طريقة يغيّر صورته أو
   يشوفها من التطبيق خالص.
6. **قيود presigned URLs** — `S3StorageService.getUrl()`'s تعليقها الصريح: "presigned جديد كل
   مرة... الكولر (زي branding module) بيخزّن الـkey بس، مش الرابط" (بينتهي بعد 7 أيام). يعني حل
   "خزّن رابط الصورة المعتمدة مباشرة في `avatar_url`" غلط للإنتاج (هيتعطب بعد أسبوع) — لازم نفس
   نمط `branding_assets`/`technician_documents`/`technician_certificates`: مفتاح ثابت + `getUrl()`
   طازة وقت كل قراءة. في dev (local disk storage)، الروابط ثابتة أصلاً (مفيش presigning) — المشكلة
   دي بتظهر بس في إنتاج S3 حقيقي، فمينفعش تتجاهل بحجة "شغالة دلوقتي في السانبوكس".

## القرار

### 1. مزوّد واحد فقط — إلغاء `DomesticWorkerProfile` كنوع مستخدم/كيان مستقل

الشغالة/المربية مش نوع حساب مختلف، ومش entity مختلف. بعد التنفيذ الكامل (الشرائح تحت):

- **صفر `UserType.DOMESTIC_WORKER`** — كل مزوّد خدمة هو `UserType.TECHNICIAN` بالظبط، بنفس
  `TechnicianProfile` entity، بنفس مسار `POST /technician/*` (تسجيل، مستندات، بروفايل).
- **صفر شاشة تسجيل ثانية** في `apps/technician-app` — `login_screen.dart`'s segmented control
  ("فني" / "شغالة") يتشال بالكامل، مسار تسجيل واحد بس.
- **صفر `WorkerHomeScreen`** — كل الفنيين (أيًا كان تخصصهم) بيعدّوا نفس `_VerificationGate` (KYC
  كامل زي أي فني تاني، مفيش استثناء "مراجعة أخف").
- **صفر `DomesticWorkersModule`** في الباك-إند بعد اكتمال الترحيل — `domestic_worker_profiles`,
  `domestic_worker_bookings`, `domestic_worker_earning_approvals` تتشال (مفيش بيانات إنتاجية
  تتحفظ، تصريح المالك).

### 2. "خدمات منزلية" = فئة كتالوج عادية، مش نظام مواز

الأدمن بينشئ `ServiceCategory` عادية ("خدمات منزلية") فيها `Service` rows عادية (جليسة أطفال
بالساعة، مربية، تنظيف بالساعة، تنظيف بالساعة الشهري/مقيم، ...) — **بالظبط نفس آلية أي فئة تانية**
(سباكة، كهرباء). التسعير عبر محرك التسعير الموجود (`base_price_cents`/`hourly` pricing model —
**`PricingModel.WORKER_RATE`** المُضاف في ADR-0029 Slice 1 **يتلغي**، مفيش داعي لموديل تسعير خاص،
`hourly` الموجود من زمان كافي). الفني بيبقى مؤهّل لخدمة "جليسة أطفال" بنفس آلية `TechnicianService`
اللي فني تاني بيبقى بيها مؤهّل لخدمة "تسليك مواسير" — **صفر بنية أهلية جديدة**.

### 3. قدرة عامة جديدة على `Service`: دقة الوقت (`requires_precise_schedule`)

بعض خدمات "خدمات منزلية" (جليسة أطفال بالساعة، تنظيف بالساعة) محتاجة دقة ساعة حقيقية (بداية+مدة أو
بداية+نهاية)، عكس بقية الخدمات اللي دقتها يوم بس (ADR-0018). ده **مش خاص بالخدمات المنزلية** —
أي خدمة تانية ممكن تحتاجه مستقبلاً (زي المالك قال صراحة: "just like we can configure whether cash
is allowed, a service can have a yes/no option for whether precise time selection is required").

- `services.requires_precise_schedule` (`boolean NOT NULL DEFAULT false`) — نفس نمط
  `cash_allowed`/`deposit_required`/`allows_date_range_booking`/`show_unavailable_providers` بالحرف.
- لما `true`: العميل بيحدد بداية + (مدة بالساعات أو نهاية) وقت الحجز، مش يوم بس. `OrdersService.create()`
  بيتحقق من التعارض بدقة ساعة (نفس منطق `findSchedulingConflict()` اللي اتبنى في ADR-0030 Slice C
  لحجز الشغالة القديم — **بيتعمم هنا لأي فني عادي**، مش يتلغي). الفني نفسه بيتفحص أهليته عادي
  (`TechnicianService`)، بس فحص التعارض الزمني بيبقى بدقة ساعة بدل يوم لما الفلاج ده مفعّل.
- ده معناه `technicianAvailabilityCondition()` (يوم-مستوى بتصميم ADR-0018) و`assertNoSchedulingConflict()`-
  ستايل (ساعة-مستوى) لازم يتقابلوا في مكان واحد بدل ما يفضلوا مسارين منفصلين — تصميم تفصيلي
  للشريحة دي، مش مقفول هنا، موثّق كسؤال مفتوح تحت.

### 4. سياسة إظهار المرشّحين المتعارضين (ADR-0030) — **بلا تغيير، تُبنى عليها**

`TechniciansService.listForServiceBooking()`'s الدلو الإضافي (`show_unavailable_providers`) أصلاً
عام بالكامل — بيشتغل لأي `Service`، مش مربوط بالشغالة خالص. **صفر لمس مطلوب هنا** — بمجرد ما
الشغالة تبقى فني عادي مؤهّل لخدمة "جليسة أطفال"، الآلية دي شغالة عليها تلقائيًا زي أي فني تاني.
هي فعليًا **الجزء الوحيد من شغل A.4/ADR-0030 اللي كان عام من الأول ومطابق تمامًا للاتجاه الجديد**.

### 5. الإصلاح الفوري (Slice A، منفّذ في الـcommit ده): ظهور صورة البروفايل

مستقل عن كل قرارات التوحيد فوق — بيصلح فجوة حقيقية موجودة **دلوقتي** لأي فني (مش بس شغالة مستقبلية).
تصميمه بيفرّق بين حالتين مختلفتين تمامًا (المالك كان صريح فيهم):

- **معاينة ذاتية فورية** ("الصورة تظهر في بروفايله هو فورًا"): `GET /technician/me` بترجّع
  `avatar_url` = آخر مستند `photo` رفعه الفني نفسه، **بغض النظر عن حالة المراجعة**. مصدرها
  `TechnicianDocumentsService.findLatestOfType()` جديدة + `toTechnicianDocumentResponseDto()`
  الموجودة (نفس نمط `getUrl(storageKey)` الطازج). صفر بوابة اعتماد — الفني بيشوف اللي رفعه هو فورًا.
- **الأفتار الرسمي المعتمد** ("بعد الاعتماد، العميل يشوفها"): `users.avatar_storage_key` (عمود
  جديد، migration 0168) — بيتحدّث بس لما الأدمن يعتمد مستند `photo` (`AdminTechniciansService.reviewDocument()`).
  مصدر منفصل تمامًا عن المعاينة الذاتية فوق. `resolveAvatarUrl()` جديدة (`common/storage/`) —
  نفس نمط `branding`/`technician_documents`/`technician_certificates`: مفتاح ثابت، `getUrl()`
  طازج وقت كل قراءة (presigned URLs بتنتهي، تخزين الرابط الجاهز غلط للإنتاج).
  اتوصّلت لأهم سطحين "العميل بيتصفّح/يختار المزوّد فيهم": `GET /technicians/:id/profile`
  (البروفايل العام، كان أصلاً async+storage-aware للشهادات) و`GET /services/:id/technicians`
  (قايمة الاختيار قبل الحجز، `CatalogController` بقى محتاج `StorageService` جديد).

**خارج نطاق الإصلاح ده عمدًا (فجوة موثّقة، مش سهو)**: سطوح داخلية تانية بتعرض `avatar_url` خام
(`favorites.service.ts`, `order-team.service.ts`, `recruit-candidate-response.dto.ts`) —
مش "العميل بيتصفّح/يختار مزوّد" بالمعنى المباشر (فريق داخلي/مفضّلة سابقة)، هتفضل تعرض `avatar_url`
الخام (بيشتغل في dev، هيحتاج توحيد لاحق لو/لما الإنتاج يستخدم S3 حقيقي presigned URLs) — تحسين
تابع سريع مؤجّل، موثّق هنا بدل ما يتسيب بصمت.

## الشرائح (خطة التنفيذ الكاملة)

- **Slice A (خلصت، الـcommit ده)**: إصلاح ظهور صورة البروفايل — تفاصيل فوق.
- **Slice B (مفتوحة)**: `requires_precise_schedule` — migration + `Service` entity + admin
  checkbox + `OrdersService.create()` تحقق دقة ساعة + Flutter (بداية+مدة/نهاية بدل يوم بس لما
  الفلاج مفعّل). **سؤال تصميم مفتوح**: هل فحص التعارض الساعي بيتعمّم داخل
  `technician-eligibility.sql.ts` (SQL مباشر، أداء أحسن للمطابقة) ولا يتبنى كدالة TS منفصلة زي
  `findSchedulingConflict()` القديمة (أسهل قراءة، أقل تكرار مع فحص الإنشاء)؟ يتقرر قبل التنفيذ.
- **Slice C (مفتوحة)**: فئة "خدمات منزلية" + خدماتها في الكتالوج (بيانات أدمن، صفر كود جديد أصلاً
  لو الفلاجات فوق جاهزة) + إلغاء `PricingModel.WORKER_RATE` (رجوع لـ`hourly` العادي).
- **Slice D (مفتوحة)**: إلغاء مسار التسجيل التاني — `login_screen.dart`'s segmented control،
  `main.dart`'s `WorkerHomeScreen` branch، `features/domestic_worker/` بالكامل.
- **Slice E (مفتوحة)**: إلغاء الباك-إند بالكامل — `DomesticWorkersModule`، الـentities، الجداول
  (migration جديدة `DROP TABLE`)، كل الكود المرتبط (`orders.domestic_worker_profile_id`/
  `domestic_worker_duration_hours` من ADR-0029/ADR-0030، `WORKER_RATE` من `OrdersService.create()`).
- **Slice F (مفتوحة)**: إلغاء `apps/customer-app`'s `features/domestic_workers/` بالكامل —
  العميل بيتصفّح/يحجز "جليسة أطفال" بنفس `TechnicianSelectionScreen`/`TechnicianMarketplaceScreen`
  زي أي خدمة تانية.
- **Slice G (مفتوحة)**: تحسين تابع لظهور الصورة — باقي سطوح `avatar_url` الداخلية (favorites،
  team recruit) لو الوقت سمح، مش حرج.

## البدائل اللي اتقيّمت

- **الإبقاء على `DomesticWorkerProfile` وربطها بـOrders الموحّد (خطة ADR-0029 الأصلية)** — رُفضت
  صراحة من المالك. كانت بتحل "نفس النظام الموحّد للطلبات" بس بتسيب "نظام مزوّد مختلف" قايم، عكس
  المطلوب الحقيقي: مزوّد واحد بس، مش أنظمة متوازية بتتقابل عند الطلب بس.
- **علم "دقة الوقت" خاص بالخدمات المنزلية بس** — رُفض. المالك صريح إنه فلاج عام على `Service` زي
  الباقي، مش حل خاص لقطاع واحد.
- **تخزين رابط presigned جاهز مباشرة في `avatar_url` بدل مفتاح ثابت** — رُفض (بند 6 في السياق فوق)
  — هيتعطب بعد 7 أيام في إنتاج S3 حقيقي، مخالف لمعيار "شركات عالمية" (CLAUDE.md).
- **حذف بيانات الشغالة القديمة فورًا في نفس commit الإصلاح ده** — رُفض دلوقتي (مش لأسباب حذر بيانات
  — المالك صريح إن مفيش بيانات تستأهل الحفاظ عليها — لكن لأن الإلغاء الآمن محتاج الشرائح B/C جاهزة
  الأول (فلاج دقة الوقت + فئة الكتالوج)، وإلا هنسيب الشغالات الحاليين بلا أي طريقة يشتغلوا بيها
  خلال الفجوة. تسلسل الشرائح فوق مصمم عشان صفر توقف خدمة فعلي).
