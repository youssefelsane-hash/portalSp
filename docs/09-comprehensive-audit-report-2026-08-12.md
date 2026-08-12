# 09 — تقرير المراجعة الشاملة (2026-08-12، فرع `hgotr7`)

**الطلب الأصلي من المالك (بالحرف تقريبًا)**: "إحنا حاليًا هنعمل مراجعة... مش عارف الحاجات اللي قلتها لك دي غلط
أو فيها أخطاء ولا لأ... شغلك دلوقتي إنك تراجع وتتشيك، عملية كاملة من أولها لآخرها: security، أداء، سهولة،
سرعة... ما تضيفش حاجة جديدة، شيك على القديم كله... أي غلطة تمر عليها اصلحها وخليها perfect."

هذا التقرير هو الرد الكامل على الطلب ده. **لخّص السطر ده**: الجدول اللي بعته المالك **صحيح بالكامل تقريبًا** —
مش قلق مبالغ فيه ولا سوء فهم. كل بند اتتحقق منه بقراءة الكود الفعلي (مش افتراض)، مع دليل `ملف:سطر`.
اتصلحت ثغرة أمنية حقيقية وبَقّة أداء حقيقية. الباقي فجوات تكامل موثّقة بدقة تحتاج قرار عمل من المالك
(تفصيل تحت "قرارات محتاجة توجيهك" آخر التقرير) — مش هتتصلح من غير ما تُبنى واجهات جديدة، وده برّه حدود
مهمة المراجعة دي بالتحديد ("ما تضيفش حاجة جديدة").

---

## جدول التحقق الكامل — كل بند من جدول المالك

