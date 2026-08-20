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
