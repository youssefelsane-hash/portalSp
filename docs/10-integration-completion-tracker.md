# 10 — متتبّع إكمال التكامل (Backend → UI حقيقي) + سياسة إلغاء الفني (2026-08-12، فرع `hgotr7`)

**الطلب الأصلي من المالك (بالحرف تقريبًا)**: قايمة فحص شاملة — "أي حاجة ناقصة، أي حاجة مش كاملة تصلحها وتخليها perfect" —
بالإضافة لطلبين محددين بالتفصيل:
1. **سياسة إلغاء فني كاملة قابلة للإعداد** (مش hardcoded) — تفاصيل كاملة تحت "سياسة إلغاء الفني".
2. **مرحلة تكامل جديدة**: خد أي ميزة موجودة في الباك-إند بس مش قابلة للاستخدام الحقيقي من أي تطبيق (عميل/فني/عامل منزلي/أدمن) وكمّلها end-to-end. **مفيش افتراض إن وجود API = الميزة خلصت.**

**القاعدة الحاكمة لكل بند هنا**: "complete" معناها مستخدم حقيقي يقدر يكتشف الميزة ويستخدمها من التطبيق المقصود،
التطبيق بينادي الـbackend الصح، الـbackend بيحفظ/يفرض القاعدة، الطرف/الدور التاني بيشوف النتيجة الصح، والتدفق كله
اتعمله اختبار حي كامل. **backend-only مش "complete".**

قبل أي بند: تأكد من حالة `main` الحالية بالقراءة المباشرة (مش افتراض من تقرير قديم) — سيشنز/أكاونتات تانية ممكن
تكون شغالة بالتوازي.

---

## حالة كل بند (يتحدّث لحظيًا أثناء التنفيذ)

الحالات: `✅ اتأكد حي` (كان موجود بالفعل، اتفحص واتثبت شغال) | `✅ خلص` (اتبنى/اتكمّل في المرحلة دي) |
`🔄 شغال عليه دلوقتي` | `⏳ لسه` | `⏸️ مؤجّل عمداً (backlog منفصل، مش جزء من التكامل)` | `🚫 محجوب` (محتاج قرار عمل/بيانات خارجية)

### Phase A — أولوية إطلاق (Launch-critical)

