# ADR-0030: سياسة إظهار المرشّحين المتعارضين جدوليًا (Schedule-Conflict Visibility) + إصلاح فجوة تعارض حجز الشغالة

**الحالة:** معتمد ومنفّذ بالكامل (Slice A/B/C/D) — الشرائح الأربعة كلها مغطّاة بالتفصيل تحت
**التاريخ:** 2026-08-21

## السياق

طلب مالك جديد (2026-08-21، جوّه شغل A.4 نفسه): لبعض الخدمات، فني/مقدّم خدمة (شغالة/مربية) متعارض
جدوليًا مع الموعد المطلوب **ميختفيش من قايمة الاختيار خالص** — يفضل ظاهر بحالة "مش متاح للفترة دي"
واضحة (badge/تعتيم/إلخ)، مع معلومات زي "متاح تاني إمتى" وطريقة سهلة يحجزه بيها في الفترة دي بدلاً.
لخدمات تانية (سباكة، طوارئ)، السلوك الحالي (المتعارض يختفي تمامًا) يفضل زي ما هو. المالك صريح: قرار
قابل للتهيئة (على مستوى الخدمة، أو الفئة بافتراضي + استثناء على مستوى الخدمة لو الهيكل الحالي بيدعم
ده أحسن)، مش سلوك عام إجباري.

**الفرق الجوهري المطلوب الحفاظ عليه**: تلات حالات مختلفة تمامًا، مش اتنين:
1. **مؤهّل ومتاح فعلاً للفترة المطلوبة** — يظهر عادي، قابل للاختيار.
2. **مؤهّل بس متعارض جدوليًا للفترة المطلوبة** — القرار الجديد بيتحكم هل ده يظهر (بحالة واضحة) ولا لأ.
3. **غير مؤهّل أصلاً / معطّل / محظور** — ميظهرش أبدًا، بغض النظر عن القرار ده (خارج نطاق القرار تمامًا).

**تدقيق حي (Explore agent، أدلة ملف:سطر) قبل أي كود** — قبل ما نصمم أي حاجة، فحصنا كل اللي موجود
فعلاً في الأهلية/الجدولة/تصفح الفنيين، عشان نبني فوقه مش جنبه:

1. **`TechniciansService.listForServiceBooking()`** (`GET /services/:id/technicians`، صُنّاع) —
   استعلام SQL واحد، مرحلتين: أهلية صارمة (`WHERE` فيها `technicianAvailabilityCondition()`) ثم
   ترتيب Bayesian. فني متعارض جدوليًا **بيختفي من النتيجة تمامًا اليوم** — مفيش "دلو تاني" بيتحسب
   له أصلاً في نفس الاستعلام.
2. **`technicianAvailabilityCondition()`** — التعارض بين الطلبات بيتحسب **بمستوى اليوم بس** (قرار
   متعمّد، ADR-0018 §2: "الجدولة باليوم مش بالساعة")، مش نطاق ساعات حقيقي. الاستثناء الوحيد اللي
   فيه دقة ساعة حقيقية هو صفوف `blocked` الذاتية (`technician_schedule_slots`)، مش تعارض طلبات فعلي.
3. **`classifyTechnicianCapacity()`/`describeTechnicianCapacity()`** (`technician-eligibility.sql.ts`،
   docs/08 §34.4، ADR-0020 §W) — **أقرب حاجة جاهزة فعلاً لنص السبب المطلوب**: بترجع تصنيف
   (BLOCKED/HEAVY/MEANINGFUL/LIGHT) + سبب مقروء بالعربي + `occupiedFrom`/`occupiedTo` (نطاق تاريخ
   الشغل الشاغل). حاليًا استخدامها تشخيصي للأدمن بس (docs/08 §34.4). **مفيش دالة موجودة بترجع
   "الفني ده متاح تاني إمتى"** (المتاح: "هل أي فني متاح اليوم ده؟" عبر `hasEligibleTechnicianForDate()`،
   عكس "الفني ده تحديدًا متاح إمتى؟" المطلوب هنا).
