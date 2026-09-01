# Operations (مركز العمليات)

بداية "مركز العمليات" الجديد في `apps/admin` (docs/08 §36.2 فصاعدًا) — قسم مستقل هيتوسّع مرحلة
بمرحلة (§36.3 مصفوفة قوى عاملة ✅، §36.4 عرض حمل ✅، §36.5 مفتّش مطابقة، §36.6 "ليه/ليه لأ"، §36.7 مراقبة
تسليم، §36.8 تايم لاين، §36.9 تنبيهات، §36.10 ذكاء تغطية، §36.11 تحكم أدمن، §36.12 بحث/فلترة، §36.13
بروفايل 360، §36.14 لغة بصرية موحّدة).

## §36.3 — مصفوفة القوى العاملة (مدينة → نطاق → فئة → فني)

**صفر منطق جديد** — الـUI الجديد فوق `apps/admin/src/app/operations/page.tsx` (قسم
`WorkforceMatrixSection`) بيستهلك نفس endpoint مركز عمليات الفئة الموجود بالفعل (§35.9،
`AdminTechnicianCategoryOpsService`، `GET /admin/technicians/by-category`) — التعديل الوحيد في
الباك-إند إضافة فلتر `zone_id` اختياري (`EXISTS` واحد على `technician_zones`، نفس الجدول اللي
`zone_count` أصلًا بيتحسب منه) فوق فلتر `category_id` الموجود. الفئة مشتركة مع فلتر الصفحة
الرئيسي (§36.2)، النطاق فرعي تحته عبر cascading select مدينة→نطاق (نفس نمط
`apps/admin/src/app/geo/page.tsx`).

**بَقّة حقيقية اتلقطت واتصلحت وقت التحقق الحي (مش jest)**: `AdminTechnicianCategoryOpsService.list()`
بترجّع `{items, meta}` من الـcontroller، لكن `ResponseInterceptor` في `apps/api` بيكتشف الشكل ده
تلقائيًا وبيفكّه (`items` → `envelope.data` مباشرة، `meta` → `envelope.meta` على مستوى الـenvelope
نفسه، مش متداخل جوّه `data`). أول نسخة من الواجهة استخدمت `authedFetch<T>()` العادي (بيرجّع
`envelope.data` بس) متوقّعة `{items, meta}` كشكل واحد — كراش فوري (`Cannot read properties of
undefined (reading 'total')`) لأن الناتج الفعلي كان الـarray مباشرة، مالوش `.meta` خالص. **الإصلاح**:
`authedFetchPaginated<AdminCategoryOpsRowDto>()` (نفس النمط المستخدم بالفعل في
`apps/admin/src/app/technicians/page.tsx`) بدل `authedFetch` — اتأكد حيًا (Playwright، سكريبت مؤقت
زي §36.2) بعد الإصلاح: تسجيل دخول حقيقي، فئة "سباكة" حقيقية من الداتابيز (4 فنيين)، فلترة بمدينة
الإسكندرية → نطاقها بقصّرت النتيجة لـ3 فنيين صح (استبعاد الفني اللي بس على نطاق القاهرة).

اختبار حي جديد في `admin-technician-category-ops.spec.ts`: فلتر `zone_id` بيقصر النتيجة على الفنيين
المعتمدين على النطاق ده بس، ونطاق فاضي بيرجّع مجموعة فاضية (مش بس "نفس النتيجة القديمة").

## §36.4 — عرض الحمل القريب (7 أيام)

`AdminWorkloadForecastService.getForecast({categoryId, zoneId?, page, perPage})` —
`GET /admin/operations/workload-forecast`. **صفر تصنيف موازي جديد**: كل يوم من الـ7 بيتصنّف بنفس
شروط `classifyTechnicianCapacity()` بالحرف (`BLOCKED > HEAVY > MEANINGFUL > LIGHT`)، بس كـbulk
aggregate واحد (`WITH RECURSIVE date_series` مع `CROSS JOIN` على مجمّع الفنيين المُصفّح) بدل نداء
منفصل لكل (فني، يوم) — نفس فلسفة `capacity_today`/مجمّع §35.9.