| # | البند | الحكم | الدليل |
|---|-------|-------|--------|
| 1 | **Pricing Engine مش متصل بإنشاء الطلب** | ✅ **صحيح، وأخطر مما بدا** | `orders.service.ts` بيستدعي `catalogService.estimate()` القديم بس (سطر 106) — صفر استدعاء لـ`PricingEngineService`. **اكتشاف إضافي**: حتى `POST /services/:id/estimate` (المعاينة قبل الحجز) برضه بيستخدم المسار القديم — الانفصال كامل، مش بس في `orders.service.ts`. `PricingEngineService.evaluate()` بيتوصل بس عبر endpoint منفصل تمامًا (`POST /services/:id/evaluate-price`) محدش بينادي عليه من مسار الحجز. **لكن**: **مفيش أي خدمة حالياً `pricing_model='formula'`** في الكتالوج الحي (الخدمة التجريبية اتمسحت بعد الاختبار) — يعني الفجوة حقيقية معماريًا بس **صفر أثر فعلي على عميل حقيقي دلوقتي**. |
| 2 | **Scheduler مش متصل بالحجز** | ✅ صحيح | `TechnicianScheduleService.bookSlot()` (`technician-schedule.service.ts:77`) — `grep` لكل استدعاءاته في `apps/api/src` رجّع تعريفها بس، صفر caller حقيقي. `CreateOrderDto` مفيهوش `schedule_slot_id` خالص. |
| 3 | **اختيار الفني قبل الحجز — Customer App لا يستخدمه** | ✅ صحيح | `technicians_repository.dart` فيه `fetchPublicProfile()` و`listActiveCompanies()` بس — صفر استدعاء لـ`GET /services/:id/technicians` (endpoint البحث/الفلتر اللي اتبني في §3). |
| 4 | **بروفايل الفني العام — حقول ناقصة في الموبايل** | ✅ صحيح، **وأوسع من كده** | `TechnicianPublicProfile` (موديل Flutter) معندهوش `certificates`/`avgArrivalMinutes`/`avgCompletionMinutes` — الـ API بيرجّعهم، الموديل مش بيقرأهم. **اكتشاف إضافي**: الفجوة مش بس في العرض — `technician_certificates` (migration 0059) endpoints موجودة في الباك-إند للفني (يضيف شهادة) وللأدمن (يراجعها) بس **صفر استدعاء ليهم من `apps/technician-app` أو `apps/admin` خالص** (`grep` لـ`technician-certificates`/`TechnicianCertificate` رجّع تعريف الـcontrollers بس). يعني الميزة كلها ميتة على الطرفين (الفني مش يقدر يضيف شهادة، الأدمن مش يقدر يراجعها)، مش بس العميل مش شايفها. |
| 5 | **Reviews — بُعد النظافة + صور "بعد" مش مرسلين** | ✅ صحيح | `ratings_repository.dart`'s `rate()` بيبعت `overall_rating`+`comment` بس. `cleanliness_rating` و`after_photo_media_ids` مدعومين بالكامل في الـ API (migration 0063) بس مفيش UI/استدعاء ليهم. |
| 6 | **Teams/Assistant — مفيش UI في التطبيقين** | ✅ صحيح | `grep` لـ`order_team_members`/`team-members` في كل الموبايل — صفر نتيجة. |
| 7 | **Productivity Engine — منفصل عن إنشاء الطلب** | ✅ صحيح | `estimateDuration()` موجودة بس كـendpoint مستقل (`catalog.controller.ts`) — `orders.service.ts` مش بينادي عليها وقت الإنشاء. |
| 8 | **Warranty/Revisit — مفيش UI في Customer App** | ✅ صحيح | صفر نتيجة `grep` لـ`warranty`/`revisit`/`original_order_id` في `apps/customer-app`. |
| 9 | **Emergency — الشاشة تعرض السعر الثابت بس** | ✅ صحيح، **وأوسع من كده** | مش بس رسوم الطوارئ — `create_order_screen.dart` (سطر 160) بيعرض `basePriceCents` الثابت من الكتالوج بس، **صفر استدعاء لـ`POST /services/:id/estimate` خالص** قبل التأكيد. يعني كل معاينة السعر الديناميكي (سرچ، خصومات، رسوم طوارئ) غير مرئية للعميل قبل ما يضغط تأكيد — مش بس بند الطوارئ. |
| 10 | **Live Tracking** | ✅ تقريبًا صحيح (تقييم المالك نفسه) | البنية شغالة (Socket.IO)، محتاجة مفاتيح Google Maps حقيقية للإنتاج — موثّق في `docs/03-external-integrations.md`. |
| 11 | **Recurring Orders — مفيش UI** | ✅ صحيح | الباك-إند شغال ومختبر حي بالكامل (`recurring-orders.service.ts`)، صفر شاشة في `apps/customer-app`. |
| 12 | **Domestic Workers — مفيش تطبيق/شاشات** | ✅ صحيح | الموديول باك-إند كامل ومستقل (`domestic-workers/`)، صفر UI عميل أو عاملة. |
| 13 | **Buildings + QR — مفيش صفحة أدمن ولا ماسح QR** | ✅ صحيح | الباك-إند شغال (`admin/buildings`)، صفر صفحة في `apps/admin` وصفر ماسح/حقل كود عمارة في `apps/customer-app`. |
| 14 | **Referral — Reward code مش مقيد بصاحبه** | ✅ **صحيح — ثغرة أمنية حقيقية** | **اتصلحت في PR #44** (تفصيل تحت). |
| 15 | **Loyalty — مفيش Customer UI** | ✅ صحيح | صفر شاشة ولاء حقيقية في `apps/customer-app` (فقط تعليقات HTTP عامة غير متعلقة). |
| 16 | **Favorites — غير موجود خالص** | ✅ صحيح | `grep -rli favorite` على كل الباك-إند وكل الموبايل — **صفر نتيجة مطلقًا**، ولا حتى عمود راكد. |

**الخلاصة**: 16 من 16 بند في جدول المالك **صحيحين فعليًا**، بأدلة مباشرة من الكود. النمط المتكرر في كل حالة تقريبًا:
باك-إند مبني صح ومختبر حي في سيشنز سابقة، لكن تطبيقات Flutter (والأدمن في حالة العمائر) ما اتحدّثوش
ليستهلكوا القدرات الجديدة دي — يعني الميزة "خلصت" على مستوى الـ API بس **غير قابلة للاستخدام فعليًا من عميل حقيقي**.

---

## الإصلاحات اللي اتعملت فعليًا في المراجعة دي

### 1. ثغرة أمنية حقيقية — كود مكافأة الترشيح كان يقدر يستخدمه أي حد (PR #44، merged)

**المشكلة**: `ReferralsService.issueReward()` كانت بتصدر مكافأة الترشيح كـ`promo_code` عادي **بلا أي قيد فعلي
في الداتابيز** يمنع غير المُرشِّح من استخدامها. الحماية الوحيدة كانت "الكود بيتوصّل بس عبر إشعار خاص" —
يعني أي حد يعرف الكود (تسريب، سكرين شوت، مشاركة) كان يقدر يستخدمه فعليًا ويسرق قيمة مالية حقيقية
(150 جنيه افتراضيًا) مش بتاعته. كانت موثّقة صراحة كفجوة في تعليق قديم بالموديول، مش اكتشاف جديد —
بس مقفولة فعليًا دلوقتي.

