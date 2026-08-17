# modules/matching

توزيع الطلب على الفنيين على دفعات (أقرب 5 → 10 ثواني → الدفعة التالية). يقرأ من order_assignments (قاموس §6.6).

**الحالة: شغال (S4).**

- `MatchingService.dispatchNextRound()`: بيلاقي أقرب 5 فنيين مؤهلين (خدمة + نطاق + متاح + على وردية + معتمد) عبر استعلام PostGIS حقيقي (`ST_Distance` على `geography`), وبيبعتلهم دفعة جديدة. بيتصل بيها أوتوماتيك لحظة إنشاء الطلب (حدث `order.created` من `orders`, بره الـ transaction عشان matching يشتغل على بيانات مؤكّدة بس)، وكمان لما جولة تفشل بالكامل (كل الفنيين رفضوا) — لو مفيش فنيين متاحين خالص (أول جولة أو آخر جولة) الطلب بيتلغي أوتوماتيك (`cancelled_by_system`, سبب `ORDR_002`).
- **ترتيب بأولوية المستوى**: الاستعلام بقى `ORDER BY order_priority_weight DESC, distance_km ASC` — فني مستوى أعلى (`technician_level_config.order_priority_weight`, من `../technicians/README.md`) بياخد أولوية جوّه دائرة الفنيين المؤهلين حتى لو أبعد شوية، إضافة على المسافة مش بديل عنها. اتأكد حياً على قاعدة بيانات فعلية: فني `premium` (وزن 30) على بعد 0.735 كم اتقدّم على فني `professional` (وزن 20) على بعد 0.147 كم بس.
- `MatchingService.accept()`: **أول واحد يقبل ياخده** — يقفل مورد الفني المشترك أولًا ثم صف الطلب داخل transaction واحدة، ويعيد فحص الحالة والأهلية تحت القفل. لذلك قبول فنيين لنفس الطلب، أو قبول نفس الفني لطلبين مختلفين، ينتج فائزًا واحدًا فقط. الانتقالان (`searching_technician→technician_assigned→accepted`)، مؤشر `orders.technician_id`، العرض المقبول، وإلغاء بقية العروض كلها تلتزم ذريًا.
- **أهلية موحّدة**: `TechnicianAssignmentGuardService` هي مصدر واحد لقبول الفني وإعادة تعيين الأدمن: اعتماد، توافر/وردية، موقع، خدمة، نطاق، إعداد وحد قرار المستوى، عدم وجود طلب نشط، وعدم تعارض الموعد. الأدمن لا يتجاوز هذه القواعد ضمن endpoint إعادة التعيين. `NULL` في حد القرار يعني بلا حد، لكن غياب إعداد المستوى نفسه يرفض التعيين بدل اعتباره بلا حد.
- **دفاع قاعدة البيانات**: migration `0118_assignment_schedule_concurrency.sql` تضيف unique index جزئيًا يمنع أي writer من ربط فني واحد بأكثر من طلب نشط، حتى لو تجاوز خدمة المطابقة. اختبار PostgreSQL يغطي `accept × accept` لطلب واحد، نفس الفني × طلبين، و`accept × admin reassign` مع تطابق مؤشر الطلب والعرض النهائي.
- `MatchingService.reject()`: بيسجّل الرفض، ولو كانت آخر عرض معلّق على الطلب بيبعت الجولة الجاية أوتوماتيك.
- `GET /technician/orders/available`, `POST /technician/orders/:id/accept`, `POST /technician/orders/:id/reject` — endpoints الفني.
- **اتعمله اختبار حقيقي لأخطر شرط قبول في السبرنت** ("100 طلب متزامن من غير تعيين مزدوج"): 5 فنيين حقيقيين بعتولهم عرض نفس الطلب، اتنادى عليهم يقبلوا **بالتوازي فعلياً** (background curl processes) — واحد بس فاز (HTTP 201)، الباقي اتاخد بأمان (HTTP 409 / `ORDR_003`)، مفيش تعيين مزدوج. كمان اتعمله اختبار لمسار "الكل رفض" واتلقط فيه bug حقيقي (الطلب كان بيفضل عالق في `searching_technician` لو الرفض حصل في جولة تانية مش الأولى) واتصلح وقتها فوراً قبل الـ commit.

## بَقّة حقيقية أعمق — فني كان يقدر ياخد أكتر من طلب نشط في نفس الوقت

اتلقطت وقت بناء ميزة تانية تماماً (خرائط/ملاحة `apps/technician-app` — راجع `../orders/README.md`)، مش وقت اختبار matching نفسه. `findEligibleTechnicians()` (الاستعلام اللي `dispatchNextRound()` بيستخدمه) كان بيفلتر بس على `is_available`/`is_on_duty`/الخدمة/النطاق — **من غير ما يستبعد فني عنده أصلاً طلب نشط** (`accepted`/`technician_on_way`/`technician_arrived`/`in_progress`/`awaiting_quote_approval`). الحالة الأخيرة جزء من نفس الشغل الجاري: تدخل مباشرة من `in_progress` وتعود لها بعد قرار العميل، فلا تحرر المورد. يعني نفس الفني ممكن يتعرض عليه ويقبل طلبين (أو أكتر) نشطين في نفس الوقت، رغم إن `order-tracking.gateway.ts` و`GET /technician/orders/active` (`orders.service.ts`) الاتنين بيفترضوا ضمنياً (`findOne` مش `find`) إن الفني عنده طلب نشط واحد بس — الافتراض ده كان موثّق صراحة كتعليق في `order-state-machine.ts` (`ACTIVE_TECHNICIAN_ORDER_STATUSES`) من زمان، بس مفيش حاجة كانت بتفرضه فعلياً وقت التعيين.