**اكتشاف حقيقي مهم اتوثّق صراحة أثناء البناء**: تصنيف HEAVY الحالي (`technician-eligibility.sql.ts`)
بيفحص بس إن `scheduled_at::date = target_date` — طلب "يومين" (`estimated_duration_days=2`) بيوصّم
يوم البداية بس كـHEAVY، **مش اليوم التاني تلقائيًا** (محرك المطابقة الحقيقي حاليًا مالوش أي
date-range spanning فعلي لشغلانات متعددة الأيام). عرض الحمل ده بيعكس بالضبط قرار المحرك الحقيقي —
مفيش تصنيف "أذكى" مُخترَع في الشاشة يخالف الواقع. `is_multi_day` علامة بصرية بس على يوم البداية
(تنبيه "الشغلانة دي متوقّع تاخد أكتر من يوم")، مش ادّعاء حجز. لو ده سلوك غير مقصود فعليًا، الإصلاح
معماري في `technician-eligibility.sql.ts` نفسه — خارج نطاق §36.4 بالكامل، موثّق هنا كفجوة صريحة.

`apps/admin`: قسم `NearFutureWorkloadSection` فوق نفس صفحة `/operations` (نفس قرار §36.2 — قسم
جديد فوق نفس الصفحة، مش صفحة منفصلة)، بنفس نمط مدينة→نطاق cascading من `WorkforceMatrixSection`
(§36.3) بس مستقل (اختيار مدينة/نطاق منفصل لكل قسم). جدول: صف لكل فني، عمود لكل يوم من الـ7 (شارة
تصنيف بنفس ألوان `capacityTierBadgeClass`/`CAPACITY_TIER_LABELS` الموجودة بالفعل — لغة بصرية
موحّدة، تمهيدًا لـ§36.14).

اختبار حي جديد `admin-workload-forecast.spec.ts` (7/7): كل الأيام LIGHT بلا طلبات، MEANINGFUL يوم
محدد بس، HEAVY (انشغال جسدي فعلي النهاردة)، `is_multi_day=true` يوم البداية بس + اليوم التاني بيفضل
LIGHT (قفل صريح للاكتشاف فوق، مش تصحيح ضمني)، أولوية BLOCKED فوق أي طلب تاني، فلتر `zone_id`،
ترقيم الصفحات. **بَقّة حقيقية اتلقطت واتصلحت أثناء كتابة الاختبار نفسه**: أول نسخة من
`AdminWorkloadForecastService` كانت بتمرّر صفوف الأيام الخام من `json_agg` (`is_multi_day` snake_case)
مباشرة كـ`WorkloadForecastDay[]` (`isMultiDay` camelCase) من غير أي تحويل فعلي — نوع TypeScript
كان بيكذب على الشكل الحقيقي وقت التشغيل، فـ`isMultiDay` كان دايمًا `undefined`. الاختبار
(`toMatchObject({isMultiDay: true})`) كشفها فورًا؛ الإصلاح: `RawDay`/`RawRow` منفصلين بالشكل
الحقيقي (`is_multi_day`) + تحويل صريح واحد في `getForecast()`.

**فجوة موثّقة صراحة (نفس فجوة §36.2/§36.3)**: التحقق الحي الكامل بمتصفح حقيقي (Playwright) مالوش
وقت كافي في السيشن دي — اتحاول تحقق مباشر عبر HTTP (curl + JWT حقيقي بنفس سر `.env` الفعلي، مستخدم
موجود فعلاً بالداتابيز) لكن اتوقّف قبل ما يوصل لنتيجة نهائية (رفض `JwtStrategy` غير مفسَّر بالكامل —
يحتاج تحقيق منفصل، خارج نطاق §36.4). الثقة في الصحة مبنية على: 7/7 اختبار حي ضد Postgres حقيقي
يغطي منطق SQL/الخدمة بالكامل، و`next build` كامل (تحقق TypeScript + تجميع الصفحة) نضاف صفر أخطاء.

## القاعدة الحاكمة

الموديول ده **مايخترعش** منطق أهلية/تصنيف جديد — كل رقم بيرجّعه معاد استخدامه من مصدر حقيقة موجود
فعلاً في موديولات تانية:

- `dispatch_pending_count` — حالات `SEARCHING_TECHNICIAN`/`AWAITING_TECHNICIAN_RESELECTION`
  (`orders/entities/order.entity.ts`).
- `crew_shortage_open_count` — `ESCALATABLE_STATUSES` مُصدَّرة من
  `orders/crew-shortage-escalation.service.ts` (§35.5)، مش قائمة حالات مكرّرة هنا.
- `technicians_online_count` — `RealtimeSessionRegistry.onlineUserIds()` (§35.10).
- `capacity_today` (LIGHT/MEANINGFUL/HEAVY/BLOCKED) — نفس شروط `classifyTechnicianCapacity()`
  بالحرف (`technicians/technician-eligibility.sql.ts`، §34.1)، بس bulk aggregate لكل الفنيين مرة
  واحدة (استعلام واحد بـCTEs) بدل نداء منفصل لكل فني — نفس أسلوب `MatchingExplainabilityService`
  بتاع §35.8.