**الإصلاح**:
- `promo_codes.restricted_to_user_id` عمود جديد (migration `0067`, nullable FK لـ`users`).
- `PromoCodesService.assertUsable()` (نقطة التحقق الوحيدة المشتركة بين `preview()` و`validateAndApply()`)
  بترفض `403` واضح ("كود الخصم ده مش بتاعك") لو الكود مقيَّد ومش نفس المستخدم.
- `issueReward()` بقى يمرّر `restricted_to_user_id` دايمًا. إعداد عام كمان للأدمن (أي كود عادي يقدر
  يتقيّد بمستخدم واحد لو احتاج).
- **اختبار حي كامل**: كود مقيَّد اتعمل لعميل معيّن، عميل تاني (مختلف فعليًا) حاول يستخدمه → اترفض
  `403` بوضوح. نفس الكود مع العميل الصح → نجح وحسب الخصم صح (5000 قرش من كود 50 جنيه).

تفاصيل كاملة: `apps/api/src/modules/referrals/README.md`.

### 2. بَقّة أداء حقيقية — N+1 في `GET /admin/buildings` (PR #45، merged)

**المشكلة**: `AdminBuildingsController.list()` كان بينادي `getCurrentMonthOrdersCount(b.id)` مرة منفصلة
لكل عمارة جوّه `Promise.all(buildings.map(...))` — استعلام `COUNT(*)` منفصل لكل عمارة بدل استعلام واحد
مجمّع. مش بَقّة وظيفية (النتيجة كانت صح) لكن غير كفء مع نمو عدد العمائر.

**الإصلاح**: `getCurrentMonthOrdersCountBulk(buildingIds)` جديدة — استعلام واحد بـ`GROUP BY building_id`
لكل الـ`IDs` دفعة واحدة. اتعمله اختبار حي: النتيجة طابقت `SELECT COUNT(*)` المباشر بالظبط.

تفاصيل كاملة: `apps/api/src/modules/buildings/README.md`.

---

## مراجعة أمان وأداء عامة (مش بس البنود اللي المالك ذكرها)

فحص شامل تاني عبر كل الباك-إند، بالذات الموديولات اللي اتبنت في السيشنز الأخيرة (buildings،
domestic-workers، recurring-orders، order-team، referrals):

| الفحص | النتيجة |
|-------|---------|
| **SQL Injection** — بحث عن raw queries بـstring interpolation (`` `...${var}...` ``) | ✅ نضيف — صفر نتيجة في كل `apps/api/src`. كل الـ raw queries بتستخدم parameterized placeholders (`$1`, `$2`...) وكل `createQueryBuilder` بيستخدم named params (`:code`). |
| **RBAC/Ownership** — كل controller فيه `@Roles`/`@Public`؟ كل عملية بتتفلتر بـ`userId` الحقيقي؟ | ✅ نضيف. الاستثناء الوحيد (`addresses.controller.ts` بلا `@Roles`) اتفحص وطلع **قرار متعمّد** — العناوين مشتركة بين نوعي مستخدم، محمية بـ`JwtAuthGuard` العام + فلترة `user.sub` داخليًا في كل عملية، مش ثغرة. باقي الموديولات الجديدة (buildings admin-only، domestic-workers، recurring-orders، order-team) كلها بتفلتر بملكية حقيقية (`customerId`/`workerId` مشتقّين من التوكن، مش من الـbody). |
| **Hardcoded secrets** | ✅ نضيف — صفر نتيجة (تحذير كاذب واحد كان قيمة enum `RESET_PASSWORD`، مش سر). |
| **Rate limiting على endpoints جديدة** | ✅ نضيف — `ThrottlerGuard` عام (`60`/دقيقة) مطبّق على مستوى التطبيق كله عبر `APP_GUARD`، صفر `@SkipThrottle` في أي مكان. `OTP request` له حد أضيق مخصص (`5`/دقيقة) من قبل. |
| **Indexes ناقصة في migrations 0059-0067** | ✅ نضيف — كل عمود بيتفلتر عليه في `WHERE`/`JOIN` (foreign keys، partial indexes لـ sweep queries) له index مخصص، شامل الـpartial indexes الذكية (`idx_recurring_order_templates_due`, `idx_domestic_worker_bookings_renewal_due`). |
| **كفاءة الـ3 خدمات sweep (`setInterval`)** | ✅ نضيف — `OrderAutoCancelService`، `RecurringOrdersService`، `DomesticWorkerBookingsService` كلهم بيستخدموا الـpartial indexes المخصصة، مفيش full table scan. |
| **اكتمال الـDTO validation** | ✅ نضيف — عيّنة من DTOs الموديولات الجديدة (buildings، domestic-workers، recurring-orders) كلها فيها حدود صريحة (`@Min`/`@Max`/`@MaxLength`/`@IsEnum`) — صفر حقل بلا تحقق. `ValidationPipe` العام (`whitelist:true, forbidNonWhitelisted:true`) بيرفض أي حقل زيادة غير متوقع تلقائيًا. |