4. **حجز الشغالة (`domestic_worker_bookings` القديم + مسار الطلبات الموحّد الجديد، ADR-0029 Slice 2a)**
   — **اكتشاف حرج**: **صفر فحص تعارض جدولي من أي نوع، في أي مسار، دلوقتي**. `DomesticWorkerBookingsService.create()`
   (`domestic-worker-bookings.service.ts:66-117`) بيحسب السعر ويسجّل الحجز بلا أي استعلام على حجوزات
   الفني (الشغالة) الموجودة أصلاً — عميلين يقدروا يحجزوا نفس الشغالة لنفس الساعة بالظبط بلا أي رفض.
   نفس الفجوة بالظبط في فرع `OrdersService.create()` الجديد (ADR-0029 Slice 2a، اتضاف هالجلسة نفسها) —
   **ده مش مجرد فجوة UX، ده بَقّة صحة بيانات حقيقية** لازم تتصلح بغض النظر عن ميزة الإظهار الجديدة.
5. **`ServiceCategory` entity** — **صفر علم قدرة من أي نوع عليها اليوم** (تدقيق شامل، صفر نتيجة).
   كل الأعلام السبعة الموجودة (`allowsIndividual`/`allowsTeam`/`allowsScheduling`/`allowsEmergency`/
   `cashAllowed`/`depositRequired`/`allowsDateRangeBooking`) على `Service` بس، صفر آلية "افتراضي
   فئة + استثناء خدمة" موجودة في أي مكان بالمشروع. "فئة بافتراضي + استثناء خدمة" هتبقى **بنية جديدة
   بالكامل**، مش إعادة استخدام نمط موجود.
6. **دقة الوقت**: `orders.scheduled_at` يوم بس بالتصميم (ADR-0018). `domestic_worker_bookings.scheduled_at`
   + `duration_hours` **دقة ساعة حقيقية موجودة من ADR-0004 الأصلي** — مش طلب جديد، موجودة بالفعل.
   بس **مسار الطلبات الموحّد الجديد (ADR-0029 Slice 2a) ما بيسجّلش `duration_hours` خالص على
   `Order`** (بيتحسب للسعر وبس، بيتفقد) — فجوة إضافية لازم تتقفل عشان فحص التعارض يشتغل صح على
   المسارين.

## القرار

### القرار المعماري الأساسي: العلم على `Service` بس، مش `ServiceCategory`

**رُفض "فئة بافتراضي + استثناء خدمة"** — التدقيق أثبت صفر سابقة لده في المشروع كله (بند 5 فوق).
إضافة طبقة معمارية جديدة بالكامل (حل تعارض فئة/خدمة) لعلم واحد جديد مخالف لقاعدة "زيرو بنية جديدة
لما الموجود كافي" — كل الأعلام السبعة الموجودة بتثبت إن مستوى الخدمة كافي عمليًا (الأدمن بيظبط كل
خدمة على حدة أصلاً، مفيش شكوى موثّقة إن ده متعب). لو الحاجة دي فعلاً بقت مطلوبة مستقبلاً لعدد كبير
من الأعلام (10+)، وقتها تستاهل تصميم مستقل — مش لعلم واحد.

**`services.show_unavailable_providers`** (`boolean NOT NULL DEFAULT false`) — نفس نمط
`cash_allowed`/`deposit_required`/`allows_date_range_booking` بالحرف. **الافتراضي `false` متعمّد**
(زي `deposit_required`، مش `cash_allowed`): ده سلوك جديد كليًا، مفيش خدمة موجودة النهاردة بتعرض
مرشّحين متعارضين — الافتراضي `false` يعني صفر تغيير سلوك لأي خدمة موجودة، والأدمن يفعّلها صراحة
لخدمات "شغالة/مربية/تنظيف بالساعة" ونحوها.