## بنية الموديول

موديول مستقل (نفس نمط `MatchingModule`) — بيستورد ثوابت/كيانات خام من `orders` (`OrderStatus`،
`ACTIVE_TECHNICIAN_ORDER_STATUSES`، `ENGAGED_TECHNICIAN_ORDER_STATUSES`، `ESCALATABLE_STATUSES`) مش
`OrdersModule` نفسه، عشان يتجنّب أي دورة استيراد.

- `admin-operations-overview.service.ts` — `AdminOperationsOverviewService.getOverview({categoryId?})`.
- `admin-operations.controller.ts` — `GET /admin/operations/overview?category_id=...`،
  `@Roles(UserType.ADMIN)` بس (بلا صلاحية دقيقة مخصوصة، نفس مستوى `/orders`).
- `dto/operations-overview-query.dto.ts` — `category_id` اختياري (UUID).

## قرار عمل متعمّد: فلتر فئة بس (مش منطقة) في §36.2

فلتر المنطقة محتاج UI اختيار مدينة→منطقة (cascading selector) مش موجود جاهز في الصفحة دي حاليًا —
أنسب لـ§36.10 (ذكاء تغطية القوى العاملة، فئة+منطقة صراحة) بدل ما يتحشر هنا في "بنية أساسية" المفروض
تفضل بسيطة.

## اختبارات

`admin-operations-overview.spec.ts` — اختبار حي كامل ضد Postgres حقيقي (8/8): dispatch pending،
crew shortage مفتوح/مقفول، فلتر الفئة، وكل الـ4 tiers بسيناريوهات حقيقية.

## تحقق حي إضافي (مش jest بس)

اتعمل تحقق كامل عبر متصفح حقيقي (Playwright) ضد `apps/api`/`apps/admin` dev servers شغالين فعليًا:
تسجيل دخول حقيقي بحساب أدمن بلا role (مُعفى من MFA — راجع `auth/mfa-policy.service.ts`)، فتح
`/operations`، وأرقام حقيقية من الداتابيز ظهرت صح. **فجوة موثّقة صراحة**: مفيش بنية Playwright
تلقائية دائمة مثبّتة في المشروع (لا config، لا dependency، لا specs) رغم إشارة `apps/admin/README.md`
لها — التحقق ده كان سكريبت مؤقت غير محفوظ. بناء بنية اختبار حقيقية دائمة خارج نطاق §36.2.

## §36.7 — مراقبة تسليم الطلبات (REQ SENT + حالات حقيقية بس)

`admin-dispatch-delivery.service.ts` (`AdminDispatchDeliveryService.getDeliveryObservability()`) —
`GET /admin/operations/dispatch-delivery?category_id=&zone_id=&hours=&page=&per_page=`. صفر طبقة
تتبّع توصيل موازية جديدة: بيجمع مصدرين حقيقيين موجودين بالفعل ويعرضهم زي ما همّ —

- `order_assignments` (`matching/entities/order-assignment.entity.ts`، `AssignmentStatus`:
  sent/viewed/accepted/rejected/timeout/cancelled) — البث المباشر/الطوارئ لكل جولة. عنده
  `expires_at` حقيقي، فـ`stale_sent_count`/`is_stale` مُستنتجين مباشرة منه (صف لسه `sent` بعد ما فات
  معاده — على الأغلب `matching-round-expiry.processor.ts` لسه ما لحقهوش)، مش عتبة وقت تعسفية مخترعة.
- `technician_work_opportunities` (`technicians/technician-work-opportunities.service.ts`،
  `WorkOpportunityStatus`: offered/accepted/declined/closed) — فرص الشغل الإضافي الاختياري/تجنيد
  الفريق (§34.1/§35). مفيهاش `expires_at` أصلاً (migration 0153) فـ`is_stale` بتفضل `false` دايمًا
  لهم عمدًا. `context` (`assignment`/`crew_recruit`) بيتضمّن كمان.

الفئة والنطاق هنا **اختياريان** (بعكس §36.3/§36.4)، لأن الشاشة observability عبر النظام كله بطبيعتها،
مش تصفح فني بفئة محدد.

### بَقّة حقيقية اتلقطت وقت التحقق الحي (مش نظرية) — `ResponseInterceptor` بيقطع `summary` بصمت