**اتأكدت البَقّة حياً بشكل قاطع**: فني حقيقي واحد قَبِل 4 طلبات "accepted" متزامنة فعلياً (نتيجة تراكم اختبارات حية سابقة في نفس الجلسة من غير تنظيف كامل). النتيجة العملية: بث موقع الفني اللحظي (`technician:location` عبر `OrderTrackingGateway`) كان بيوصل لغرفة **طلب عشوائي** (أقدم طلب نشط بترتيب `findOne` الافتراضي، مش بالضرورة الطلب اللي العميل بيتابعه فعلياً) — عميل واحد فتح شاشة التتبع واستنى تحديث الموقع ومكانش هيوصله أبداً. اتأكدت البَقّة أول بسكريبت Node.js خام (`socket.io-client` مباشر، بدون Flutter) قبل ما نلاقيها في اختبار Dart حي (`apps/customer-app/test_live/order_tracking_live_test.dart`) بيفشل بـ timeout.

**الإصلاح على مستويين (دفاع مزدوج)**:
1. `findEligibleTechnicians()` بقى بيستبعد أي فني عنده طلب في `ACTIVE_TECHNICIAN_ORDER_STATUSES` بالفعل (`AND tp.id NOT IN (SELECT technician_id FROM orders WHERE technician_id IS NOT NULL AND order_status = ANY($6::order_status[]))`) — نفس مصدر الحقيقة الوحيد المستخدم في `order-state-machine.ts`. هنا هو الإصلاح الأساسي اللي بيمنع المشكلة من الأساس (فني مشغول مبيتعرضش عليه طلب جديد خالص).
2. `accept()` بقى فيه فحص دفاعي إضافي جوّه نفس الـ transaction (بعد قفل الطلب، قبل أي تعديل) — بيرفض `ORDR_003` واضح لو الفني عنده طلب نشط بالفعل. ده بيغطي حالات مش مغطّاة بالفلترة فوق (تعيين يدوي من الأدمن عبر `admin-orders.service.ts` `reassign()`، أو سباق نظري بين جولتين توزيع مختلفتين قبل ما أي حد يتقفل).

**اتأكد الإصلاح حياً بالكامل**: (أ) نفس سكريبت Node.js الخام اللي كشف البَقّة اتأكد إنه بقى بيستقبل تحديث الموقع في الغرفة الصح فوراً؛ (ب) فني عنده طلب نشط اتأكد إن `GET /technician/orders/available` بيرجّع قائمة فاضية له (مش بيتعرض عليه أي طلب جديد)، والطلب الجديد اللي محدش قدر ياخده اتلغى أوتوماتيك `cancelled_by_system` بعد ما الجولات خلصت (السلوك الصح، مش تعليق)؛ (ج) اختبار Dart الحي اللي كان بيفشل بـ timeout بقى بيعدّي نضيف.

### بَقّة تانية اتلقطت واتصلحت (2026-08-13) — استعلام الاستبعاد فوق ماكانش بيفلتر `deleted_at IS NULL`

استعلام الاستبعاد في نقطة (1) فوق (`AND tp.id NOT IN (SELECT technician_id FROM orders WHERE ...)`)
كان بيفحص `order_status` بس، من غير فلترة `deleted_at IS NULL`. لو صف طلب اتعمله soft-delete
(نادر، مش مسار عادي) لكن `order_status` فضل على قيمة نشطة (`accepted` مثلاً بدل حالة إلغاء صريحة)،
الفني كان بيفضل "محبوس" كمشغول للأبد رغم إن الطلب نفسه مش ظاهر لحد — نفس عائلة البَقّة فوق بالظبط،
بس سببها مختلف (صف "ميت" منطقيًا لسه بيتحسب في الاستبعاد بدل فني شغال فعليًا بأكتر من طلب).
اتلاحظت وقت بناء `assistant-matching.service.ts` (موثّقة كانت هناك كفجوة مفتوحة) واتأكد إنها نفس
النمط بالحرف هنا كمان. **الإصلاح**: `AND deleted_at IS NULL` اتضافت على نفس الاستعلام (وعلى الأربع
استعلامات المطابقة في `../assistant-matching/assistant-matching.service.ts`). اختبار regression حي
جديد `matching.service.spec.ts` بيثبت الاتنين: طلب `accepted` حقيقي لسه بيستبعد الفني زي الأول
(السلوك الأصلي محفوظ)، ونفس الطلب بعد `soft-delete` بقى الفني بيظهر تاني كمرشّح متاح.

## مهلة جولة حقيقية عبر BullMQ (S10، نقطة 12) — فجوة كانت موثّقة هنا اتقفلت

قبل كده كانت فيه فجوة سلوكية حقيقية مش بس توثيقية: لو فني استلم عرض وماردّش عليه خالص (لا قبول ولا رفض صريح — موبايل مقفول، تطبيق مقفول، سيناريو واقعي جداً)، **مفيش أي حاجة كانت بتتحرك** — الطلب يفضل عالق في `searching_technician` للأبد، لأن الجولة التالية كانت بتتبعت بس لو **كل** العروض المعلّقة اترفضت صراحة (`reject()`). الرد بالصمت مش زي الرفض الصريح.