**النتيجة**: مفيش أي ثغرة أمنية أو بَقّة أداء إضافية اتكتشفت غير الاتنين اللي فوق واتصلحوا فعليًا.

---

## قرارات محتاجة توجيهك (مش هتتصلح من غير إذن صريح — برّه حدود "ما تضيفش حاجة جديدة")

الاتنين دول أهم فجوتين في الجدول (Pricing Engine و Scheduler)، وقررت **ما ألمسهمش** في المراجعة دي
رغم إنهم "الأخطر" في وصف حضرتك — والسبب واحد في الحالتين: **الإصلاح الحقيقي محتاج إضافة حقل جديد
لعقد الـAPI** (`field_values` لتقييم صيغة السعر، `schedule_slot_id` لحجز السلوت) **ومحتاج واجهة Flutter
جديدة تجمع القيمة دي من العميل فعليًا** — وكلاهما "إضافة جديدة" بالتعريف، مش "إصلاح قديم"، وطلب حضرتك
كان صريح إنها برّه نطاق المراجعة دي. لو وصلت الباك-إند بمعزل عن واجهة تجمع البيانات، هيكون كود ميت
مفيش حد بينادي عليه فعليًا — زيه زي كل الفجوات التانية في الجدول.

**ملاحظة مطمئنة**: التأثير الفعلي لغياب الربط ده صفر دلوقتي — مفيش أي خدمة `pricing_model='formula'`
في الكتالوج الحي، وSchedulerمفيش سلوتات محجوزة عليه فعليًا من عميل حقيقي. يعني مفيش عميل حالي بيتضرر
من الفجوة دي، هي فجوة "جاهزية مستقبلية" مش بَقّة تشغيلية نشطة.

**توصيتي للأولوية القادمة** (لحضرتك تقرر، مش قرار نفّذته):
1. **Pricing Engine wiring** — أعلى قيمة، أقل تعقيد نسبيًا (endpoint واحد جديد يستقبل `field_values`،
   شاشة فورم ديناميكي واحدة في customer-app تقرا `GET /services/:id/pricing-fields` وترسمها).
2. **Scheduler wiring** — محتاج Calendar UI كامل في customer-app، أعقد شغل frontend.
3. باقي البنود (Teams UI، Recurring UI، Buildings admin page، Domestic Workers apps، Loyalty UI،
   Favorites من الصفر) — كل واحد فيهم منتج/شاشة مستقلة، تقييمها وترتيبها محتاج قرارك.

---

## الخلاصة

المشروع دلوقتي "ماسك نفسه نظيف وجامد" على مستوى الباك-إند: صفر ثغرة أمنية مفتوحة معروفة، صفر بَقّة
أداء معروفة، الفحوصات الثلاثة (`tsc`/`nest build`/`jest`) عدّية نضيفة، كل الإصلاحات اتعملها اختبار حي
حقيقي ضد Postgres/Redis حقيقيين مش mocks. الفجوة الحقيقية الوحيدة المتبقية هي **فجوة تكامل frontend**
موثّقة بدقة الآن في الجدول فوق — مش أخطاء في الكود القديم، بس ميزات باك-إند "خلصت" من غير واجهة تستهلكها.

مرجع كامل لكل قرار: `docs/08-pricing-engine-and-platform-vision.md`، `docs/adr/`، وREADME كل موديول
مذكور فوق.