المحاولة الأولى رجّعت `{summary, items, meta}` على المستوى الأول من الـcontroller.
`common/interceptors/response.interceptor.ts`'s `isPaginatedShape()` بيفحص وجود مفتاحي `items`+`meta`
بس (مش حصريتهم) — فأي رد فيه المفتاحين دول، بغض النظر عن أي مفاتيح تانية جنبهم، بيتقطع لـ
`data = payload.items` مباشرة، و`summary` بيختفي بصمت تام (لا خطأ، لا تحذير). اتلقطت فعليًا بـcurl حي
ضد Postgres حقيقي — `data.summary` كانت مفقودة تمامًا من الرد. **الحل**: تعشيش `items`/`meta` تحت
مفتاح `feed` منفصل (`{summary, feed: {items, meta}}`) — الـinterceptor بيفحص المستوى الأول بس، فمبيلمسش
`feed` جوّه. راجع تعليق `admin-dispatch-delivery.service.ts` للتفصيل الكامل. **ملحوظة لأي موديول
جديد تاني بيرجّع بيانات مجمّعة (summary) جنب قايمة مُرقّمة**: لازم نفس البنية المتعشّشة، مش items/meta
على نفس مستوى أي مفتاح تاني.

### اختبارات

`admin-dispatch-delivery.spec.ts` — اختبار حي (8/8) ضد Postgres حقيقي: كل حالات `order_assignments`
الست، `stale_sent_count`/`is_stale` (قبل/بعد المعاد)، `technician_work_opportunities` (offered/
accepted/closed + `context`)، فلتر `category_id`/`zone_id` (عبر `orders.service_zone_id`/
`services.category_id`)، فلتر `hours` (نافذة الرجوع)، وترقيم الصفحات. تحقّق حي إضافي بـcurl ضد
`apps/api` dev server شغال فعليًا (JWT حقيقي، مستخدم أدمن حقيقي بالداتابيز) — أكّد شكل الرد النهائي
بعد إصلاح البَقّة فوق.

**فجوة موثّقة صراحة**: مفيش UI لـ"إعادة إرسال يدوي" لصف `sent` متأخر من الشاشة دي — العرض observability
بس دلوقتي (المالك محدّدش "REQ SENT" كإجراء تصحيحي، بس كمراقبة). لو اتطلب لاحقًا، محتاج endpoint
تحكم جديد في `matching`/`technicians` (خارج نطاق §36.7).

## §36.9 — مركز الاستثناءات/التنبيهات (فوق تصعيد §35.4 + تنبيهات جديدة)

`admin-exception-center.service.ts` (`AdminExceptionCenterService.getExceptions()`) —
`GET /admin/operations/exceptions?category_id=&zone_id=`. لمحة "محتاج تصرّف دلوقتي" (نفس فلسفة كارت
"يحتاج انتباه" في `apps/admin/src/app/page.tsx` العام، بس مُركّزة على نطاق العمليات/المطابقة)، مش
جدول قابل للتصفح — محدودة بـ`EXCEPTION_LIST_LIMIT` (50)، و`total` بيعكس العدد الحقيقي الكامل حتى لو
أكبر من الحد. نوعين بس دلوقتي، صفر نوع استثناء بعتبة وقت مخترعة:

1. **نقص طاقم مصعّد ولسه مفتوح** — إعادة استخدام حرفي لـ`crew_shortage_escalated_at`/
   `ESCALATABLE_STATUSES` (§35.4/§35.5، `CrewShortageEscalationService`) و`computeCrewComposition()`
   (`orders/order-team.service.ts`) — نفس دالة حساب النقص المستخدمة فعليًا وقت التنفيذ، صفر نسخة
   موازية. الفلترة/العدّ في SQL (`HAVING`) بيطابق `computeCrewComposition()` بالحرف (نفس أولوية +1
   للقائد، `GREATEST(0, ...)`)، والقيم المُرجَّعة فعليًا محسوبة بنفس الدالة الحقيقية في TS — SQL بس
   للفلترة/العدّ الصحيح، مش مصدر الحقيقة.