### الفحص الأهم أولاً: إصلاح فجوة تعارض حجز الشغالة (Slice A، منفّذ هنا) — قرار مستقل عن الإظهار

بغض النظر عن قرار الإظهار، **صفر فحص تعارض حاليًا لحجز الشغالة معناه المنصة بتسمح بتحصيل ازدواجي
حقيقي فعليًا** (شغالة واحدة تتحجز مرتين لنفس الوقت). الإصلاح ده **مستقل تمامًا عن ميزة الإظهار**
ولازم يتقفل أولاً — إظهار "متعارض" بلا فحص تعارض حقيقي أصلاً معناه معلومة مصطنعة، مش حقيقية.

- **`DomesticWorkersService.assertNoSchedulingConflict()`** جديدة — بتفحص **المسارين** (القديم
  `domestic_worker_bookings` + الجديد `orders.domestic_worker_profile_id`) عن أي حجز نشط (مش
  `cancelled`/`completed`) بيتقاطع زمنيًا مع `[startsAt, startsAt + durationHours)` المطلوب:
  - حجز `hourly` (قديم أو جديد) بمداه الحقيقي (`scheduledAt` → `scheduledAt + durationHours`).
  - حجز `monthly_live_in` نشط (قديم بس — الجديد مؤجّل لـSlice 4 من ADR-0029) بيُعتبر شاغل **كل**
    وقت الشغالة طول مدته (`scheduledAt` → `currentPeriodEndAt`/`pendingPeriodEndAt`، أو مفتوح لو
    الاتنين null) — شغالة مقيمة مينفعش تاخد شغلانة بالساعة في نفس الوقت.
  - بيترمي `VAL_001` برسالة واضحة (فيها رقم الحجز/الطلب المتعارض) لو لقى تقاطع.
- **مطبَّقة على المسارين**: `DomesticWorkerBookingsService.create()` (القديم) **و**
  `OrdersService.create()`'s فرع الشغالة (ADR-0029 Slice 2a، الجديد) — نفس الدالة، صفر منطق مكرر.