- **`matching-rounds` طابور حقيقي (`@nestjs/bullmq`, Redis)**: `dispatchNextRound()` بعد ما يبعت الجولة، بيجدول job مؤجّل بمهلة `RESPONSE_TIMEOUT_SECONDS` (30 ثانية) بـ `jobId` ثابت (`orderId-rN`) عشان يمنع أي تكرار لو اتنادت الدالة مرتين لنفس الجولة غلطاً.
- **`MatchingRoundExpiryProcessor`**: بيتنفّذ لحظة انتهاء المهلة. لو الطلب اتحل قبل كده (قبول/إلغاء) بيرجع من غير أي حاجة (no-op — الطلب مبقاش `searching_technician`). لو لسه فيه عروض معلّقة (`sent`/`viewed`) من الجولة دي، بيحوّلهم لـ`timeout` (قيمة enum كانت موجودة من الشيما الأصلي `infra/migrations/0002` بس مش مستخدمة لحد دلوقتي، زي `technician_level_history` بالظبط) وبيبعت الجولة الجاية أوتوماتيك — نفس `dispatchNextRound()` اللي بيتنادى من `reject()`، فلو مفيش مرشحين تانيين الطلب بيتلغي أوتوماتيك (`cancelled_by_system`) بنفس المنطق الموجود أصلاً.
- **اتعمله اختبار end-to-end فعلي حقيقي (مش mock للوقت)**: طلب حقيقي اتعمل، اتبعت لفني واحد بس، **استُنى فعلياً 30 ثانية من غير أي رد**، والـ processor اشتغل لوحده (اتأكد من اللوج والقاعدة): العرض اتحوّل لـ`timeout`، جولة تانية اتحاولت، مفيش مرشحين تانيين (نفس الفني كان الوحيد في النطاق)، فالطلب اتلغى أوتوماتيك `cancelled_by_system` — كل ده من غير أي تدخل بشري أو رفض صريح. اختبار تاني أثبت عدم وجود regression: فني قبل الطلب **قبل** ما المهلة تخلص، الـ job بتاع الجولة دي فضل يشتغل وقت المهلة لكن اتأكد (عبر بيانات Redis نفسها — `finishedOn`/`processedOn`) إنه اشتغل صح وعمل no-op تام، الطلب والعرض فضلوا `accepted` من غير أي لمسة.
- **باگ حقيقي اتلقط واتصلح وقت الاختبار الحي — البَقّة نفسها اللي كانت الميزة جاية تصلحها كانت لسه موجودة في أول نسخة**: `roundExpiredJobId` استخدم `${orderId}:${round}` — BullMQ بيرفض أي `jobId` فيه `:` (`Custom Id cannot contain :`)، والخطأ ده كان بيتلقّط بصمت في `try/catch` بتاع `OrderDispatchListener` (بالتصميم — فشل matching مايكسرش إنشاء الطلب نفسه)، يعني الطلب كان بينشئ بنجاح لكن الـ job الحقيقي مكانش بيتزرع خالص، فالفجوة الأصلية (طلب عالق للأبد لو محدش رد) كانت لسه موجودة رغم الكود الجديد. اتصلح باستخدام `-r` بدل `:` (`orderId-rN`)، واتأكد الإصلاح حياً بنفس اختبار الـ30 ثانية فوق.
- **اعتماد جديد على Redis**: قبل كده Redis كان اختياري بالكامل (كاش `settings` بيرجع للقاعدة لو مش متاح). دلوقتي `matching` بيعتمد على Redis فعلياً لتفعيل مسار "محدش ردّ" — لو Redis واقع وقت إرسال جولة، الـ job مش هيتزرع، والطلب هيفضل يعتمد بس على رفض صريح (نفس السلوك القديم) لحد ما Redis يرجع. موثّق كاعتماد حقيقي جديد مش قصور مخفي.
- **تحديث لاحق (S10، نقطة 12 — تكملة)**: اتصال BullMQ (`AppModule`) اتظبط `enableOfflineQueue: false` عشان `roundsQueue.add()` يفشل بسرعة لو Redis واقع بدل ما يعلّق الطلب (نفس البَقّة اللي اتلقطت واتصلحت في `../ratings/README.md` — طبّقت هنا كمان لأن نفس الاتصال مشترك). فجوة موثّقة صريحة نفسها: جانب الإرسال بيفشل بسرعة مؤكّد، لكن الـ Worker (`MatchingRoundExpiryProcessor`) مبيرجّعش يعالج وظايف جديدة بعد انقطاع طويل داخل نفس الـ process — الـ job فضل قاعد بأمان لحد إعادة تشغيل الـ app.
- **تحديث لاحق تاني — تحقيق عميق في بَقّة الـ Worker reconnection، لسه مش محلولة**: اتعمل تحقيق مكثّف حاول يحل الفجوة دي نهائياً (تفاصيل كاملة في `../technicians/README.md`، نفس البَقّة بالظبط بتصيب `TechnicianStatsProcessor` كمان). جُرِّب 3 إصلاحات مختلفة حياً (اتصال منفصل بـ`configKey`، اتصال منفصل بـ`enableOfflineQueue` افتراضي، مستمع `@OnWorkerEvent('error')` + `enableOfflineQueue: false`) — الإصلاح التاني والتالت كشفوا وصلّحوا بَقّتين حقيقيتين تانيين (ضجيج `moveStalledJobsToWait` في اللوج، وerror event من غير مستمع كان بيوقّع crash صامت لـ setInterval)، لكن السبب الجذري (الـ Worker بيوقف يجيب وظايف جديدة تماماً بعد انقطاع Redis طويل، رغم `isRunning()` بيفضل `true`) **فضل موجود في كل المحاولات التلاتة**. اتأكد إنه مطابق لبَقّة موثّقة رسمياً في BullMQ نفسه (GitHub issue #4479 — اتصال blocking مابيتعافاش صح بعد إعادة اتصال، حتى مع الـ watchdog اللي BullMQ ضايفه في v6.0.9 بالذات لتخفيف نفس المشكلة). بما إن مكتبة BullMQ نفسها على أحدث إصدار متاح (6.0.9) ومفيش نسخة أحدث تصلحها، اتقرر وقف محاولات الإصلاح من كود التطبيق والاكتفاء بالتوثيق الصريح — الحل الحقيقي محتاج إما تحديث مستقبلي من BullMQ نفسه، أو آلية supervisor خارجية بتعمل health-check وrestart تلقائي للـ process لو لاحظت وظايف واقفة في الطابور من غير حركة رغم إن Redis متاح، وده خارج نطاق كود التطبيق وحده.

## `cancelForNoTechnicians()` كانت بتلغي بصمت — بَقّة حقيقية اتلقطت واتصلحت

اتلقطت وقت بناء `OrderAutoCancelService` (`../orders/README.md`) — نفس التفكير في نفس الـ event. `cancelForNoTechnicians()` (بتتنادى لما مفيش فنيين مؤهلين أصلاً، أو الجولات خلصت من غير رد) كانت بتنقل الطلب لـ`cancelled_by_system` فعلياً وتسجّل `order_status_history` صح، **بس من غير ما تصدّر `order.status_changed` خالص** — يعني `OrderStatusNotificationListener` (اللي أصلاً بيعالج `CANCELLED_BY_SYSTEM` من زمان) محدش كان بيوصله أي حدث يشتغل عليه، فالعميل (والفني لو موجود) محدش كان بيوصله أي إشعار "مفيش فني قبل طلبك" خالص. اتصلحت بإضافة `this.events.emit(ORDER_STATUS_CHANGED_EVENT, ...)` بعد الـ transaction — نفس النمط بالظبط المُستخدم في كل انتقال تاني بالموديول ده. اتعمله اختبار حي: طلب لخدمة اختبارية بصفر فنيين مؤهلين اتلغى فوراً والعميل استلم إشعار حقيقي `order_cancelled_by_admin` بالسبب `ORDR_002` بالظبط.

## بَقّة routing خطيرة — استيراد `OrdersModule` زيادة كان بيشيل ترتيب تسجيل المسارات

اتلقطت وقت بناء `GET /technician/orders/active` (`../orders/README.md`). `MatchingModule` كان بيستورد `OrdersModule` بالكامل رغم إن مفيش أي كود هنا بيحقن `OrdersService` فعلياً — الاستخدام الوحيد لـ `Order`/`OrderStatusHistory` هو `manager.create()` جوّه transaction (بيشتغل عالمياً عبر `DataSource` مش محتاج Repository مُحقن ولا الموديول كله). NestJS بيسجّل مسارات الـ controllers بترتيب تحميل الموديولات (بيتبع شجرة الاعتماديات — موديول بيستورد موديول تاني بيفرض الموديول المستورَد يتسجّل الأول)، ومسارات Express بتتطابق بترتيب التسجيل مش بالتحديد (specificity) — يعني مسار حرفي زي `GET /technician/orders/available` (هنا) لو اتسجّل **بعد** `GET /technician/orders/:id` (في `orders`)، الـ `:id` بيطابق الأول ويرفض `"available"` كـ UUID غلط عبر `ParseUUIDPipe`.

الاستيراد الزايد ده كان بيفرض `OrdersModule` يتحمّل قبل `MatchingModule` دايماً، وده كان شغال بأمان لحد ما `GET /technician/orders/:id` اتضاف لـ`orders` في كوميت سابق في نفس الجلسة دي — من ساعتها **كل الفنيين مكانوش قادرين يشوفوا أي طلب متاح خالص** (بَقّة إنتاجية حقيقية، مش نظرية، اتقدّمت بنفسي وبَقيت تحتها لحد ما اختبار حي جديد فشل بـ"العرض ده مبقاش متاح" رغم الطلب سليم ومتاح فعلاً).

اتصلحت بـ: (1) شيل `import { OrdersModule }` من `matching.module.ts`، استبداله بـ `TypeOrmModule.forFeature([OrderAssignment, Order])` مباشرة (كان موجود بالفعل، مش محتاج إضافة)، (2) ترتيب `MatchingModule` قبل `OrdersModule` في `imports` بتاع `app.module.ts` مع تعليق يوضّح السبب لأي حد يلمس الترتيب ده تاني. اتأكد الإصلاح حياً: `server.log` أظهر `available` بيتسجّل قبل `:id` دلوقتي، `curl` مباشر لـ`GET /technician/orders/available` رجّع `200` بدل خطأ UUID، ومسار قبول طلب كامل (`create`→`available`→`accept`) نجح من غير أي تأخير صناعي.

**الدرس العام**: أي استيراد موديول لموديول تاني في NestJS مش بس اعتماد DI — هو كمان قرار ترتيب تسجيل مسارات ضمني. استيراد موديول كامل "للاحتياط" أو لأنه "كان موجود من الأول" من غير التحقق إن فيه فعلاً حقن حقيقي بيستحق مراجعة دورية.

## "إعادة الحجز" — عرض حصري اختياري على فني بالذات في أول جولة

طلب صريح ضمن اقتراحات بروفايل الفني — العميل يقدر يطلب نفس الفني اللي اشتغل معاه قبل كده (`orders.requested_technician_id`, migration `0046`). `findEligibleTechnicians()` بقت تاخد `requestedTechnicianId` اختياري — لو موجود، بتضيف `AND tp.id = $7` لنفس شروط الأهلية العادية بالظبط. `dispatchNextRound()` بيستخدمها **في أول جولة بس** (`nextRound === 1`)؛ لو رجّعت فاضية (الفني المطلوب مشغول/مش أونلاين/إلخ)، بيرجع يسأل فوراً من غير القيد (نفس استعلام أي طلب عادي) — **مش** بيعتبرها "مفيش فنيين خالص" ويلغي الطلب. تفاصيل كاملة في `apps/api/src/modules/technicians/README.md` (القسم اللي بيوصف بروفايل الفني العام).

## بث "طوارئ" — صُنّاع (`docs/06` §1.7، `docs/07` الجزء ج)

`booking_mode=emergency` (docs/06 §1، migration `0051`) بيغيّر سلوك `dispatchNextRound()`/`findEligibleTechnicians()` بنقطتين بس:

1. **تجاهل فلتر `is_available`/`is_on_duty` تمامًا** — المالك طلب صراحة "بيوصل لكل الناس القريبة منه كله بلا استثناء... طالما فاتح نت والإشعار ممكن يوصله". باقي شروط الأهلية (معتمد، ليه موقع حالي، مؤهّل للخدمة/المنطقة، **مش مشغول بطلب نشط بالفعل**) بتفضل زي ما هي — "بلا استثناء" بيقصد حالة التوافر بس، مش قدرة الفني الفعلية إنه يستلم طلب. باراميتر جديد `ignoreAvailabilityFilter` في `findEligibleTechnicians()` بيتحكم في ده عبر شرط SQL واحد (`$8::boolean OR (is_available AND is_on_duty)`).
2. **دفعة أكبر**: `matching.emergency_batch_size` (إعداد جديد، migration `0053`, افتراضي 10) بدل `matching.batch_size` العادي (5) — "أول عشرة" بالحرف من كلام المالك. `matching.response_timeout_seconds`/`matching.max_rounds` بيتشاركوا مع الوضع العادي عمدًا (مفيش داعي مُوثّق لتوقيت مختلف).

**إشعار فوري للأدمن/المانجر** (docs/06 §2.2): `EmergencyOrderRoutingListener` جديد في `../notifications/` بيسمع نفس `ORDER_CREATED_EVENT` الموجود، وبيستخدم `NotificationRoutingService.routeToRole()` الموجود بالفعل (نفس آلية `complaint.filed`/`payout.completed`) لو `order.bookingMode === 'emergency'` — event_type مخصوص (`order.emergency_created`) بقاعدة توجيه افتراضية لـ`ops_manager` (migration `0053`)، قابلة للتعديل/الإضافة من `/admin/notification-routing-rules` من غير أي كود جديد.

**اتعمله اختبار حي كامل**: فني حقيقي اتحط `is_available=false` (مش قابل شغل) — طلب `booking_mode=team` عادي ميلقاش أي فني ويتلغي أوتوماتيك (`cancelled_by_system`)؛ **نفس الفني بالظبط**، لسه `is_available=false`، طلب `booking_mode=emergency` لقاه فعلاً وظهر في `GET /technician/orders/available`. أدمن بدور `ops_manager` استلم إشعار `order_emergency_created` فوري بمجرد إنشاء الطلب، أدمن `super_admin` (مالوش نفس الدور في قاعدة التوجيه المزروعة) محدش وصله إشعار — يثبت إن التوجيه فعلاً بالدور مش لكل الأدمنز.

## تفضيل شركة محدّدة لطلبات "اعتماد" — `requested_technician_company_id` — كانت فجوة موثّقة، اتقفلت

`findEligibleTechnicians()` بقت تاخد `preferredCompanyId` اختياري (`AND ($9::uuid IS NULL OR tp.company_id = $9)`) — نفس فلسفة `requestedTechnicianId` بالحرف. `dispatchNextRound()` بيجرّب بالترتيب: **أول جولة بس** — (1) فني بعينه لو `requestedTechnicianId` موجود، وإلا (2) فنيي الشركة المطلوبة لو `requestedTechnicianCompanyId` موجود، وإلا (3) التوزيع العادي. أي مرحلة رجّعت فاضية بيكمّل للي بعدها فورًا بدل ما يعتبرها "مفيش فنيين خالص" — **تفضيل بس، مش ضمان**، الطلب مبيتلغيش بسبب إن شركة بعينها مالهاش حد متاح.

**اتعمله اختبار حي حاسم**: فنيّين اتنين مؤهّلين لنفس الخدمة/المنطقة، واحد بس (`TECH`) عضو الشركة المطلوبة — طلب `booking_mode=team` بـ`requested_technician_company_id` وصل لـ`TECH` بس (ظهر في `GET /technician/orders/available` بتاعه)، الفني التاني (مؤهّل بالظبط بس مش عضو الشركة) **محدّش وصله** رغم أهليته الكاملة. لما `TECH` (العضو الوحيد) بقى `is_available=false`، طلب تاني بنفس تفضيل الشركة **رجع للتوزيع العادي فورًا** ووصل للفني التاني — إثبات إن الـfallback شغال ومفيش إلغاء غلط.

## سباق `reject()`/مهلة الجولة المنتهية ممكن يعمل جولة توزيع مكرّرة — كانت فجوة موثّقة، اتقفلت (بناء 2026-08-12)

`dispatchNextRound()` بيتنادى من مكانين مختلفين مش متزامنين مع بعض: `reject()` (لما آخر عرض معلّق
في الجولة يترفض صراحة) و`MatchingRoundExpiryProcessor.process()` (لما مهلة الجولة تخلص من غير رد).
لو الاتنين حصلوا في نفس اللحظة بالظبط لنفس الطلب — كانا يقدروا يقروا نفس `MAX(assignment_round)`
قبل ما أي واحد يكتب، ويحسبوا نفس `nextRound`، ويضيفوا صفوف `order_assignments` مكرّرة لنفس الجولة.

**الإصلاح**: `dispatchNextRound()` بقت بتفتح transaction واحدة من أول خطوة وتقفل صف الطلب
(`pessimistic_write`) قبل أي قراءة/كتابة — نفس نمط `accept()` بالظبط. أي نداء تاني لنفس الطلب
بيستنى القفل يتفك، وبعدين بيعيد قراءة الحالة الحقيقية (لو الأول خلّص الجولة أو لغى الطلب، التاني
هيشوف الحالة الجديدة ويرجع بأمان من غير أي كتابة). `cancelForNoTechnicians()` بقت تاخد نفس الـ
`manager` بدل ما تفتح transaction منفصلة خاصة بيها (كانت هتعمل deadlock حقيقي لو اتنفّذت جوّه
transaction dispatchNextRound الماسكة القفل بالفعل). الأحداث (إشعار الإلغاء/طابور مهلة الجولة
الجديدة) بتتبعت بعد ما الـtransaction تتقفل بنجاح بس، مش من جواها.

**اتعمله اختبار حي حقيقي للسباق نفسه** (مش سيناريو نظري بس): فنيّين اتنين حقيقيين اتبعتلهم عرض
لنفس الطلب في نفس الجولة، الاتنين رفضوا بنداءين متوازيين فعليًا (background processes، مش
تسلسليين) في نفس اللحظة تقريبًا — **صفر صف مكرر** في `order_assignments`، **صفر خطأ deadlock**
في اللوج، الطلب اتلغى مرة واحدة بس (`cancelled_by_system`، صف واحد بالظبط في `order_status_history`
مش اتنين). النداء التاني اتأكد إنه ضرب مسار `noop` بأمان (شاف الحالة اتغيّرت بالفعل ورجع من غير
أي كتابة) — مش استثناء أو خطأ.

## `OrderRematchListener` — سياسة إلغاء الفني (docs/10)

بيسمع `ORDER_REMATCH_REQUESTED_EVENT` (بيتصدر من `orders` module بعد إعادة مطابقة تلقائية لطلب
فني لغاه، أو بعد `POST /orders/:id/request-rematch` من العميل) وينادي `dispatchNextRound()`
الموجودة أصلاً — نفس نمط `OrderDispatchListener`/`ORDER_CREATED_EVENT` بالحرف، صفر منطق توزيع
جديد. الفني اللي لغى بيتستبعد تلقائيًا (صف `order_assignments` بتاعه لسه موجود لنفس الطلب، نفس
آلية الاستبعاد الموجودة أصلاً في `findEligibleTechnicians()`). تفاصيل كاملة في `../orders/README.md`
§ سياسة إلغاء الفني.

## تعارض جدولة (docs/08 §2) — كانت فجوة موثّقة صراحة (ADR-0007 §7)، اتقفلت (2026-08-13)

`findEligibleTechnicians()` كانت بتستبعد فني عنده طلب نشط دلوقتي (`ACTIVE_TECHNICIAN_ORDER_STATUSES`)
بس — كافي لطلب فوري، لكن لطلب `scheduled_at` مستقبلي مش كافي خالص: فني ممكن يكون فاضي دلوقتي
بالظبط بس عنده سلوت `booked` (`technician_schedule_slots`، راجع `../technicians/README.md`)
بيتقاطع مع وقت الطلب الجديد، ويترشّح ويقبله رغم التعارض. اتضاف شرط `NOT EXISTS` جديد يفحص
تقاطع نافذة الطلب (`[scheduled_at, scheduled_at + services.estimated_duration_minutes]`، افتراضي
ساعة لو الخدمة مالهاش مدة مقدّرة) مع أي سلوت `booked` لنفس الفني في نفس اليوم. لطلب فوري
(`scheduled_at IS NULL`) الشرط كله no-op بالضبط (نفس السلوك القديم بالحرف — مفيش تغيير على
مسار الطلبات الفورية أبدًا). كل القيم UTC مباشرة (نفس اتفاقية تركيب `scheduled_at` من
`slot_date`/`start_time` في `orders.service.ts`، موثّقة في `../technicians/README.md`).

**قيد موثّق صراحة**: النافذة المحسوبة ممكن تتخطى منتصف الليل نظريًا (لخدمة بمدة طويلة جدًا قرب
نص الليل) وده مش متغطى بدقة — السلوتات نفسها أصلاً مقيّدة بيوم واحد (`end_time > start_time`
مفروضة في `createSlot()`)، فحالة عملية نادرة جدًا ومقبولة كقيد معروف مش سهو.

اتعمله اختبار حي مباشر ضد Postgres حقيقي (نفس استعلام `findEligibleTechnicians()` بالحرف عبر
psql): فني حقيقي عنده سلوت `booked` 10:00-12:00 UTC — طلب `scheduled_at=11:00` (بيتقاطع) استبعده
صح، وطلب `scheduled_at=13:00` (بعد نهاية السلوت) رجّعه صح.

مرجع كامل: `../../../../docs/02-data-dictionary.md` و `../../../../docs/01-master-plan.md` §2.4.

## تأجيل بث المطابقة لطلب مجدول "بعيد" — ADR-0009 بند 1-2، اتقفل جزئيًا (P0-9، 2026-08-13)

قبل الإصلاح ده، طلب مجدول بعد أسبوعين كان بيوصله بث "طلب جديد — اقبل خلال 30 ثانية" لحظة **إنشاء**
الطلب بالحرف — مزعج للفني (التزام مبكر لموعد بعيد) وغير منطقي تشغيليًا. التصميم الكامل (وأسباب
تأجيل بند تاني مرتبط) موثّق في `../../../../docs/adr/0009-deferred-dispatch-for-scheduled-orders.md`
— هنا تفاصيل التنفيذ الفعلي لبند 1-2 بس (**بند 3، إعادة تعريف "مشغول" بنافذة زمنية بدل استبعاد
كامل، لسه مؤجّل عمدًا** — راجع "ليه التنفيذ مؤجَّل" في الـADR، السبب نفسه لسه قائم: تغيير جوهري
في استعلام `findEligibleTechnicians()` المستخدم في كل جولة مطابقة بالنظام، مخاطرة مختلفة تمامًا
عن بند 1-2).

- **إعداد جديد** `matching.deferred_dispatch_lead_hours` (افتراضي 4 ساعات، `infra/migrations/0086`) —
  طلب `scheduled_at - now() > lead_hours` = "بعيد" (بث مؤجّل)، غير كده = "قريب" (بث فوري، نفس
  سلوك الطلب الفوري بالحرف).
- **القرار محسوب في `OrdersService.create()` نفسها، مش وقت معالجة الحدث لاحقًا** — دالة نقية
  `computeDispatchDeferredUntil()` (`../orders/deferred-dispatch.util.ts`) بتاخد `scheduleSlotBooked`
  (بوليان مباشر من `!!scheduleSlot` — **مش** `requestedTechnicianId`، لأن العمود ده بيتحط من
  مصادر تانية غير سلوت الجدولة الصريح: تفضيل عادي `dto.requested_technician_id`، وإعادة الزيارة
  `originalOrder.technicianId`. لو اعتمدنا عليه هنقع في استثناء بند 1-2 ("سلوت صريح = بث فوري
  دايمًا") غلط لطلبات مالهاش سلوت أصلاً). القرار ده بيتحمل جوّه `OrderCreatedEvent.dispatchDeferredUntil`
  الجديدة (اختيارية) — أنضف من إعادة اشتقاقه وقت معالجة الحدث (كان محتاج يرجع للـ DB أو يفترض
  علاقة غير مضمونة).
- **`ORDER_CREATED_EVENT` لسه بيتصدّر فورًا دايمًا (`emitAsync`) بلا أي شرط** — قرار متعمّد: فيه
  listeners تانية غير `OrderDispatchListener` بتسمع نفس الحدث (`CustomerStatsRecalculationListener`,
  `OrderCreatedNotificationListener`, `EmergencyOrderRoutingListener`) ولازم تشتغل فورًا بغض النظر
  عن بُعد الموعد (إحصائيات العميل، إشعار "طلبك اتسجّل"، توجيه الطوارئ). **التأجيل خاص ببث المطابقة
  بس** — `OrderDispatchListener.handleOrderCreated()` هو اللي بيفحص `event.dispatchDeferredUntil`
  ويقرر: لو مستقبلية، بيجدول job مؤجّل (`matching-dispatch` queue) بدل ما ينادي `dispatchNextRound()`
  فورًا؛ غير كده (undefined، أو دفاعيًا لو كانت في الماضي) بيبث فورًا زي القديم بالحرف.
- **`matching-dispatch` queue حقيقي (`@nestjs/bullmq`, Redis) + `MatchingDeferredDispatchProcessor`** —
  نفس نمط `matching-rounds`/`MatchingRoundExpiryProcessor` بالحرف (`jobId` ثابت `deferred-${orderId}`
  يمنع أي تكرار، مستمع `@OnWorkerEvent('error')` إجباري). لحد ما وقت البث المؤجّل يوصل، الطلب
  محفوظ `searching_technician` من لحظة الإنشاء (العميل شايف "بندوّرلك على فني" وده صحيح فعلاً)، بس
  مفيش `order_assignments` ولا إشعار "طلب جديد" وصل لأي فني. الـprocessor بيتأكد الطلب لسه
  `searching_technician` قبل ما ينادي `dispatchNextRound()` (no-op لو اتلغى/اتحل بطريقة تانية قبل
  ما الوقت يوصل).
- **`ops.QueueWatchdogService`** اتحدّث يراقب الطابور الجديد كمان (نفس آلية `matching-rounds` —
  فحص `getWaiting()` دوري، `getWaiting` بترجّع بس jobs جاهزة للتنفيذ فعلًا مش لسه `delayed`، فمفيش
  false positive من الـdelay الطويل نفسه).
- **اختبار حي**: (أ) `../orders/deferred-dispatch.util.spec.ts` — اختبار وحدة نقي بيغطي كل حالات
  `computeDispatchDeferredUntil()` (فوري، بعيد، قريب، سلوت صريح، حافة leadHours بالظبط). (ب)
  `order-dispatch.listener.spec.ts` — اختبار حي ضد Redis حقيقي (`Queue`/`getJob`/`getState` فعليين،
  مش mock): `dispatchDeferredUntil` مستقبلية بتجدول job `delayed` حقيقي بـ`delay` مطابق ومفيش
  `dispatchNextRound()`؛ من غيرها بيبث فورًا ومفيش job في الطابور خالص؛ قيمة ماضية (دفاعي) بتبث
  فورًا برضو.

**فجوة موثّقة صراحة متبقّية**: طلب فيه `dto.requested_technician_id` (تفضيل عادي، مش سلوت جدولة
صريح) ومعاه `scheduled_at` بعيد — بيتأجّل بث المطابقة زي أي طلب تفضيل عادي (السلوك الصح حسب
الـADR: الفني ده معلنش توافره صراحة في الوقت ده، مجرد "تفضيل"). لو المالك حاب سلوك مختلف لحالة
"تفضيل فني + موعد بعيد" تحديدًا (مثلاً بث فوري ليه هو بس)، ده قرار عمل جديد مش جزء من نطاق P0-9.

## أحداث عرض الطلب — `ORDER_OFFER_CREATED_EVENT`/`ORDER_OFFER_RESOLVED_EVENT` (docs/08 §17.16)

`dispatchNextRound()` بقى بيصدّر `ORDER_OFFER_CREATED_EVENT` مرة لكل صف `order_assignments` جديد
(عادي أو طوارئ `isEmergency`) — قبل كده مفيش أي إشعار كان بيوصل للفني أصلاً لما عرض جديد يتبعتله،
فجوة موثّقة كانت اتلقطت بالبحث في الجلسة اللي فاتت. المستمع (`OrderOfferNotificationListener` في
`../notifications/`) هو المسؤول الوحيد عن قرار القناة/الأولوية — `MatchingService` نفسه مالوش أي
معرفة بالإشعارات، نفس فلسفة `ORDER_ACCEPTED_EVENT` بالحرف.

`accept()`/`reject()` والـ`MatchingRoundExpiryProcessor` (انتهاء مهلة الجولة) الثلاثة بيصدّروا
`ORDER_OFFER_RESOLVED_EVENT` (`accepted`/`cancelled_offer_taken`/`rejected`/`expired`) — المستمع
بيوقف أي دورة تذكير `critical_offer` شغالة للعرض ده فورًا (idempotent، safe no-op للعروض العادية)،
وبينبّه الفني الخاسر فورًا "العرض بقى مش متاح" بدل ما يفضل مستني رد لعرض راح فعلاً (طلب المالك
الصريح). `accept()` بقى بيستخدم `UPDATE ... RETURNING` بدل `manager.update()` العادي عشان يعرف
بالظبط مين العروض المرفوضة تلقائيًا (فني تاني قبل) — `manager.update()` مابيرجّعش الصفوف المتأثرة.

**اتأكد حيًا بتزامن حقيقي** (`matching-accept-concurrency.spec.ts`، ومقابله في
`../assistant-matching/assistant-matching-accept-concurrency.spec.ts`): فنيين حقيقيين بيقبلوا نفس
الطلب في نفس اللحظة (`Promise.allSettled`) — واحد بس يفوز (`fulfilled`)، التاني يترفض بـ`409`
(`ORDR_003`)، عرض الخاسر بيتلغي فعليًا في القاعدة (مش يفضل `sent` معلّق للأبد). ده أول اختبار
concurrency حقيقي لأخطر مسار في المطابقة كله رغم إن الكود نفسه (قفل `pessimistic_write`) كان موجود
من زمان — "اتحقق حي مش افتراض من قراءة الكود" (طلب المالك الصريح، §17.25).

## تدرّج دفعات الطوارئ (docs/08 §17.15، migration `0098`)

`dispatchNextRound()` عنده دلوقتي سياسة توزيع طوارئ منفصلة بالكامل عن العادي، صفر أرقام دائمة:

- **دفعة أولى/تالية منفصلتين**: `matching.emergency_batch_size` (الجولة 1 بس) و
  `matching.emergency_subsequent_batch_size` (جديد، الجولة 2+) — قابلين للتعديل المستقل، مفيش
  افتراض إنهم لازم يبقوا بنفس الحجم.
- **مهلة رد أقصر**: `matching.emergency_response_timeout_seconds` (افتراضي 20 ثانية) بدل
  `matching.response_timeout_seconds` العادية (30 ثانية) — "عمر العرض" مستقل بالكامل عن الطلب العادي.
- **سقف أقصى لإجمالي الفنيين المتواصَل معاهم** (`matching.emergency_max_technicians_contacted`،
  افتراضي 40) — بيتحسب **قبل** كل جولة (`COUNT(*) FROM order_assignments WHERE order_id=...`)،
  مستقل عن `matching.max_rounds` تمامًا (ده بيحدّ عدد *الجولات*، ده بيحدّ عدد *الفنيين* الكلي —
  مفيد لو batch size كبير وعدد الجولات قليل، أو العكس). لو الميزانية المتبقية أصغر من حجم الدفعة
  المطلوب، الدفعة بتتقصّ لحجم الميزانية فعليًا (`Math.min`) مش ترفض كليًا — الطلب بيتلغي
  (`cancelForNoTechnicians`) بس لو الميزانية وصلت صفر قبل ما الجولة تبدأ أصلاً.
- **تصعيد تلقائي** (`matching.emergency_escalation_after_rounds`، افتراضي جولتين): حدث جديد
  `ORDER_EMERGENCY_DISPATCH_STRUGGLING_EVENT` بيتصدّر **مرة واحدة بس** لكل طلب (`nextRound ===`
  العتبة بالظبط، مش `>=`) — مستمع `EmergencyDispatchStrugglingRoutingListener` في `../notifications/`
  بيوجّهه لـ`ops_manager` عبر `NotificationRoutingService.routeToRole()` الموجود بالفعل، نفس نمط
  `EmergencyOrderRoutingListener` بالحرف (event_type مختلف عمداً — `order.emergency_dispatch_struggling`
  — عشان الأدمن يقدر يوجّهه لفريق تصعيد مختلف عن استقبال الطلب نفسه).
- **"توسّع نطاق جغرافي/نصف قطر" من النص الأصلي — قرار نطاق واعي**: البنية الحالية zone-based
  (`technician_zones`) مش point-radius، فمفيش "نصف قطر" حرفي ممكن يتوسّع. بناء fallback حقيقي
  بالـradius كان هيحتاج بُعد مطابقة جديد كليًا في `findEligibleTechnicians()` — بالظبط النوع اللي
  المالك حذّر منه صراحة ("ممنوع إضعاف صحة المطابقة لمجرد تسريع توزيع الطوارئ"). اتأجّل عمدًا،
  موثّق هنا كفجوة صريحة مش نسيان.
- **حفاظ كامل على قواعد الأهلية**: صفر تغيير في `findEligibleTechnicians()` نفسها — التغيير كله
  في *كام فني نبعتلهم* و*إمتى*، مش *مين مؤهّل أصلاً*.
- **اتأكد حي بالكامل** (`emergency-batch-dispatch-policy.spec.ts`، 3 اختبارات، `EventEmitter2`
  حقيقي بيلتقط الأحداث المتصدّرة فعليًا مش mock): جولة 1 بحجمها الصح، جولة 2 بحجمها الصح **والسقف
  بيقصّها من 3 المطلوبة لـ2 المتاحة فعليًا** (مش رفض كامل)، التصعيد بيتصدّر مرة واحدة بالظبط في
  الجولة الصح بالبيانات الصح (`roundsSoFar`/`techniciansContactedSoFar`)، وجولة 3 (ميزانية 0)
  بتلغي الطلب فورًا بدل ما تبعت أي عرض جديد.