2. **توزيع متأخر (stale dispatch)** — نفس شرط `order_assignments.assignment_status='sent' AND
   expires_at < now()` بالحرف زي §36.7's `stale_sent_count`/`is_stale`، **بلا نافذة `hours` محدودة**
   عمدًا (مختلف عن §36.7's rolling observability window) — "لسه sent ومعادها فات" حالة سيئة بغض
   النظر عن إمتى اتبعتت.

`apps/admin`: قسم "مركز الاستثناءات/التنبيهات" جديد في `/operations`، مكانه فوق مصفوفة القوى العاملة
مباشرة (أولوية بصرية للمحتوى الأكثر إلحاحًا) — كارت أخضر "مفيش استثناءات" لو القايمتين فاضيتين، وإلا
كارتين ملوّنين (أحمر لنقص الطاقم، أصفر للتوزيع المتأخر) بقايمة عناصر قابلة للنقر لصفحة الطلب/الفني.

### اختبارات

`admin-exception-center.spec.ts` — اختبار حي (7/7) ضد Postgres حقيقي: نقص فني/مساعد بعدد صحيح، طلب
مصعّد اكتمل طاقمه بعدين (مايظهرش)، طلب فريق مش مصعّد خالص (مايظهرش)، `is_overdue` قبل/بعد المعاد،
توزيع متأخر بغض النظر عن وقت الإرسال، assignment لسه قبل معاده (مايظهرش)، وفلتر `category_id`.
تحقّق حي إضافي بـcurl ضد `apps/api` dev server شغال فعليًا أكّد شكل الرد يطابق الـDTOs، ولقط فعليًا
نفس صف `stale_dispatch` الحقيقي اللي §36.7 لقطه في تحققها الحي.

**فجوة موثّقة صراحة**: نوعين بس دلوقتي — أنواع تانية مذكورة في مواصفة "يحتاج انتباه" العامة (طلبات
متأخرة، موافقات KPI معلّقة، تغييرات دور/أمان حديثة) لسه فجوة موثّقة في `apps/admin/src/app/page.tsx`
(خارج نطاق العمليات/المطابقة، مش جزء من §36.9). لو المالك طلب أنواع استثناء إضافية مُركّزة على
المطابقة (مثلاً "طلبات لسه بتدوّر من غير فني لمدة طويلة")، الفجوة الحقيقية عتبة زمنية واقعية —
مفيش إعداد جاهز يُعاد استخدامه حاليًا (خارج `matching.response_timeout_seconds` اللي بتاع الجولة
الواحدة بس، مش مدة البحث الكلية)، فمحتاجة قرار صريح من المالك قبل الإضافة، مش اختراع عتبة تعسفية.

## §36.10 — ذكاء تغطية القوى العاملة (فئة+منطقة)

`admin-coverage-intelligence.service.ts` (`AdminCoverageIntelligenceService.getCoverage()`) —
`GET /admin/operations/coverage?category_id=&zone_id=&page=&per_page=`. صف لكل زوج **(منطقة، فئة)**
بيجمع العرض والطلب في نفس الصف — القيمة المضافة الحقيقية مش تصنيف قدرة جديد (نفس
`classifyTechnicianCapacity()` بالحرف، bulk aggregate زي §36.2/§36.4)، لكن الجمع بين الجانبين:

- **العرض**: فنيين LIGHT/MEANINGFUL متاحين النهاردة (مسجّلين فعليًا في المنطقة/الفئة دي عبر
  `technician_zones`/`technician_categories`).
- **الطلب**: طلبات لسه بتدوّر (`DISPATCH_PENDING_STATUSES`، مُصدَّرة الآن من
  `admin-operations-overview.service.ts` — نفس §36.2 بالحرف).
- الأزواج بتتجمّع بـ`UNION` بين طرفي العرض/الطلب (`FULL OUTER JOIN`-مماثل) — زوج عنده طلبات بتدوّر
  بس **صفر فني مسجّل خالص** (أخطر حالة تغطية) بيظهر برضه، مش بس الأزواج اللي فيها فنيين بالفعل.
- `coverage_status` مُشتقّ بسيط في TS (مش عتبة نسبة مخترعة): `critical` (طلبات + صفر فني متاح)،
  `tight` (طلبات أكتر من الفنيين المتاحين)، `healthy` (غير كده).

الفئة والنطاق **اختياريان** (بعكس §36.3/§36.4) — الهدف مسح شامل لاكتشاف فجوات مش معروفة مسبقًا،
مرتّب افتراضيًا بأقل تغطية أولًا (`ORDER BY` فنيين متاحين تصاعديًا، طلبات بتدوّر تنازليًا).

`apps/admin`: قسم "ذكاء تغطية القوى العاملة" جديد في `/operations`، فوق مباشرة تحت مراقبة تسليم
الطلبات — جدول بفلتر مدينة→نطاق اختياري، شارات ملوّنة لحالة التغطية.

### اختبارات

`admin-coverage-intelligence.spec.ts` — اختبار حي (4/4) ضد Postgres حقيقي: `healthy` لفني LIGHT
بلا طلبات، `critical` لزوج صفر فني + طلب بيدوّر (أهم اختبار — يثبت ظهور الزوج رغم غياب أي صف عرض)،
`tight` لطلبات أكتر من الفنيين المتاحين، وترقيم صفحات صحيح. تحقّق حي إضافي بـcurl ضد `apps/api` dev
server — رجّع مصفوفة فاضية صح (اتأكّد مباشرة بـ`psql`: صفر صف `technician_categories` بحالة
`approved` في بيانات التطوير الحالية — نتيجة صحيحة تعكس الواقع، مش بَقّة).

**فجوة موثّقة صراحة**: مفيش نسبة تغطية رقمية (زي "65%") ولا اتجاه تاريخي (تحسّن/تراجع بمرور الوقت) —
لقطة اللحظة الحالية بس. لو المالك طلب اتجاه تاريخي، محتاج جدول snapshot دوري جديد (خارج نطاق §36.10،
قرار معماري يستاهل ADR لو اتطلب).

## §36.11 — تحكم أدمن من مركز العمليات (استهلاك أوامر §35.3 الموجودة، صفر إعادة بناء)

**صفر كود باك-إند جديد لهذا البند** — الأمر المطلوب استهلاكه (إعادة تعيين فني لطلب) موجود بالفعل
ومختبر: `GET /admin/orders/:id/eligible-technicians` + `POST /admin/orders/:id/reassign`
(`admin-orders.controller.ts`/`admin-orders.service.ts`، `@RequirePermission('orders.reassign')`).
`apps/admin/src/app/operations/page.tsx`'s جديد `StaleDispatchReassignAction` component — نفس
الاستدعاءين بالحرف المستخدمين فعليًا في `orders/[id]/page.tsx`'s `loadEligibleReassignTechnicians()`/
`handleReassign()`، بس كإجراء سريع inline جوّه صف "توزيع متأخر" في §36.9's مركز الاستثناءات (زر
"إعادة تعيين لفني تاني" → قايمة الفنيين المؤهّلين فعليًا لنفس الطلب → تأكيد → تحديث القايمة).
مُتاح بس لو `hasPermission('orders.reassign')` (نفس فحص الصلاحية المستخدم في صفحة الطلب، RBAC
حقيقي مش إخفاء واجهة بس — الباك-إند برضه بيرفض بلا الصلاحية دي).