- **`orders.domestic_worker_duration_hours` عمود جديد** (nullable smallint، migration 0167) — كان
  ناقص من Slice 2a (اتحسب للسعر وبس، اتفقد). لازم يتسجّل عشان فحص التعارض (وأي عرض "الحجز ده من
  الساعة كذا للساعة كذا" مستقبلي) يشتغل صح على المسار الجديد.

### باقي الشرائح

- **Slice B (خلصت)**: `TechniciansService.listForServiceBooking()` بقت بترجّع **دلوين** لما
  `service.showUnavailableProviders=true` و`scheduledAt` موجودة: مؤهّل+متاح (زي دلوقتي بالحرف) +
  مؤهّل+متعارض (`findScheduleConflictedTechnicians()` جديدة، نفس بوابة الأهلية الصارمة، بس بشرط
  `technicianScheduleConflictCondition()` الجديد بدل `technicianAvailabilityCondition()`)، بيستخدم
  `describeTechnicianCapacity()` الموجودة للسبب+النطاق المشغول لكل مرشّح متعارض، و
  `findNextAvailableDateForTechnician()` الجديدة لـ"متاح تاني إمتى" (تلف حوالين
  `hasEligibleTechnicianForDate()` الموسّعة بفلتر فني اختياري — نفس نمط A.2 بس لفني واحد بدل "أي
  فني"، بحد أقصى 14 يوم). **`technician-eligibility.sql.ts` اتعمله refactor** عشان منطق التعارض
  يتشارك بين الدالتين بدل نسخة منفصلة (تفاصيل + بَقّة حقيقية اتلقطت أثناء الـrefactor في
  `apps/api/src/modules/technicians/README.md`). اختبار حي (3/3).
- **Slice C**: `DomesticWorkersService.browseForCustomer()` — نفس الفكرة، بس المحرك كله لازم
  يتبني من الصفر (صفر تعارض موجود أصلاً قبل Slice A هنا). `BrowseWorkersQueryDto` محتاجة
  `scheduled_at`/`duration_hours` اختياريين (مش موجودين خالص دلوقتي).
  الوقت هنا دقيق (ساعة، مش يوم) — الاستعلام يعتمد على `assertNoSchedulingConflict()`'s نفس منطق
  التقاطع الزمني، مش `technicianAvailabilityCondition()` (خاص بالفنيين/اليوم).
- **Slice D**: واجهة Flutter — كارت "مش متاح للفترة دي" (badge/تعتيم، صفر سابقة UI موجودة لحالة
  "معروض بس مش قابل للاختيار" في التطبيق — أقرب حاجة موجودة هي إخفاء السلوتات المحجوزة بالكامل من
  `TechnicianProfileScreen`، عكس المطلوب هنا)، + عرض "متاح تاني إمتى" + مسار "احجزه في الفترة دي
  بدلاً" (يعيد استخدام شاشة اختيار الموعد الموجودة، بقيمة افتراضية = تاريخ التوافر الجاي).

## البدائل اللي اتقيّمت

- **"فئة بافتراضي + استثناء خدمة"** — رُفض (تفاصيل فوق، بند "القرار المعماري الأساسي").
- **enum ثلاثي (`hide`/`show_disabled`/`show_prioritized`) بدل boolean** — رُفض دلوقتي. المالك
  طلب سلوكين بس فعليًا ("يختفي" أو "يظهر بحالة واضحة")؛ زيادة enum لتدرّجات عرض إضافية (زي "يظهر
  فوق القايمة العادية") قرار UX منفصل مؤجَّل لحد ما يتطلب فعليًا — نفس فلسفة `cash_allowed` boolean
  بدل `payment_policy` enum من ADR-0026.
- **بناء فحص التعارض جوّه الاستعلام SQL مباشرة (زي `technicianAvailabilityCondition()`) بدل دالة
  TS منفصلة** — رُفض لحجز الشغالة تحديدًا. الفني بيتفحص وقت المطابقة (مرات كتير، أداء حرج)،
  الشغالة بتتفحص مرة واحدة بس وقت إنشاء حجز (زيرو مطابقة تلقائية، ADR-0004) — دالة TS واضحة أسهل
  قراءة وصيانة من SQL معقّد لسيناريو منخفض التكرار، وبتشتغل على مسارين (قديم/جديد) بمصدر واحد.
- **تأجيل إصلاح فجوة التعارض لحد ما ميزة الإظهار تتبني بالكامل** — رُفض بشدة. الفجوة دي بَقّة صحة
  بيانات مستقلة (تحصيل ازدواجي محتمل)، صفر علاقة بقرار "يظهر ولا لأ" — تأجيلها كان معناه سيب
  بَقّة معروفة نشتغل عليها وإحنا شايفينها، عكس "وثّق الفجوات بصراحة، متسيبهاش لو لقيتها".

## الأثر (Slice A، منفّذ في الـcommit ده)

- Migration جديدة (0167): `services.show_unavailable_providers` (افتراضي `false`) +
  `orders.domestic_worker_duration_hours` (nullable) — صفر كسر لأي خدمة/طلب موجود.
- `DomesticWorkersService.assertNoSchedulingConflict()` جديدة — مطبَّقة على المسارين (القديم
  والجديد). أي حجز/طلب شغالة جديد بيتعارض زمنيًا مع حجز نشط موجود يترفض `VAL_001` بوضوح.
- `OrdersService.create()`: `domesticWorkerDurationHours` بقت متسجّلة على الطلب + فحص التعارض
  جديد قبل الإنشاء.
- اختبار حي جديد: تعارض hourly-vs-hourly (نفس الفترة، جزئي)، hourly-vs-active-monthly، ومسار جديد
  (unified orders) بيتفحص ضد حجز قديم (`domestic_worker_bookings`) والعكس — تأكيد إن الفحص شغال
  عبر المسارين مش مسار واحد بس.
- **خارج نطاق Slice A عمدًا**: `show_unavailable_providers` مُضاف بالـschema بس **صفر قراءة له
  في أي استعلام لسه** (Slice B/C)، صفر واجهة Flutter (Slice D).

## الأثر (Slice B، منفّذ في الـcommit ده)

- `technician-eligibility.sql.ts`: `technicianAvailabilityCondition()` اتعمله refactor (منطق
  التعارض اتفصل لدالة داخلية مشتركة `activeOrderConflictExistsExpr()` + `blockedExistsExpr()`) +
  `technicianScheduleConflictCondition()` جديدة تركّب من نفس الدوال — صفر تكرار منطق.
- `TechniciansService`: `hasEligibleTechnicianForDate()` بقت بتاخد `technicianId` اختياري +
  `findNextAvailableDateForTechnician()` جديدة + `findScheduleConflictedTechnicians()` جديدة
  (private) + `listForServiceBooking()` بترجّع الدلو الإضافي لما الشرط يتحقق.
- `TechnicianBookingListItem`/`GET /services/:id/technicians`: حقول `availability_status`/
  `unavailable_reason_ar`/`available_again_at` جديدة (`'available'` دايمًا للصفوف القديمة).
- اختبار حي جديد: `schedule-conflict-visibility.spec.ts` (3/3) + تحقق صفر رجريشن على
  `matching`/`technicians` بالكامل (152/155، نفس الفشلات المعروفة قبل وبعد بالحرف).
- **خارج نطاق Slice B عمدًا**: تصفح الشغالة (Slice C)، واجهة Flutter (Slice D).

## الأثر (Slice C، منفّذ في الـcommit ده)

- `DomesticWorkersService`: `assertNoSchedulingConflict()` اتفكّت لدالة داخلية مشتركة
  `findSchedulingConflict()` (بترجّع النتيجة بدل ما ترمي — `{conflicting, busyUntil, sourceLabel}`)،
  صفر تكرار منطق بين مسار الاعتراض عند الإنشاء ومسار التصفّح الجديد.
- `browseForCustomer()` بقت بتاخد باراميتر رابع اختياري `scheduling?: {serviceId, scheduledAt,
  durationHours}`. **بدون `scheduledAt`**: نفس السلوك القديم بالحرف (صفر تغيير). **مع `scheduledAt`**:
  كل مرشّح بيتفحص تعارضه الحقيقي (نفس منطق `findSchedulingConflict`، دقة ساعة)؛ المتعارض بيتشال من
  النتيجة تلقائيًا، إلا لو `serviceId` بيرجّع لخدمة `show_unavailable_providers=true` — وقتها بيترجع
  في آخر القايمة بحالة `schedule_conflicted` + سبب + `availableAgainAt` (بحث يومي 14 يوم، نفس حد
  Slice B، مقصور على أول 10 متعارضين لتفادي توسّع البحث).
- **قرار التصميم المفتوح اللي اتحل**: `browseForCustomer()` أصلاً مش مربوطة بخدمة كتالوج واحدة
  (تصفّح بتخصص `DomesticWorkerSpecialty`، مش `service_id`) — عكس الفني اللي بيتصفّح دايمًا جوّه
  `GET /services/:id/technicians`. الحل: `service_id` بقى باراميتر **اختياري** في `BrowseWorkersQueryDto`؛
  لو العميل لسه مختارش خدمة كتالوج بعينها (تصفّح استكشافي)، الافتراضي الآمن هو الإخفاء الكامل
  (زي قيمة الفلاج الافتراضية `false`) — صفر معلومة مصطنعة بلا سياق خدمة معروف.
  `serviceShowsUnavailableProviders()` جديدة (private) بتقرأ العلم بـSQL خام (بدون استيراد
  `CatalogModule` — نفس نمط قراءة `users.full_name` الموجود في الملف ده أصلاً، تفاديًا لأي تبعية
  دائرية بين الموديولين).
- `BrowseWorkersQueryDto`: `service_id`/`scheduled_at`/`duration_hours` اختياريين جداد.
- `PublicWorkerListItem`/`PublicWorkerResponseDto`: `availability_status`/`unavailable_reason_ar`/
  `available_again_at` — مطابقة بالاسم لحقول `TechnicianBookingListItem` المكافئة (Slice B)، للاتساق
  المعماري بين مساري التصفّح.
- **خارج نطاق Slice C عمدًا**: واجهة Flutter (Slice D). اختبار حي مؤجَّل لدفعة الاختبار النهائية
  الشاملة (طلب صريح من المالك 2026-08-21: "متعملش تستات غير في الآخر خالص").

## الأثر (Slice D، منفّذ في الـcommit ده)

- `apps/customer-app/lib/features/technicians/models.dart`: `TechnicianBookingListItem` بقت
  فيها `availabilityStatus`/`unavailableReasonAr`/`availableAgainAt` (افتراضي `'available'`/
  `null`/`null`، صفر كسر لأي بناء قديم).
- `technician_marketplace_screen.dart`: كارت الفني المتعارض بيتعتّم + شارة "مش متاح للفترة دي" +
  سبب، وزرار "جرّب <تاريخ>" بدل "اختار" لو `availableAgainAt` معروف. `_effectiveRequestedAt` state
  جديدة تسمح بإعادة تحميل القايمة بتاريخ مختلف محليًا (بلا شاشة/فلو جديد) — بانر أعلى الشاشة يوضّح
  التبديل مع رجوع للأصلي. `TechnicianOrCompanySelected` typedef بقى بثلات باراميترات
  (`id, isCompany, effectiveRequestedAt`) — الاختيار بعد التبديل بيوصّل `CreateOrderScreen` بالتاريخ
  الصحيح (`technician_selection_screen.dart`'s `_confirmSelection()` اتحدّثت لتاخده).
- `apps/customer-app/lib/features/domestic_workers/`: `PublicWorker` نفس الحقول الثلاثة.
  `DomesticWorkersScreen` بقى فيها `InputChip` اختياري "حدد الميعاد" — لو اتحدد، `scheduled_at`
  بيتبعت لـ`GET /domestic-workers` فيفلتر المتعارضين تلقائيًا (إصلاح فجوة حقيقية كانت موجودة
  فعليًا: صفر فحص تعارض في مسار التصفّح ده قبل الشريحة دي خالص).
- **قرار مقصود، موثّق مش سهو**: تصفّح الشغالة (`DomesticWorkersScreen`) بيتفتح من زرار عام في
  `home_screen.dart` بصفر خطوة اختيار خدمة كتالوج قبله — فمفيش `service_id` في السياق أصلاً. الشغالة
  المتعارضة بتتفلتر (الإخفاء) دايمًا هنا بدل عرض `schedule_conflicted` — تفعيل العرض الكامل زي
  الفني محتاج مرحلة اختيار خدمة كتالوج تتضاف الأول لمسار التصفّح، تغيير UX أكبر من الشريحة دي،
  مؤجّل عمدًا وموثّق كفجوة صريحة (مش نص ميت — الحقول والـmodel جاهزين، البيانات هتتفعّل تلقائيًا
  لو/لما `service_id` يتضاف للـquery مستقبلاً).
- **قيد صريح**: مفيش Flutter SDK متاح في بيئة السيشن دي وقت الشريحة دي (مختلف عن قيود سابقة كان
  فيها SDK موجود بس بلا جهاز/emulator) — مراجعة يدوية دقيقة (توازن الأقواس، الأنواع، كل نقاط
  النداء) بدل `flutter analyze`/build فعلي، موثّق بصراحة في `apps/customer-app/README.md`.