| # | البند | الحالة | ملاحظات |
|---|-------|--------|---------|
| 1 | محرك التسعير الديناميكي end-to-end | ✅ خلص | Backend + Customer App من سيشن سابقة (PR #64). **المتمم في السيشن دي (2026-08-12)**: Admin Pricing Builder UI كامل (`pricing-builder.tsx`) + تتبّع snapshot السعر التاريخي (`service_pricing_evaluations.order_id` بيتربط فعليًا بالطلب بعد الإنشاء عبر `linkEvaluationToOrder`). اتأكد حي بالكامل (Playwright + curl + DB): إنشاء حقول/lookup table/معادلة من الواجهة → معاينة صح → طلب حقيقي بنفس السعر بالظبط → صف التدقيق مرتبط بـ`order_id` الصح. تفاصيل كاملة في `apps/api/src/modules/pricing/README.md`. |
| 2 | معاينة سعر حقيقية + تفصيل قبل التأكيد | ✅ خلص | `POST /orders/preview` جديد (read-only، نفس منطق `OrdersService.create()` بالحرف) — `CreateOrderScreen` بقى بيعرض breakdown كامل (أساسي/فحص/طوارئ+SLA/إضافات/خصم/نطاق formula/مدة متوقعة/إجمالي) لكل نماذج التسعير، مش رقم واحد غامض. اتأكد حي: معاينة = طلب حقيقي بالحرف لخدمتين (fixed+formula). تفاصيل في `apps/api/src/modules/orders/README.md`. |
| 3 | الجدولة (Scheduler) end-to-end | ✅ اتأكد حي | Backend + Customer App + Technician App اتعملوا في سيشن سابقة (PR #65، #66) — اختبار حي كامل شامل سباق حقيقي. |
| 4 | اختيار الفني قبل الحجز | ✅ خلص | كانت فجوة UI حقيقية مؤكّدة: الـendpoint مختبر حي بس مفيش أي شاشة بتناديه — العميل مكانش يقدر يختار فني قبل الحجز أصلاً. `TechnicianSelectionScreen` جديدة (customer-app) بتظهر بعد اختيار الخدمة لـ`booking_mode=individual`، "اختار لي تلقائيًا" أو كروت فنيين حقيقية. تفاصيل في `apps/api/src/modules/technicians/README.md`. |
| 5 | تسجيل عميل جديد (مش OTP login بس) | ✅ خلص | `LoginScreen` بقى فيها مود تسجيل جديد كامل (اسم + كود ترشيح اختياري + OTP بـ`purpose=register`) + اقتراح تلقائي للتحويل لو العميل حاول دخول برقم مش مسجّل. تفاصيل في `apps/customer-app/README.md`. |
| 6 | تسجيل/onboarding فني جديد | ✅ خلص | كانت فجوة أعمق من customer-app: مفيش تسجيل ولا رفع مستندات خالص — فني جديد كان بيوصل لشاشة طلبات فاضية للأبد من غير تفسير. `OnboardingScreen` جديدة (حالة الاعتماد + رفع مستندات + قايمة مراجعتها) + `_VerificationGate` في `main.dart` بتوجّه الفني تلقائيًا. تفاصيل في `apps/api/src/modules/technicians/README.md` و`apps/technician-app/README.md`. |
| 7 | ربط الإنتاجية/المدة المتوقعة بتجربة الحجز | ✅ خلص | Formula (مع #2) + الآن غير-formula: `GET /services/:id/standard-data` جديد (كانت فجوة حقيقية — مفيش endpoint يوفّر الـids أصلاً) + قسم "المدة المتوقعة" في `CreateOrderScreen`. تفاصيل في `apps/api/src/modules/catalog/README.md`. عرضها في شاشات الفني/الأدمن التشغيلية لسه مش جزء من هذا الإغلاق (نطاق مختلف — P2 §35). |

### Phase B — الثقة والتنفيذ

| # | البند | الحالة | ملاحظات |
|---|-------|--------|---------|
| 8 | بروفايل الفني العام الكامل | ✅ خلص | كانت فجوة حقيقية مؤكّدة: `avg_arrival_minutes`/`avg_completion_minutes`/`certificates` كانوا مختبرين حي بالباك-إند بس Dart model (`TechnicianPublicProfile.fromJson`) مكانتش بتقرأهم خالص. اتضافوا للموديل + الشاشة (سطر متوسطات + قسم شهادات). اتأكد حي: فني رفع شهادة، أدمن وافق، ظهرت بالحقول الصح في `GET /technicians/:id/profile`. تفاصيل في `apps/api/src/modules/technicians/README.md`. |
| 9 | الشهادات: Technician + Admin + Customer | ✅ خلص | الثلاثة كاملين: Technician upload (موجود من قبل)، Customer display (مع #8)، وAdmin review UI (كارت جديد في صفحة تفاصيل الفني — نفس بند #29). اتأكد حي عبر Playwright: ضغط "اعتماد" فعلي غيّر الحالة في المتصفح الحقيقي. |
| 10 | تقييم متقدم + صور بعد الخدمة | ✅ خلص | كانت فجوة حقيقية مؤكّدة على جانبين: (أ) `showRatingDialog()` كان بيبعت `overall_rating`+`comment` بس رغم إن الباك-إند بيدعم 5 أبعاد إضافية + `after_photo_media_ids` من زمان، (ب) **مفيش endpoint أصلاً للعميل يشوف صور طلبه** (`GET /orders/:id/media` كان مقصور على الأدمن/الفني). اتضاف الـendpoint (ownership check) + rewrite كامل لـ`rating_dialog.dart` (5 صفوف نجوم اختيارية + قسم اختيار صور بعد التنفيذ). اتأكد حي end-to-end كامل: طلب طوارئ حقيقي جديد (مش mock) عدّى دورة كاملة (قبول→تنفيذ→رفع صورة→تحصيل كاش)، العميل جاب الصور عبر الـendpoint الجديد وبعت تقييم بكل الأبعاد الستة + ربط الصورة — الرد رجع كل الحقول صح، ومحاولة تقييم تاني اترفضت `409` زي المتوقع. تفاصيل كاملة في `apps/customer-app/README.md` و`apps/api/src/modules/orders/README.md`. |
| 11 | تجربة الضمان/إعادة الزيارة للعميل | ✅ خلص | كانت فجوة حقيقية مؤكّدة: `warranty_expires_at`/`original_order_id` موجودين في رد الباك-إند من زمان (`order-response.dto.ts`) بس موديل `Order` في customer-app مكانش بيقراهم خالص — العميل ماكانش يعرف إن طلبه تحت ضمان أصلاً ولا عنده أي طريقة يطلب إعادة زيارة مجانية رغم إن `POST /orders {original_order_id}` كان مختبر حي بالباك-إند من زمان. اتضاف الحقلين + `isUnderWarranty` getter للموديل، بادچ "تحت الضمان لحد..."/"انتهى الضمان" في `OrderDetailScreen`، وزرار "طلب إعادة زيارة (ضمان)" (يظهر بس لو `completed` وتحت الضمان) بيفتح dialog تأكيد وينشئ طلب `revisit` جديد مجاني بالكامل. اتأكد حي end-to-end كامل: طلب حقيقي عدّى دورة كاملة (فني حقيقي قبل→نفّذ→العميل دفع من المحفظة)، `warranty_expires_at` رجع +30 يوم بالظبط، طلب إعادة زيارة حقيقي بـ`original_order_id` نجح برد `order_type=revisit`/`total_amount_cents=0` بالظبط. أرصدة المحافظ (عميل/منصة/فني) اترجعت للحالة الأصلية بالظبط بعد الاختبار. تفاصيل في `apps/customer-app/README.md`. |
| 12 | عرض أعضاء الفريق للعميل | ✅ خلص | كان endpoint يتيم بالكامل (`GET /orders/:id/team-members` موجود ومختبر حي من قبل بس صفر كود Dart بينادي عليه). اتضاف موديل + repository method + كارت "فريق الشغل" في `OrderDetailScreen` (يظهر بس لو `booking_mode=team` والقايمة مش فاضية). اتأكد حي: طلب فريق حقيقي، فني قائد ضاف عضو فريق حقيقي، العميل شافه فورًا عبر نفس الـendpoint اللي التطبيق بيستخدمه، وعميل تاني اترفض `404`. تفاصيل في `apps/customer-app/README.md`. |
| 13 | واجهة المساعد (Technician) | ✅ خلص | `GET /technician/me` كان بيرجّع `assistant_link_status`/`technician_type` من زمان بس الـDart model مكانش بيقراهم، ومفيش شاشة لطلب/فك الربط خالص. `ProfileScreen` جديدة (`lib/features/profile/`) بكارت نوع الفني + كارت طلب/فك ربط المساعد. اتأكد حي end-to-end: فك ربط → طلب ربط جديد (`pending_approval`) → موافقة أدمن حقيقية (`approved`) — رجعت لنفس الحالة الأصلية. تفاصيل في `apps/technician-app/README.md`. |
| 14 | واجهة الشركة/الفريق (Technician) | ✅ خلص | API كامل (إنشاء/فروع/أعضاء/نقل ملكية) كان موجود ومختبر حي في الباك-إند من زمان بصفر شاشة تستخدمه. `CompanyScreen` جديدة (`lib/features/company/`) — فورم إنشاء لو `GET /technician/company` رجّع `404`، تفاصيل شركة (فروع/أعضاء) لو موجودة، فورمات إضافة/تعديل تظهر بس لـ`owner`/`manager` (الدور محسوب من `staff` array نفسها). اتأكد حي end-to-end: إضافة فرع، تغيير دور عضو، حذف/إعادة إضافة عضو، ورفض `403` لعضو `worker` بيحاول يدير — كل الأفعال بنفس رسائل الباك-إند بالحرف. تفاصيل في `apps/technician-app/README.md`. |
| 15 | تحديث لحظي بعد قرار عرض السعر | ✅ خلص | كانت فجوة حقيقية مؤكّدة: العميل بيوافق/يرفض عرض السعر (`order-items.service.ts`) وبيوصل للفني إشعار push/in-app بس — شاشة تنفيذ الطلب المفتوحة فعلاً عند الفني كانت بتفضل عارضة `awaiting_quote_approval` القديمة لحد ما يخرج ويرجع يدوي. أضفنا `OrderTrackingGateway.handleOrderStatusChanged()` (`@OnEvent(ORDER_STATUS_CHANGED_EVENT)`) بيبث `order:status_changed` عام (أي تغيير حالة، مش خاص بعرض السعر بس) لنفس غرفة `order:${orderId}` بتاعة تتبع الموقع الموجودة أصلاً — `TechnicianTrackingClient` بقى بينضم لنفس الغرفة (زي العميل بالظبط) ويستقبل الحدث، و`OrderExecutionScreen._refreshFromServer()` جديدة بتجيب أحدث نسخة من الطلب (`OrdersRepository.getOne()` جديدة — مكانتش موجودة خالص في technician-app). اتأكد حي عبر socket.io-client مباشر (Node): فني حقيقي اتصل وانضم لغرفة طلب حقيقي، اقترح عرض سعر (`in_progress→awaiting_quote_approval`) — **الحدث وصل فورًا عبر الـwebsocket بنفس القيم بالظبط**، والعميل وافق عليه فعليًا بعد كده (`awaiting_quote_approval→in_progress`, إجمالي زاد صح). أرصدة المحافظ اترجعت للحالة الأصلية بعد الاختبار. **قيد متبقٍ موثّق**: لو الفني قفل وفتح التطبيق تاني وهو بالظبط في `awaiting_quote_approval` (مش `in_progress`)، الاتصال مش هيحصل لأن الحالة دي مش ضمن `_activeTrackingStatuses` (نفس نطاق تتبع الموقع بالظبط) — نفس القيد الموجود من زمان لتتبّع الموقع، مش تراجع جديد. تفاصيل في `apps/api/src/modules/orders/README.md` و`apps/technician-app/README.md`. |

### Phase C — الاحتفاظ (Retention)

| # | البند | الحالة | ملاحظات |
|---|-------|--------|---------|
| 16 | واجهة الطلبات المتكررة (Customer) | ✅ خلص | API كامل كان موجود ومختبر حي في الباك-إند من زمان بصفر شاشة تستخدمه. `RecurringOrdersScreen` جديدة (إنشاء/عرض/إيقاف/استئناف/حذف). **بَقّة حقيقية اتلقطت واتصلحت أثناء البناء**: `RecurringOrdersService.create()` مكانش بيتحقق من `booking_mode` مقابل قدرات الخدمة خالص — قوالب معطوبة كانت بتتقبل وتفشل بصمت للأبد. الإصلاح جانب الباك-إند + جانب الواجهة (اشتقاق تلقائي للوضع الصحيح). اتأكد حي end-to-end: الفحص الدوري الحقيقي ولّد طلب فعلي من قالب مستحق. تفاصيل في `apps/customer-app/README.md` و`apps/api/src/modules/orders/README.md`. |
| 17 | واجهة الولاء (Loyalty) | ✅ خلص | `GET/POST /loyalty/*` كانت شغالة ومختبرة في الباك-إند من زمان بصفر شاشة تستخدمها. `LoyaltyScreen` جديدة — كارت رصيد + استبدال + سجل معاملات. اتأكد حي: استبدال حقيقي نقص الرصيد فورًا، رفض استبدال أكتر من الرصيد المتاح. تفاصيل في `apps/customer-app/README.md`. |
| 18 | صندوق إشعارات داخل التطبيق (عميل + فني) | ✅ خلص | `GET/PATCH /notifications/*` كانت شغالة ومختبرة في الباك-إند من زمان بصفر شاشة تستخدمها في أي من التطبيقين. `NotificationsScreen` جديدة (نفس الكود في الاتنين، مكرر عمدًا) — قايمة + تعليم مقروء فردي/جماعي + Badge حي بعدد غير المقروء. اتأكد حي للعميل (76 إشعار) وللفني (12 إشعار). تفاصيل في `apps/customer-app/README.md` و`apps/technician-app/README.md`. |
| 19 | حساب/سجل عميل موحّد | ✅ خلص | تجميع واجهة بحت، صفر backend جديد. `AccountScreen` جديدة تجمع طلبات/عناوين/ولاء/متكررة/ترشيح اللي كانت متبعثرة في أيقونات `AppBar` منفصلة. `BookingModeScreen` اتنضّف من 6 أيقونات لـ4. تفاصيل في `apps/customer-app/README.md`. |

### Phase D — Verticals إضافية

| # | البند | الحالة | ملاحظات |
|---|-------|--------|---------|
| 20 | Buildings — Admin + Customer/QR | ✅ خلص | كان API الأدمن الكامل (إنشاء/تعديل/QR) موجود ومختبر من زمان بصفر شاشة، وجانب العميل (`building_code` في `POST /orders`) مكانش مستخدم خالص. `/buildings` admin page جديدة كاملة + حقل "كود عمارة" في `CreateOrderScreen`. مسح QR بالكاميرا مؤجّل عمدًا (نفس قرار GPS اليدوي — مفيش جهاز حقيقي للاختبار)، إدخال يدوي بس. اتأكد حي: عمارة حقيقية بخصم 15%، معاينة/طلب حقيقيين طابقوا الحساب، ورفض واضح لكود غلط أو تضارب مع promo_code. تفاصيل في `apps/admin/README.md` و`apps/customer-app/README.md`. |
| 21 | Domestic Worker — Customer (تصفّح/حجز) | ✅ خلص | `DomesticWorkersScreen`/`WorkerDetailScreen`/`WorkerBookingsScreen` جداد في apps/customer-app. اتأكد حي: تصفّح، حجز حقيقي (سعر مطابق تمامًا لمعادلة الباك-إند)، إلغاء. تفاصيل في `apps/customer-app/README.md`. |
| 22 | Domestic Worker — عامل (self-service) | ✅ خلص | القرار المعماري (ADR-0005): امتداد لـ`apps/technician-app` بدل تطبيق Flutter رابع — استُشير فيه المالك صراحة. `WorkerHomeScreen` جديدة + تفرّع `main.dart` حسب `user_type` + `SegmentedButton` لاختيار نوع الحساب وقت التسجيل. اتأكد حي end-to-end كامل: تسجيل شغالة حقيقي → بروفايل → اعتماد أدمن → حجز عميل → تأكيد (دفع حقيقي) → إكمال. تفاصيل في `apps/technician-app/README.md` و`docs/adr/0005-domestic-worker-portal-extends-technician-app.md`. |
| 23 | Domestic Worker — Admin (مراجعة) | ✅ خلص | `/domestic-workers` admin page جديدة (فلتر حالة + اعتماد/رفض). اتأكد حي عبر Playwright: تسجيل مقدّم خدمة حقيقي، ظهر pending، اعتماده نجح. تفاصيل في `apps/admin/README.md`. |

### قايمة Admin UI منفصلة (من نفس القايمة، مرقّمة تانية في رسالة المالك)

| البند | الحالة |
|---|---|
| 28. Pricing Engine Visual Builder | ✅ خلص (نفس #1) |
| 29. Certificate Review UI (Admin) | ✅ خلص (نفس #9) |
| 30. Buildings Admin UI | ✅ خلص (نفس #20) |
| 31. Domestic Workers Admin UI | ✅ خلص (نفس #23) |

### P2 — مفيد مش عائق إطلاق

| البند | الحالة |
|---|---|
| 32. وضوح الطلبات المتكررة في Admin | ✅ خلص | `recurring_order_templates` كانت بتولّد طلبات حقيقية كل موعد (`RecurringOrdersService.sweep()`، فحص دوري كل دقيقة) من غير أي مسار أدمن يشوفها خالص — لو قالب اتعطّل بصمت (مثلاً الخدمة اتلغت، `generateFromTemplate()` بتمسك الفشل وتسجّله بس وتحرّك `next_run_at` قدّام للأبد) محدش هيعرف غير لو دوّر في الداتابيز مباشرة. أضفنا `GET /admin/recurring-orders` (فلترة `is_active`، صفحات) + `RecurringOrdersService.listAllForAdmin()` + `AdminRecurringTemplateResponseDto` (زي نسخة العميل + `customer_id`) + شاشة جديدة `/recurring-orders` (جدول: العميل/الخدمة/التكرار/وضع الحجز/الموعد الجاي/رابط آخر طلب اتولّد/الحالة + فلتر نشطة/موقوفة). اتأكد حي: قالب متكرر حقيقي (`monthly`, `individual`) اتعمل من عميل حقيقي → ظهر فورًا في `GET /admin/recurring-orders` بكل الحقول مطابقة (`customer_id` صحيح، فلتر `is_active=true/false` شغّال صح) → Playwright أكّد ظهوره في الشاشة (سكرين شوت). القالب والخدمة التجريبية اتشالوا (soft-delete) بعد الاختبار. تفاصيل في `apps/api/src/modules/orders/README.md` و`apps/admin/README.md`. |
| 33. وضوح الضمان/إعادة الزيارة في Admin | ✅ خلص | نفس إصلاح #32/#34 (`OrderResponseDto` الناقص) — تاريخ الضمان + بادچ "إعادة زيارة" بقى رابط فعلي للطلب الأصلي. اتأكد حي عبر Playwright. تفاصيل في `apps/admin/README.md`. |
| 34. معلومات الطوارئ واضحة في كل مكان | ✅ خلص | `OrderResponseDto` في shared-types كان ناقص 7 حقول موجودة في رد الباك-إند فعليًا (`booking_mode`/`surge_amount_cents`/`warranty_expires_at`/إلخ). اتضافوا + بادچات/عرض في `/orders` و`/orders/:id`. اتأكد حي عبر Playwright على طلب طوارئ حقيقي. تفاصيل في `apps/admin/README.md`. |
| 35. وضوح الإنتاجية/المدة المتوقعة للعمليات | ✅ خلص | كانت مبنية بس على مستوى إعداد الخدمة (catalog/services/:id: بيانات قياسية + إنتاجية)، مفيش أي مكان بيوضّح المدة/الطاقم *المحسوبة فعليًا* لطلب حقيقي معيّن. لقينا `service_pricing_evaluations` (جدول تدقيق موجود من زمان، `computed_duration_days`/`computed_technicians`/`computed_assistants`، مربوط بـ`order_id`) بيتسجّل وقت كل حجز لخدمة `pricing_model=formula` بس محدش بيعرضه لحد دلوقتي. أضفنا `PricingEngineService.findEvaluationForOrder()` + `GET /admin/orders/:id` بقى بيرجّع `pricing_evaluation` (null لو الخدمة مش formula). كارت جديد "الإنتاجية والمدة المتوقعة" في `/orders/:id`. اتأكد حي: خدمة formula تجريبية بمعادلة literal (مدة=2.5 يوم، صنايعية=2، مساعدين=1) → طلب حقيقي → Admin API رجّعت نفس القيم بالظبط → Playwright أكّد ظهورها في الكارت فعليًا (سكرين شوت). الخدمة التجريبية اتشالت (soft-delete) بعد الاختبار. تفاصيل في `apps/api/src/modules/orders/README.md` و`apps/admin/README.md`. |

### ⏸️ مؤجّل عمداً — backlog منفصل، مش جزء من مرحلة التكامل دي (بطلب صريح من المالك)

36. ~~المفضّلة (Favorites) — مش موجودة خالص.~~ **✅ خلصت (2026-08-13)** — تفاصيل في سجل التقدّم تحت وفي `apps/api/src/modules/favorites/README.md`.
37. ~~تفضيلات إشعارات المستخدم (قنوات).~~ **✅ خلصت (2026-08-13)** — تفاصيل في سجل التقدّم تحت وفي `apps/api/src/modules/notifications/README.md`.
38. تعويض تأخير تلقائي.
39. QR ترشيح خاص بالفني.
40. ~~طلب مراجعة Google/مشاركة.~~ **✅ خلصت (2026-08-13)** — تفاصيل في سجل التقدّم تحت وفي `apps/api/src/modules/ratings/README.md`.
41. نظام أكاديمية/تدريب كامل (Applicant→Trainee→Trainer→Course→...) — **مختلف تمامًا عن `technician_certificates` الموجودة**. المالك صرّح: "ده إحنا هنعمله ولكن ما تركزش عليه دلوقتي... حاول تخليه في الآخر أو بس تعمله base كده". هيتحط كـschema أساسي في آخر المرحلة دي لو فيه وقت، مش أولوية.
42. محرك التطور الوظيفي (Career/Workforce).
43. باني أدوار ديناميكي (No-code RBAC builder).

---

## سياسة إلغاء الفني (Technician Cancellation Policy) — الطلب التفصيلي الكامل

**الحالة العامة**: ✅ خلص بالكامل (سيشن جديدة، فرع `v13gb2` بعد الدمج مع `hgotr7` — 2026-08-12). السيشن اللي بدأت
البناء وصلت لحد الاختبار الحي واتقطعت (limit) قبل أي commit — الشغل اتعاد بناؤه من الصفر (مش استرجاع) لأن
التغييرات مكانتش متسجّلة في git خالص. التفاصيل الكاملة (السياسة/الأحداث/الجداول/الاختبار الحي) في
`apps/api/src/modules/orders/README.md` § سياسة إلغاء الفني، وملخّص في `apps/api/src/modules/matching/README.md`
و`apps/api/src/modules/notifications/README.md` و`apps/technician-app/README.md` و`apps/customer-app/README.md`
و`apps/admin/README.md`.

**ملخّص سريع لما اتبنى**: migrations 0068-0071 (حالة طلب جديدة `awaiting_technician_reselection`، جدول
`technician_order_cancellations` مخصوص، عمود `cancellation_reasons.requires_free_text`، 5 إعدادات
`group_name='cancellation'`، قاعدة توجيه أدمن افتراضية). `OrdersService.technicianCancel()` أعيد بناؤها بالكامل:
فحص نافذة زمنية موحّد (استشاري + فرض حقيقي من نفس الدالة)، صلاحيات فريق (`team_role=worker` ممنوع إلا بإعداد
صريح)، سبب إجباري + نص حر شرطي، وسلوك استرجاع مبني على 3 قواعد (طوارئ=دايمًا auto-rematch، اختيار العميل
الصريح=دايمًا manual-reselection، غير كده=حسب إعداد). الطلب **ميتلغيش نهائي أبدًا** من فعل الفني — إما
`searching_technician` (استبعاد الفني اللي لغى تلقائيًا عبر `order_assignments` الموجودة أصلاً) أو
`awaiting_technician_reselection` (endpoint جديد للعميل `POST /orders/:id/request-rematch`). قفل ذرّي
(`pessimistic_write`) في الاتنين — مفيش إلغاء مزدوج ولا سباق. اتعمله اختبار حي كامل (curl) لكل السيناريوهات
المطلوبة صراحة: نافذة مفتوحة/مقفولة، طوارئ، اختيار عميل صريح، طلب إعادة مطابقة (بث/فني محدد)، عضو فريق غير
مصرّح، إلغاء مكرر (409)، سبب "أخرى" بلا نص حر. UI كامل في التطبيقين + كارت أدمن جديد (Playwright مؤكّد).

**نطاق مؤجّل عمداً، موثّق صراحة**: نافذة زمنية موحّدة لكل الـbooking modes (مش قيمة منفصلة لكل مود) —
قرار متعمّد لتجنّب اختراع أرقام تجريبية إضافية مالهاش أساس؛ إضافتها لاحقًا تافهة (مجرد قراءة إعداد مختلف
حسب `booking_mode`). محرك عقوبة/تصعيد تلقائي مستقبلي (سمعة، منع مؤقت) — الجدول الجديد (`technician_order_cancellations`)
هو البنية التحتية الكافية له (استعلام مباشر)، مفيش سكيما إضافية أو منطق مبني فوقه دلوقتي.

### المتطلبات (ملخّص من رسالة المالك، بالإنجليزي الأصلي محفوظ في المحادثة):

- **إعدادات Admin/Super Admin تتحكم في**: تفعيل/تعطيل إلغاء الفني الذاتي، نافذة زمنية مسموحة بعد القبول (دقايق)،
  حد أدنى قبل موعد البدء المجدول يمنع الإلغاء بعده، سلوك مختلف حسب booking_mode، بنية جاهزة لعقوبات/تصعيد
  مستقبلية (مش مبالغ hardcoded).
- **Technician App**: زرار الإلغاء يظهر بس لو السياسة تسمح، مفيش إلغاء بضغطة واحدة (تأكيد نهائي)، سبب إجباري
  (كود + نص حر)، النص الحر إجباري لو السبب "أخرى"، شاشة تأكيد أخيرة.
- **الحفظ**: `cancelled_by=technician`, معرّف المستخدم/الفني, كود السبب, نص السبب, `cancelled_at`, `accepted_at`,
  الوقت المنقضي بعد القبول, هل الإلغاء جوّه نافذة السياسة المسموحة, معرّفات الطلب, حدث audit كامل.
- **عند الإلغاء**:
  1. **العميل**: إشعار فوري عالي الأولوية بسبب آمن للعميل + deep link لإعادة الاختيار.
  2. **الأدمن**: يظهر فورًا في شاشات العمليات/الـaudit بكل التفاصيل.
  3. **سلوك استرجاع الطلب** — يختلف حسب `booking_mode`:
     - **EMERGENCY**: الطلب **ما يتلغيش** — يرجع فورًا للمطابقة، استبعاد الفني اللي لغى من محاولة إعادة التوزيع
       دي، إشعار العميل إن إعادة المطابقة شغالة.
     - **AUTO-MATCH (فرد)**: تفضيل إعادة مطابقة تلقائية بنفس المبدأ، حسب سياسة قابلة للإعداد.
     - **MANUAL/اختيار فني محدد**: التعيين الأصلي يتلغي، الطلب يتحول لحالة "يحتاج إعادة اختيار فني"، العميل
       ياخد deep link لقايمة فنيين بديلة مفلترة لنفس الخدمة/العنوان/الموعد. **مفيش تعيين فني تاني صامت** إلا لو
       سياسة/إعداد صريح بيسمح.
     - **TEAM/COMPANY**: احترام صلاحيات الليدر/المدير الموجودة — فني عادي في الفريق ميقدرش يلغي الطلب كله إلا
       لو الباك-إند بيصرّح بكده صراحة.
  - لو الفني برّه النافذة الزمنية: منع الإلغاء المباشر، توجيهه للدعم/طلب إلغاء إداري، **الباك-إند لازم يفرض
    ده بغض النظر عن الواجهة**.
- **الإلغاء لازم يحرر/يحافظ بأمان على**: سلوت الجدولة، تعيين المطابقة، أعضاء الفريق، عروض الأسعار، حجز/تفويض
  الدفع — حسب حالة الطلب الحالية والمنطق الموجود.
- **مفيش إلغاء مزدوج ولا سباق ممكن يحصل.**
- **اختبارات سلبية وحية مطلوبة**: إلغاء جوّه/برّه النافذة، إعادة مطابقة تلقائية للطوارئ، إعادة اختيار يدوي،
  عضو فريق غير مصرّح له، إلغاء مكرر، سباق إلغاء/قبول/إعادة مطابقة متزامن، توصيل إشعار العميل/الأدمن.

---

## سجل التقدّم

- **2026-08-12 (بداية المرحلة، فرع `hgotr7`)**: الملف اتعمل، القايمة الكاملة اتسجّلت بحالتها الأولية بعد فحص سريع
  لآخر merge (PR #66). البدء الفعلي حسب توجيه المالك الصريح: "Start with Pricing Engine end-to-end".
- **2026-08-12 (بند #1 خلص)**: `PricingModel` كان ناقص `'formula'` في `packages/shared-types` (كان بيمنع الأدمن من
  إنشاء خدمة formula من الواجهة أصلاً). اتضاف type جديد `packages/shared-types/src/pricing.ts` (مطابق لـDTOs
  الباك-إند بالكامل: `PricingFieldType`, `FormulaNode`, `PricingRuleType`, ...). اتبنى `PricingBuilder` component
  كامل في `apps/admin` (حقول ديناميكية + ثوابت + lookup tables + محرر معادلة JSON + معاينة حية). اتضاف
  `PricingEngineService.linkEvaluationToOrder()` + استدعاؤه من `OrdersService.create()` بعد الـtransaction —
  بيقفل فجوة تتبّع السعر التاريخي المطلوبة صراحة. اتأكد حي بالكامل: Playwright end-to-end على الواجهة الحقيقية
  (تسجيل دخول أدمن → إنشاء خدمة → حقول → lookup table → معادلة → معاينة صح `14.00 ج.م.`)، وطلب حقيقي عبر `curl`
  بنفس القيم رجع `estimated_price_cents:1400` مطابق تمامًا، وDB query أكّد `service_pricing_evaluations.order_id`
  اتربط صح (مش NULL) بعد الطلب بينما صف الـpreview فضل NULL صح. بيانات الاختبار (خدمة+طلب) اتعملها soft-delete
  بعد التأكيد. الفحوصات الثلاثة (`tsc`/`nest build`/`jest`) + `tsc`/`eslint`/`next build` في `apps/admin` كلها
  عدّت. البند #2 (breakdown كامل للسعر في Customer App قبل التأكيد) لسه منفصل وقائم — مش جزء من هذا الإغلاق.

- **2026-08-12 (بند #2 خلص، وجزء من #7)**: `POST /orders/preview` جديد في `orders` module (`OrdersService.previewPrice()`) —
  read-only بالكامل، بيكرر بالحرف نفس تسلسل تحديد المنطقة/حساب السعر في `create()` (نفس `estimate()`، نفس
  addons، نفس `promoCodesService.preview()`/خصم العمارة). `CreateOrderScreen` (customer-app) اتعمله rewrite
  جزئي: مصدر واحد بس (`_refreshPreview()`) لكل نماذج التسعير بدل `evaluatePrice()`/`validatePromoCode()`
  المنفصلين اللي كل واحد كان بيعرض جزء بس من الصورة — الاتنين اتشالوا من `catalog_repository.dart`/
  `orders_repository.dart` بعد ما بقوا بلا caller. بطاقة "ملخص السعر" جديدة بتعرض كل بند منفصل (أساسي/فحص/
  طوارئ+SLA/إضافات/خصم/نطاق formula/مدة متوقعة/إجمالي)، مربوطة بعنوان+إضافات+حقول formula+كود خصم، مع حماية
  race حقيقية (`_previewRequestGeneration` counter) ضد نتيجة قديمة تكتب فوق نتيجة أحدث. التأكيد (`_submit()`)
  بقى ممنوع من غير `_pricePreview` محسوب فعلاً — مفيش تأكيد أعمى لأي نموذج تسعير. فجوة تانية أصغر اتقفلت في
  نفس البناء: `POST /services/:id/estimate` (endpoint أقدم بـ`zone_id`) كان بيتجاهل `field_values` تمامًا.
  اتأكد حي بالكامل عبر `curl` (معاينة = طلب حقيقي بالحرف لخدمة `fixed` وخدمة `formula` جديدتين، شامل
  `estimated_duration_days` من معادلة formula) + حالات سلبية (بلا عنوان/توكن/كود خصم وهمي). الفحوصات الثلاثة
  في `apps/api` عدّت. **ملحوظة صريحة**: Flutter SDK مش متاح في بيئة السيشن دي (خلافًا لما هو موثّق فوق في
  الملف ده لسيشنز تانية) — الكود اتراجع يدويًا بعناية (توازن أقواس + تتبّع كل import/type) بدل `flutter
  analyze`/`flutter test`، ومنطق الـHTTP اللي الشاشة بتستخدمه اتأكد حي عبر curl بنفس البيانات بالظبط. رندر
  الـwidgets الفعلي وتفاعل اللمس **لسه مش مُتحقَّق منه بصريًا** في السيشن دي — لو سيشن تانية عندها Flutter
  SDK متاح، تشغيل `flutter analyze` + `flutter test test_live/pricing_engine_order_creation_live_test.dart`
  مطلوب كخطوة تحقق إضافية.

- **2026-08-12 (بند #4 خلص)**: `TechnicianSelectionScreen` جديدة — تفاصيل كاملة في
  `apps/api/src/modules/technicians/README.md`. نفس الملحوظة بتاعة عدم توفّر Flutter SDK في بيئة السيشن دي
  تنطبق هنا كمان — الـendpoint اللي الشاشة بتستخدمه (`GET /services/:id/technicians`) اتأكد حي عبر curl
  إنه بيرجّع نفس الشكل بالظبط اللي الموديل الجديد `TechnicianBookingListItem` بيتوقعه، بس رندر الشاشة
  نفسها بصريًا لسه محتاج `flutter analyze`/تشغيل فعلي من سيشن عندها Flutter SDK.

- **2026-08-12 (بند #5 خلص)**: `LoginScreen` بقت فيها مود تسجيل جديد كامل + اقتراح تلقائي عند محاولة دخول
  برقم مش مسجّل. تفاصيل كاملة في `apps/customer-app/README.md`. اتأكد حي بالكامل عبر curl (تسجيل ناجح،
  رفض تسجيل مكرر، رفض دخول غير مسجّل بالرسالة المتوقعة بالحرف، كود ترشيح اتسجّل صح في الداتابيز). نفس
  ملحوظة عدم توفّر Flutter SDK تنطبق — الكود اتراجع يدويًا، و`test/widget_test.dart` الموجود (بيتأكد إن
  شاشة تسجيل الدخول بتظهر + نص "ابعت كود التحقق") لسه المفروض يعدّي لأن السلوك الافتراضي (login mode) لم
  يتغيّر — يحتاج تشغيل فعلي من سيشن عندها Flutter SDK للتأكيد.

- **2026-08-12 (بند #6 خلص)**: `OnboardingScreen` جديدة في `apps/technician-app` (`features/onboarding/`) +
  `_VerificationGate` في `main.dart`. تفاصيل كاملة في `apps/api/src/modules/technicians/README.md` و
  `apps/technician-app/README.md`. اتأكد حي بالكامل عبر curl بعد ما اضطريت أعيد تشغيل Postgres/Redis/API
  (الحاوية اتعمل لها restart أثناء الشغل — البيانات والـgit commits السابقة اتأكد إنها فضلت سليمة، الخدمات
  بس اللي كانت واقفة): تسجيل فني جديد → `verification_status:"pending"` فورًا، رفع مستند PNG حقيقي عبر
  multipart → نجح ورجع بالشكل المتوقع بالحرف، القايمة رجّعت المستند بعد كده. بيانات الاختبار اتعملها
  حذف/soft-delete بعد التأكيد.

- **2026-08-12 (بند #7 خلص بالكامل)**: `GET /services/:id/standard-data` جديد + قسم "المدة المتوقعة"
  في `CreateOrderScreen` لخدمات غير formula. تفاصيل كاملة في `apps/api/src/modules/catalog/README.md`.
  اتأكد حي بالكامل عبر curl على خدمة "سباكة بيت كامل" الحقيقية (صفّين standard_data فعليين) — قايمة
  الأنواع + حساب مدة صح + حالات سلبية (خدمة تانية/قايمة فاضية). الفحوصات الثلاثة في apps/api عدّت
  (`tsc`/`nest build`/`jest`). نفس ملحوظة عدم توفّر Flutter SDK تنطبق على الكود Dart.

- **2026-08-12 (بند #8 خلص)**: `TechnicianCertificate` model جديد + حقلين ناقصين (`avgArrivalMinutes`/
  `avgCompletionMinutes`) اتضافوا لـ`TechnicianPublicProfile` في `apps/customer-app`. `TechnicianProfileScreen`
  بقى بيعرض التلاتة. اتأكد حي بالكامل عبر curl (رفع شهادة حقيقي → موافقة أدمن → ظهور في البروفايل العام
  بالحقول المتوقعة بالحرف). بيانات الاختبار اتعملها حذف بعد التأكيد.

- **2026-08-12 (بند #9/#29 خلص)**: كارت "الشهادات" جديد في `apps/admin/src/app/technicians/[id]/page.tsx`
  (نفس نمط كارت "المستندات" بالحرف) + `certificates` اتضاف لـ`AdminTechnicianDetailResponseDto`
  (backend + shared-types). تفاصيل كاملة في `apps/api/src/modules/technicians/README.md`. اتأكد حي
  بالكامل عبر Playwright حقيقي: فني رفع شهادة، ظهرت pending في تفاصيل الفني بالأدمن، ضغط "اعتماد"
  فعلي في المتصفح غيّر الحالة لـ"معتمدة" فورًا (screenshot). الفحوصات الثلاثة في apps/api +
  tsc/eslint في apps/admin + shared-types build كلها عدّت. بيانات الاختبار اتعملها حذف بعد التأكيد.

- **2026-08-12 (سياسة إلغاء الفني — الباك-إند الأساسي خلص، ADR-0006، فرع `hgotr7`)** — **ملحوظة دمج
  (2026-08-13)**: النسخة دي كانت أول محاولة (باك-إند بس، مسار الفرد/الأوتوماتيك فقط)، اتبنت بمعزل في
  نفس الوقت اللي سيشن تانية على فرع `v13gb2` كانت بتبني نسخة أشمل وأكمل لنفس الميزة بالظبط (تحت). وقت
  دمج الفرعين اتأكد إن نسخة `v13gb2` (تحت، "سياسة إلغاء الفني خلصت end-to-end") بتغطي كل حاجة هنا وأكتر
  (UI كامل، جدول تدقيق مخصوص، اختبار حي أشمل) — فهي اللي اتحافظ عليها في الكود، والنسخة دي (ADR-0006)
  فضلت موثّقة هنا كسجل تاريخي بس:
  `docs/adr/0006-technician-cancellation-policy.md`
  كامل (السياق/القرار/البدائل/الأثر) قبل أي كود، زي ما CLAUDE.md بيطلب لأي قرار معماري كبير.
  Migration `0068`: `order_status` قيمة جديدة `needs_technician_reselection` + `cancellation_reasons.requires_free_text`
  + 6 إعدادات `technician_cancellation.*` (نافذة زمنية بعد القبول، حد أدنى قبل الموعد المجدول،
  auto-rematch للفرد/الطوارئ، auto-rematch للفريق/التعيين اليدوي — كل واحدة قابلة للتعديل من
  `/admin/settings` بلا كود جديد). `OrdersService.technicianCancel()` اتعمله rewrite كامل: يفرض
  النافذة الزمنية والحد الأدنى قبل الموعد (`ORDR_003` واضح لو اتخطّاهم)، سبب إجباري من القائمة
  المُعدّة إداريًا + نص حر إجباري لو `requires_free_text`، وسلوك استرجاع مختلف حسب `booking_mode`:
  فرد/طوارئ يرجع `searching_technician` تلقائيًا (بث `ORDER_CREATED_EVENT` نفسه اللي `OrderDispatchListener`
  الموجود بيسمعه، مفيش محرك مطابقة جديد)، بينما "اعتماد"/تعيين يدوي من الإدارة (مُكتشف من `booking_mode=team`
  أو بصمة `order_status_history` بتاعة `AdminOrdersService.reassign()` — مفيش عمود جديد) بيتحول
  `needs_technician_reselection` بدل إعادة توزيع صامتة. `POST /orders/:id/request-rematch` جديد
  (العميل، تفضيل فني اختياري) يرجّع الطلب لـ`searching_technician`. حدث audit كامل عبر `AuditLogService`
  الموجودة (accepted_at/elapsed_minutes/within_window/booking_mode/rematch_behavior) — مفيش أعمدة
  جديدة للتدقيق. **اتعمله اختبار حي كامل لمسار الفرد/الأوتوماتيك**: فني حقيقي قبل طلب `individual`،
  محاولة إلغاء بسبب `requires_free_text=true` من غير نص اترفضت `VAL_001`، محاولة من غير
  `cancellation_reason_id` اترفضت (بقى إجباري)، الإلغاء الفعلي نجح (`cancellation_fee_cents` صح)
  ورجّع الطلب `searching_technician` فورًا، `ORDER_CREATED_EVENT` اشتغل تلقائيًا وأعاد المطابقة
  (الفني اللي لغى مستبعد صح — مفيش فنيين تانيين متاحين فالطلب اتلغى نظاميًا `ORDR_002`، سلوك متوقع).
  صف `audit_logs` تأكد فيه كل الحقول المطلوبة صراحة. أرصدة المحافظ اترجعت للحالة الأصلية بعد الاختبار.
  الفحوصات الثلاثة (`tsc`/`nest build`/`jest`) عدّت.
  **لسه من غير — موثّق صراحة، مش سهو**: (أ) اختبار حي لمسار "اعتماد"/التعيين اليدوي
  (`needs_technician_reselection` + `request-rematch`) — الكود مكتوب ومبني بس مش مُختبر حي لسه.
  (ب) `apps/technician-app`: زرار الإلغاء الحالي (`OrderExecutionScreen`) لسه بيستخدم DTO القديم
  (`cancellation_reason_id` اختياري) — محتاج تحديث ليطابق الإجبارية الجديدة + إظهار/إخفاء الزرار
  حسب النافذة الزمنية + رسالة تأكيد نهائية. (ج) `apps/customer-app`: مفيش أي UI لحالة
  `needs_technician_reselection` ولا زرار "أعد المطابقة" (`request-rematch`) لسه. (د) قائد/مدير
  الفريق يلغي نيابة عن عضو تاني — مؤجَّل عمدًا في الـADR نفسه (محتاج قرار عمل). (هـ) اختبارات
  النافذة الزمنية/الحد الأدنى قبل الموعد مكتوبة ومنطقها صحيح بس مش مُختبرة حي (تحتاج تلاعب بـ
  `accepted_at`/`scheduled_at` في الداتابيز لمحاكاة الوقت، أو `sleep` فعلي). تفاصيل كاملة في
  `apps/api/src/modules/orders/README.md`.

- **2026-08-12 (سيشن جديدة — دمج الفرعين + إكمال قايمة #1-35 والتأكد من صحتها + سياسة إلغاء الفني)**:
  السيشن دي بدأت بدمج `claude/home-repair-company-project-hgotr7` (110 commit، البنود كلها فوق) جوّه
  `claude/home-services-app-plan-v13gb2` (fast-forward نضيف، الفرعين ما اختلفوش). أول تحقق حقيقي: السيشن
  اللي بنت أغلب البنود دي معندهاش Flutter SDK في بيئتها (موثّق صراحة في الملاحظات فوق) — أول
  `flutter analyze`/`flutter test` حقيقي في بيئة فيها SDK كشف بَقّتين حقيقيتين صغيرتين (مش أخطاء compile،
  كودها كان سليم فعلاً): `rating_dialog.dart` null-check زيادة، و`recurring_orders_screen.dart` كانت
  بتحدّث `_acting` (loading state) بس مش بتقراه — تكرار ضغط زرار كان يقدر يبعت طلبين متزامنين لنفس
  القالب. الاتنين اتصلحوا، الفحوصات الأربعة (backend tsc/build/jest، admin tsc/next-build، Flutter
  analyze/test في التطبيقين) عدّت كلها نضيف. بعد كده: سياسة إلغاء الفني الكاملة (تفاصيلها فوق).

- **2026-08-12 (سياسة إلغاء الفني خلصت end-to-end)**: migrations 0068-0071، `OrdersService.technicianCancel()`
  إعادة بناء كاملة، `OrdersService.getTechnicianCancellationPolicy()`/`requestRematch()` جداد، جدول
  `technician_order_cancellations`، حالة طلب `awaiting_technician_reselection`، `OrderRematchListener`
  (matching)، `TechnicianCancellationNotificationListener` (notifications)، UI كامل في التطبيقين +
  كارت أدمن. اتأكد حي بالكامل عبر curl لكل سيناريوهات المالك المطلوبة صراحة (تفاصيل الأرقام والنتائج
  الكاملة في `apps/api/src/modules/orders/README.md`)، وPlaywright للأدمن. الفحوصات الثلاثة في apps/api +
  tsc/next-build في apps/admin + flutter analyze/test في التطبيقين كلها عدّت. بيانات الاختبار (أسباب
  إلغاء تجريبية، إعدادات مؤقتة، أدوار فنيين تجريبية) اترجعت لحالتها الأصلية بعد التأكيد.

- **2026-08-12 (تقفيل فجوة صغيرة من سياسة إلغاء الفني — استبعاد الفني من قايمة إعادة الاختيار)**:
  `GET /services/:id/technicians` بقى ليه `exclude_technician_id` اختياري، و`order.requestedTechnicianId`
  بقى متسرّب للعميل ومتسيّب عمدًا بعد إلغاء فني في مسار `MANUAL_RESELECTION_REQUIRED` عشان يبقى مصدر
  قيمة الاستبعاد دي في `apps/customer-app`. اتأكد حي عبر curl ضد Postgres حقيقي (فني اتربط مؤقتًا بمنطقة
  ليها geo boundary حقيقي، عميل وعنوان جداد اتعملوا، القايمة اتفحصت قبل/بعد الاستبعاد + رفض UUID غلط) —
  تفاصيل كاملة في `apps/api/src/modules/orders/README.md`. الفحوصات الأربعة كلها عدّت.

- **2026-08-13 (دمج `main` جوّه فرع `hgotr7` — تعارض حقيقي، اتحل يدويًا)**: فرع `hgotr7` (بعد ما اتأكد
  إن آخر 3 commits عليه — سياسة إلغاء الفني ADR-0006، إنتاجية الفريق/مضاعف مستوى الفني، مطابقة المساعد
  التلقائية ADR-0007 — مش متدمجين في `main` لسه) اتعمله `git merge origin/main` صريح. التعارض الحقيقي
  الوحيد: **سياسة إلغاء الفني اتبنت مرتين بمعزل** (هنا بـADR-0006 باك-إند بس، وفي `main` عبر فرع
  `v13gb2` نسخة أشمل وكاملة UI) — migrations بنفس الأرقام (`0068`) بمحتوى مختلف، وحالة `order_status`
  بأسماء مختلفة (`needs_technician_reselection` هنا مقابل `awaiting_technician_reselection` في `main`).
  اتحل بإسقاط نسخة `hgotr7` بالكامل (باك-إند بس، مش مُختبرة UI) والإبقاء على نسخة `main` (أشمل، UI
  كامل، مُختبرة حي بالكامل) كمصدر الحقيقة الوحيد — `migration 0068_technician_cancellation_policy.sql`
  (نسخة `hgotr7`) اتشالت، و`0069_order_team_productivity.sql`/`0070_assistant_pool_matching.sql` (لسه
  بندين حقيقيين جداد، مش تكرار) اتعاد ترقيمهم لـ`0074`/`0075` (`main` كان وصل لـ`0073`). كود
  `technicianCancel()`/`requestRematch()` في `orders.service.ts` اتنضّف بالكامل من الازدواجية (كان فيه
  method مكرر بنفس الاسم نتيجة تداخل الـdiff). إنتاجية الفريق/مضاعف مستوى الفني/مطابقة المساعد التلقائية
  (البنود التلاتة التانية) **مفيهاش أي تعارض حقيقي مع `main`** — كانت أعمدة/جداول/موديولات جديدة تمامًا،
  اندمجت نظيفة، بس محتاجة renumbering للـmigrations زي ما اتوضّح فوق. الفحوصات الثلاثة (`tsc`/`nest
  build`/`jest`) في `apps/api` + `tsc` في `apps/admin` اتعملها إعادة تشغيل كاملة بعد الدمج وعدّت نضيف.

- **2026-08-13 (بند 36 — المفضّلة، خلص، فرع `v13gb2`)**: كانت مؤجّلة عمدًا كـ`backlog` منفصل
  ("مش موجودة خالص"). موديول `favorites` جديد كامل: `customer_favorite_technicians`
  (migration `0078`، جدول عضوية بسيط — مفيش `deleted_at` عمدًا، حذف الصف = إلغاء تفضيل حقيقي)
  + `GET/POST/DELETE /me/favorites/technicians[...]` + واجهة `apps/customer-app` (شاشة
  `FavoritesScreen` جديدة + أيقونة قلب في `AppBar` بتاع `TechnicianProfileScreen` + دخول من
  `AccountScreen`). **بَقّة حقيقية اتلقطت واتصلحت أثناء البناء**: استخدمت `204 No Content`
  الأول للـ`POST`/`DELETE` — Flutter's `apiRequest()` بيعمل `jsonDecode()` بلا شرط على أي رد،
  فجسم فاضي كان هيكسر الاستدعاء الفعلي بـ`FormatException` (مكانش فيه أي endpoint تاني في
  المشروع بيستخدم `204` فمكانتش الفجوة دي ظاهرة قبل كده). اتصلحت برجوع `{is_favorited: boolean}`
  بـ`200`/`201` عادي بدل `204` — نفس نمط كل endpoint تاني في المشروع، وبيوفّر تأكيد فوري
  للواجهة كمان. اتعمله اختبار حي كامل عبر curl (عميل حقيقي جديد + فني معتمد حقيقي موجود):
  status قبل/بعد التفضيل، القايمة، idempotency للتفضيل المكرر وإلغاء التفضيل، ورفض `404
  VAL_001` لفني مش موجود — كل الحالات طابقت المتوقع بالحرف. الفحوصات الأربعة (`tsc`/`nest
  build`/`jest` في `apps/api`، `tsc` في `apps/admin`، `flutter analyze` في `apps/customer-app`)
  عدّت كلها. تفاصيل كاملة في `apps/api/src/modules/favorites/README.md`.

- **2026-08-13 (بند 40 — طلب مراجعة Google، خلص، فرع `v13gb2`)**: كان مؤجّل عمدًا كـ`backlog`
  منفصل. إعدادين جداد (`migration 0079`، `group_name='reviews'`): رابط مراجعة Google (فاضي
  افتراضيًا = الاقتراح متوقف) + حد أدنى تقييم للاقتراح (افتراضي 4/5). `RatingsService
  .getGoogleReviewPrompt()` بيحسب القرار سيرفر-سايد بالكامل، `POST /orders/:id/rate` بيرجّعه
  في الرد. `apps/customer-app`: دايالوج تأكيد بعد تقييم عالي، فتح الرابط **خارج التطبيق**
  (`url_launcher`، مش WebView — مراجعة Google لازم حساب Google حقيقي). اتعمله اختبار حي كامل
  عبر curl بـ3 عملاء وطلبات حقيقية مختلفة: من غير رابط متحط، بعد ما اتحط (`should_prompt:true`
  + نفس الرابط بالحرف)، وتقييم تحت العتبة (`should_prompt:false` رغم وجود الرابط) — كل الحالات
  طابقت المتوقع. الفحوصات الأربعة عدّت كلها. تفاصيل كاملة في `apps/api/src/modules/ratings/README.md`.

- **2026-08-13 (بند 37 — تفضيلات إشعارات المستخدم بالقناة، خلص، فرع `v13gb2`)**: كانت مؤجّلة
  عمدًا كـ`backlog` منفصل. `user_notification_preferences` (`migration 0080`، مستوى القناة بس:
  push/sms/whatsapp/email — `in_app` مستثناة عمدًا، غياب الصف = مفعّل افتراضيًا) +
  `GET/PATCH /me/notification-preferences[...]`. الفرض الفعلي في `NotificationsService.notify()`:
  لو القناة معطّلة، الصف بيتسجّل `failed` بسبب واضح فورًا **من غير** أي نداء حقيقي للـdispatcher.
  اتعمله اختبار حي عبر curl + سكريبت `NestFactory.createApplicationContext` مباشر بيثبت الفرق
  بوضوح: نداء لقناة معطّلة يترفض فورًا بسبب "عطّل القناة"، نفس النداء بعد التفعيل يوصل فعليًا
  للـdispatcher (بيترفض بسبب مختلف تمامًا — مفيش جهاز مسجّل — يعني وصل صح). `apps/customer-app`:
  `NotificationPreferencesScreen` جديدة، مدخل من `NotificationsScreen`. `apps/technician-app`
  لسه من غيرها عمدًا (نفس الـendpoints جاهزة). تفاصيل كاملة في
  `apps/api/src/modules/notifications/README.md`.