**قرار عمل متعمّد**: صف "نقص طاقم مصعّد" (النوع التاني في §36.9) **مفيهوش** إجراء سريع مماثل —
تعديل الطاقم محتاج اختيار دور (فني/مساعد) + دور نصي حر (`role_label`)، أداة موجودة بالفعل وكاملة
في صفحة تفاصيل الطلب (Script4 §22-29). بناء نسخة مصغّرة منها هنا كان هيعني تكرار UI حقيقي لصفحة
موجودة أصلاً (خطر انجراف — تعديل واحد ينسى الأدمن يطبّقه في المكانين)، بعكس "إعادة تعيين" اللي
إجراء بسيط بمدخل واحد (اختيار فني) مايستاهلش زيارة صفحة كاملة. الرابط الموجود بالفعل (`عرض الطلب`)
كافي للوصول لأداة الطاقم الكاملة.

### اختبارات

صفر spec باك-إند جديد (صفر endpoint جديد) — الأمرين المُستهلَكين ليهم تغطية اختبار حية موجودة بالفعل
(`admin-orders-concurrency.spec.ts` وغيرها). `tsc --noEmit`/`next build` في `apps/admin` نضاف صفر
أخطاء. **فجوة موثّقة صراحة**: مفيش تحقق حي كامل بمتصفح (Playwright) للتدفق الجديد ده بالذات — مفيش
بيانات تطوير حالية فيها طلب حقيقي في حالة `stale_dispatch` + `REASSIGNABLE_STATUSES` سوا في نفس
اللحظة عشان يتجرّب end-to-end. الثقة مبنية على: (1) نفس استدعاءات API بالحرف زي `orders/[id]/page.tsx`
المُختبرة فعليًا بمتصفح حقيقي في §36.5/§36.6، (2) `tsc`/`next build` نضاف، (3) الباك-إند نفسه (الأمرين)
مختبر حي بالفعل من قبل.

## §36.12 — بحث/فلترة شاملة + درج قابل للتوسيع

**تعديل جراحي واحد إضافي بس على الباك-إند** (نفس نمط `zoneId` الموجود بالفعل، راجع تعليق
`admin-technician-category-ops.service.ts`) — فلتر `q` جديد (بحث بالاسم/كود الفني، `ILIKE` بسيط)
على `AdminTechnicianCategoryOpsService.list()` (`GET /admin/technicians/by-category`، §35.9/§36.3)،
قابل للجمع مع `verification_status`/`level`/`zone_id`/`category_id` الموجودين بالفعل.

- `apps/admin`: مصفوفة القوى العاملة (§36.3) — 3 عناصر فلتر جديدة (بحث، حالة الاعتماد، المستوى)
  قابلة للجمع مع فلاتر المدينة/النطاق/الفئة الموجودة. ديبونس بسيط (400ms) على مربّع البحث.
- `apps/admin`: ذكاء تغطية القوى العاملة (§36.10) — صفوفه بقت **قابلة للتوسيع** (`CoverageRowDrawer`
  جديد) — نقر على أي زوج (منطقة، فئة) بيفتح درج يعرض الفنيين الفعليين وراء الأرقام المجمّعة، بإعادة
  استخدام حرفي لنفس `GET /admin/technicians/by-category?category_id=&zone_id=` (صفر endpoint جديد
  للدرج نفسه — الإضافة الوحيدة هي فلتر `q` فوق، مستقل عن الدرج).

### اختبارات

`admin-technician-category-ops.spec.ts` — اختبار حي جديد لفلتر `q` (بحث بالاسم case-insensitive،
بحث بالكود، بحث بلا نتائج) — صفر ريجريشن على الاختبارات الموجودة (5/5 كلها ناجحة). `tsc --noEmit`/
`nest build`/`next build` نضاف صفر أخطاء. تحقق حي بـcurl أكّد إن `q` بيتقبل من غير خطأ (200، شكل رد
صحيح — نتيجة فاضية لأن بيانات التطوير الحالية صفر `technician_categories` معتمدة، نفس فجوة §36.10).
جناح jest كامل (`--forceExit`): 128/129 suite، 726/729 اختبار — صفر ريجريشن.

## §36.14 — لغة بصرية موحّدة + أداء/تحجيم + تحقق نهائي شامل (إغلاق مركز العمليات §36.2-14)

مرحلة إغلاق الـepic كله، مش ميزة جديدة — تدقيق + إصلاحين حقيقيين اتلقطوا أثناء التحقق.

### لغة بصرية موحّدة

تدقيق `apps/admin/src/app/operations/page.tsx` بالكامل: كل قسم من §36.4 لحد §36.13 بيستخدم نفس
tokens التصميم (`success`/`warning`/`danger` — `border-X/40 bg-X/10 text-X` للـbadges، `border-s-4
border-s-X` للكروت — صفر لون Tailwind خام زي `bg-red-100` في أي مكان). `capacityTierBadgeClass`/
`CAPACITY_TIER_LABELS` (نُقلت لـ`technician-labels.ts` من §36.3 خصيصًا تمهيدًا للمرحلة دي) هي نفسها
المستخدمة حرفيًا في مصفوفة القوى العاملة، عرض الحمل القريب، مفتّش المطابقة (تفاصيل الطلب)، مركز
الاستثناءات، ذكاء التغطية، ودرج التغطية — صفر تكرار لغة بصرية، صفر انحراف بين الشاشات. النتيجة:
اللغة البصرية كانت فعليًا موحّدة بالفعل من غير أي تعديل جديد مطلوب هنا — كل مرحلة سابقة بُنيت وهي
واعية بالمرحلة دي (موثّق صراحة في تعليقات `technician-labels.ts`).

### أداء/تحجيم

كل الاستعلامات الجديدة (§36.4-§36.13) `LIMIT`-bounded (10-50 صف حسب الحالة)، وبتعيد استخدام
partial indexes موجودة بالفعل بلا حاجة لمigration جديدة: `idx_order_assignments_live_dispatch`
(`assignment_status IN ('sent','viewed')`، migration 0125) لاستعلامات التوزيع المتأخر (§36.7/§36.9)،
`idx_technician_categories_category_id` (`WHERE is_active=true`، migration 0148) لاستعلامات
التغطية/البحث (§36.10/§36.12). صفر full-table scan جديد، صفر query على كل heartbeat.

### تحقق نهائي شامل + بَقّتين حقيقيتين اتلقطوا أثناءه

جناح jest الكامل (`--forceExit`) كشف عن مشكلتين حقيقيتين **مش مرتبطتين بأي تعديل من §36.2-14
نفسها** — الاثنتان اتصلحوا بالكامل:

1. **بَقّة test-cleanup حقيقية**: `cash-settlement-direction.spec.ts`'s `insertWorkCompletedOrder()`
   كانت بتقص `order_number` (VARCHAR(24)) من الآخر (`` `TESTCSD-${label}`.slice(0, 24) ``) — أي
   `label` طويل كان بياكل الـ`runId` نفسه بالكامل، يسيب `order_number` **ثابت** بين كل تشغيلة، فأي
   تشغيلة سابقة اتقطعت قبل `afterAll` (زي انقطاع jest hang) كانت بتسيب صف يصادم أي تشغيلة تالية.
   الإصلاح الكامل + تفاصيله في commit منفصل (`apps/api/src/modules/payments/cash-settlement-direction.spec.ts`).
2. **تلوّث بيئة حقيقي**: عدة عمليات `nest start --watch` متراكمة من سيشنز سابقة (بعضها شغال من
   إمبارح) كانت بتشغّل خلفية على نفس قاعدة بيانات التطوير المشتركة — الـcron/reconciliation jobs
   بتاعتها (زي `OrderChatRecoveryService`) كانت بتلقط طلبات اختبار حقيقية بالصدفة (`technician_id`
   معيّن + حالة مكتملة) وتنشئلها `chat_threads` في الخلفية، يعمل تصادم foreign-key عشوائي في cleanup
   أي اختبار تاني بيمسح `orders`. اتقفلت كل العمليات المتراكمة دي. **درس تشغيلي لأي سيشن جاية**: لو
   بدأت `npm run start:dev` لتحقق حي بـcurl، لازم تتأكد إنها اتقفلت فعليًا بعد كده (`ps aux | grep
   "nest start"`) — `fuser -k 3000/tcp` مايكفيش لوحده لو العملية respawned بعد compilation.

بعد الإصلاحين: `tsc --noEmit`/`nest build` في `apps/api` نضاف صفر أخطاء. `next build` في
`apps/admin` نضاف صفر أخطاء. جناح jest كامل (`--forceExit`): **128/129 suite، 726/729 اختبار** —
صفر ريجريشن (نفس فشل بذور "تسليك مواسير" غير المرتبط الموثّق من أول §36.9، أعيد التأكد منه مباشرة
كل مرة إنه مش جديد).

**فجوة موثّقة صراحة**: مفيش مصفوفة اختبار E2E حقيقية بمتصفح كاملة للـepic كله (§36.2-14 سوا) —
كل مرحلة اتحققت لوحدها حيًا (curl + build + jest، وبعضها browser-tested جزئيًا زي §36.9/§36.10).
اختبار E2E بمتصفح واحد يمرّ على كل مركز العمليات مرة واحدة (تدفق كامل: فتح `/operations` → فلترة
مصفوفة القوى العاملة → توسيع صف تغطية → معالجة استثناء → إعادة تعيين سريعة) خارج نطاق §36.14 —
مؤجَّل لمرحلة تحقق منفصلة لو اتطلب.

## بَقّة حقيقية اتلقطت بلقطة شاشة مالك — عمود "الطلب" فاضي في تبويب "تسليم الطلبات" (docs/08 §90)

`GET /admin/operations/dispatch-delivery`: `AdminDispatchDeliveryService` كانت بترجّع
`orderNumber`/`orderTechnicianCount` صح (تفاصيل §72 فوق)، والواجهة (`apps/admin`) وعقد الأنواع
المشتركة (`packages/shared-types`'s `DispatchDeliveryItemDto`) كانوا بيقروا/بيعلنوا
`order_number`/`order_technician_count` صح — لكن `AdminOperationsController.getDispatchDelivery()`
بيعمل mapping يدوي صريح لكل حقل من camelCase للـsnake_case (نفس نمط باقي endpoints مركز
العمليات)، **ونسي الحقلين دول بالذات**. النتيجة: الـJSON الفعلي كان بيوصل بلا `order_number`/
`order_technician_count` خالص، فعمود "الطلب" في الجدول كان بيبان فاضي (undefined) و"اتبعت لـ_
فني" من غير رقم — بالظبط زي ما ظهر في لقطة شاشة المالك.

**ليه اختبار §72 القديم ما مسكش البَقّة**: `admin-dispatch-delivery.spec.ts` بيتحقق من الخدمة
مباشرة (`service().getDeliveryObservability(...)`)، مش من الـcontroller — فأكّد إن الحساب صح
لكن ما لمسش طبقة التحويل لـJSON خالص، وهي بالظبط المكان اللي البَقّة كانت فيه.

**الإصلاح**: سطرين ناقصين في `admin-operations.controller.ts`'s mapping. اختبار حي جديد
`admin-operations.controller.spec.ts` على مستوى الـcontroller نفسه — اتأكد إنه بيمسك الرجعة
فعليًا (تجربة يدوية: رجّعت التعديل للخلف بـ`git stash`، الاختبار فشل بوضوح، رجّعت التعديل، عدّى).
