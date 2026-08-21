# modules/domestic-workers

قطاع الخدمات المنزلية (docs/08 §12، `docs/adr/0004-domestic-workers-vertical.md`) — شغالة تنظيف بالساعة، Baby sitter بالساعة، مقيمة بالشهور. **كيان مستقل بالكامل عن `technicians`/`orders`/`matching`** — القرار الكامل وأسبابه في الـ ADR، أهمها: `UserType.DOMESTIC_WORKER` قيمة enum جديدة (مش `technician` ولا `partner` الموجودة أصلاً لـ`laundry_partners`)، جداول جديدة تمامًا (`domestic_worker_profiles`, `domestic_worker_bookings`، migration `0066`)، ودفع حقيقي عبر `WalletsService.doubleEntry` الموجودة (مش نظام دفع مواز).

## التسجيل والبروفايل

- التسجيل عبر `POST /auth/register` العادي بـ`user_type=domestic_worker` — بروفايل فاضي (`specialties=[]`) بيتعمل تلقائيًا (`DomesticWorkerProfileListener`، نفس نمط `TechnicianProfileListener` بالحرف) بكود `DW-2026-000001` (نفس `next_human_readable_number` المستخدمة في `ORD`/`EMP`/`BLD`).
- `PATCH /domestic-worker/profile` — بيو/سنين خبرة/تخصصات (`cleaning_hourly`/`babysitting_hourly`/`live_in_maid_monthly`، array من enum ثابت)/أسعار. **فحص صريح**: تخصص بالساعة لازم معاه `hourly_rate_cents`، تخصص شهري لازم معاه `monthly_rate_cents` — وإلا `400` واضح.
- `POST /domestic-worker/request-review` → `GET/POST /admin/domestic-workers[/:id/review]` (نفس صلاحية `technicians.review_documents` — نفس نوع القرار approve/reject بالظبط، مش صلاحية جديدة).
- `GET /domestic-workers?specialty=&latitude=&longitude=` (عام للعميل) — معتمدين ومتاحين بس، ترتيب بالتقييم ثم القرب (`ST_Distance` حقيقي، نفس فلسفة اختيار الفني §3).

## الحجوزات (`domestic_worker_bookings`)

نوعين جوهريًا مختلفين، مش `orders`:

- **بالساعة** (`hourly`): تاريخ+وقت+عدد ساعات، السعر = `hourly_rate_cents × duration_hours`.
- **شهري مقيم** (`monthly_live_in`): تاريخ بدء + `auto_renew`، السعر = `monthly_rate_cents` ثابت لكل شهر.

**دورة الحياة**: `pending_confirmation` → (الشغالة بتأكّد، `POST /domestic-worker/bookings/:id/confirm`) → **تحصيل فوري حقيقي** من محفظة العميل لمحفظة المنصة فقط → `confirmed` (بالساعة) أو `active` (شهري، مع `current_period_end_at = +شهر`). نصيب الشغالة بعد عمولة `commission.domestic_worker_percentage` يدخل طابور اعتماد، ولا يصبح رصيدًا قابلًا للصرف إلا بقرار أدمن. بالساعة: `POST /domestic-worker/bookings/:id/complete` يسجل الاستحقاق بعد اكتمال الزيارة. شهري: كل فترة محصلة لها استحقاق `pending` مستقل.

- **بَقّة حقيقية اتلقطت واتصلحت وقت الاختبار الحي**: تحويل أرباح الشغالة (منصة→شغالة) كان بيترفض بـ`PAY_002` "رصيد غير كافٍ" لأن محفظة المنصة نفسها كانت برصيد سالب (طبيعي في بيئة اختبار فيها قيود يدوية كتير) — نفس السبب بالظبط اللي `payments.service.ts`'s `settleAndComplete` بيحله بـ`allowNegativeBalance:true` ("محفظة المنصة تمثيل محاسبي، مش رصيد حقيقي محدود"). اتصلحت بإضافة نفس الـ flag هنا.
- **التجديد الشهري التلقائي عبر فحص دوري (`setInterval` كل دقيقة)، مش BullMQ**: كل نسخة API قد ترى نفس الحجز المستحق، لكن `tryRenew()` تقفل صف الحجز وتعيد فحص `current_period_end_at` داخل transaction واحدة تجمع التحصيل، استحقاق الفترة، وتحريك مؤشر الفترة. النسخة الخاسرة ترى المؤشر الجديد وتخرج بلا أثر. فشل العملية يرجعها كلها؛ خطأ DB عابر يظل مستحقًا للدورة التالية، بينما فشل أعمال نهائي مثل الرصيد غير الكافي يوقف `auto_renew`. لا توجد نافذة crash بين التحصيل وتحريك الفترة.
- **الإلغاء**: `POST /domestic-worker-bookings/:id/cancel` (العميل) — يقفل الحجز ثم كل استحقاقاته `pending` بنفس ترتيب قفل مسار اعتماد الأدمن، ويحوّلها إلى `invalidated` داخل transaction الإلغاء نفسها. صفحة أدمن قديمة لا تقدر تعتمدها بعد ذلك. **مفيش استرداد جزئي تلقائي في v1** لو الحجز اتأكد بالفعل (الفلوس اللي اتحصّلت وقت `confirm()` بتفضل عند محفظة المنصة) — سياسة الاسترداد قرار مستقل، والمسار الإداري المتاح فعليًا هو `PATCH /admin/wallets/:userId/adjust` (`wallets.adjust`) بمبلغ/سبب يدوي، **مش** `refunds.issue`: الأخيرة بتدوّر على `Order`/`Payment` بمعرّف `orderId`، وحجوزات العمالة المنزلية مالهاش صف `Order` خالص (تحصيل `confirm()` قيد محفظة مباشر — `WalletTxType.ADJUSTMENT` — بلا `Payment` row)، فمحاولة استخدام `refunds.issue` بـ`booking_id` هتترفض `404 الطلب غير موجود` دايمًا. **بَقّة توثيق حقيقية اتلقطت وقت تدقيق Script 7 Phase 18**: التوثيق القديم هنا كان بيحيل غلط لـ`refunds.issue` كأنه المسار الجاهز — ده كان ممكن يوقّع أي أدمن/دعم فني يحاول يسترد فلوس عميل حقيقي في مسار ميّت 404، مع إن الأداة الصح (`wallets.adjust`) موجودة ومختبرة أصلاً.

## نطاق متعمّد برّه v1 (موثّق صراحة في ADR-0004)

- **التقييمات** — `average_rating`/`total_ratings_count` موجودين على `domestic_worker_profiles` كأعمدة جاهزة، بس مفيش endpoint تقييم مربوط بيهم لسه. `ratings.order_id` `NOT NULL UNIQUE` مربوطة بـ`orders` تحديدًا — تعديلها قرار مؤجل عمداً لمرحلة تانية (نفس فلسفة عدم لمس جدول مالي/تقييمي أساسي تحت ضغط وقت).
- **تكامل كاميرات المراقبة** — المصدر الأصلي نفسه بيقول "مش لازم تظهر في الواجهة"، ومفيش مزوّد محدد. صفر تكامل.
- **مطابقة تلقائية (auto-match)** — العميل بيتصفّح ويختار بنفسه، زي §3، مش خوارزمية اختيار.

## اتعمله اختبار حي كامل

شغالة حقيقية اتسجّلت (`user_type=domestic_worker`) → بروفايل فاضي اتعمل تلقائيًا (`DW-2026-000001`) → كمّلت بروفايلها (تخصصين، أسعار) → طلبت مراجعة → أدمن وافق. عميل تصفّح ولقاها مرتّبة بالتقييم/القرب صح (`distance_km` حقيقي محسوب). حجز بالساعة (3 ساعات × 150 جنيه) → تأكيد الشغالة → **بَقّة اتلقطت واتصلحت** → تأكيد نجح، محفظة العميل اتخصم 450 جنيه بالظبط (`محفظة الشغالة تفضل صفر لحد الاكتمال + موافقة أدمن — راجع §25.1 تحت، ده تغيير عن السلوك القديم**) → إكمال الزيارة → `completed_bookings_count` بقى 1. حجز شهري مقيم (8000 جنيه) → تأكيد → تحصيل الشهر الأول → **الفحص الدوري جدّد تلقائيًا** بعد ما `current_period_end_at` استحق (تحصيل تاني 8000 جنيه، مدّ الفترة شهر بالظبط) → لما الرصيد بقى مش كافي للتجديد التالي، `auto_renew` اتوقف تلقائيًا والحجز اتقفل `completed` (مفيش فترة معلّقة). إلغاء حجز `pending_confirmation` نجح من غير تحصيل. تخصص غلط اترفض `400` بوضوح.

## §25.1 — أرباح الشغالة بقت pending لحد موافقة أدمن (قرار مالك صريح 2026-08-15)

**كانت بَقّة مالية حقيقية**: `confirm()` كانت بتحوّل نصيب الشغالة من السعر لمحفظتها `balanceCents`
القابل للصرف فورًا **وقت تأكيد الحجز** (الشغالة بتقبل)، مش بعد ما تخلّص الشغل فعليًا. المالك طلب
صراحة منع ده: أرباح الشغالة/العامل مينفعش تتحول تلقائي لرصيد قابل للصرف بمجرد قبول الحجز ولا قبل
تنفيذ الخدمة — بعد الاكتمال تدخل "pending"، ومتترجعش رصيد فعلي إلا بموافقة أدمن/موظف مخوّل.

**التنفيذ**:
- `confirm()` بقت بتحصّل العميل بس (`chargeCustomer()`) — صفر تحويل للشغالة. بالساعة، لسه معندهاش
  أي استحقاق حتى pending في اللحظة دي.
- `completeHourly()` (اكتمال الزيارة الفعلي) بقى هو نقطة دخول الاستحقاق للطابور — صف جديد في
  `domestic_worker_earning_approvals` بحالة `pending`، جوّه نفس transaction تحديث حالة الحجز.
- شهري (live-in): مفيش إشارة "الشهر اتخدم" منفصلة عن التجديد في النظام الحالي (قيد موثّق صراحة،
  مش مُخترع) — الاستحقاق بيدخل الطابور عند نفس نقطة تحصيل العميل (تأكيد أول شهر + كل تجديد
  `tryRenew()`)، بس برضه pending مش رصيد قابل للصرف مباشرة.
- **الموافقة مفروضة من الباك-إند نفسه**: `DomesticWorkerEarningApprovalsService.approve()` هو
  المكان **الوحيد** اللي بينادي `WalletsService.doubleEntry()` منصة→شغالة فعليًا — صفر مسار تاني
  (مباشر أو غير مباشر) بيقدر يحوّل صف pending لرصيد قابل للصرف. القرار يقفل الحجز أولًا ثم صف
  الاستحقاق ويعيد قراءة الحالة داخل transaction القيد المالي؛ approve×approve وapprove×reject
  لهما فائز نهائي واحد فقط.
- **صلاحية جديدة** `domestic_workers.approve_earnings` (`infra/migrations/0112`، ممنوحة لـ`finance`)
  + **`MFA_REQUIRED_PERMISSIONS`** + `@RequireStepUp()` فعلي على `POST
  /admin/domestic-workers/earning-approvals/:id/approve|reject` — نفس مستوى حساسية
  `payouts.approve`/`wallets.adjust` بالظبط.
- **أثر تدقيق**: `reviewed_by_user_id`/`reviewed_at` على الصف نفسه + `AuditLogService.record()`
  (`domestic_worker_earning.approved`/`.rejected`).
- **الرفض**: صف يتقفل `rejected` بسبب موثّق (`rejection_reason`) — الفلوس تفضل عند المنصة، مفيش
  استرداد تلقائي للعميل مُخترع هنا (قرار منفصل، عمليًا عبر `wallets.adjust` — راجع التصحيح فوق،
  `refunds.issue` مش قابل للاستخدام هنا لغياب صف `Order`).
- **شاشة تشغيل فعلية**: `/domestic-worker-earnings` ظاهرة فقط لصلاحية
  `domestic_workers.approve_earnings`، تعرض الحجز/الفترة/العامل/المبلغ والحالة والفاعل والوقت
  والسبب، وتمنع النقر المزدوج محليًا. الباك-إند يظل مصدر الحقيقة ويطلب step-up للقرار.
- **هوية المصدر**: migration `0117` تضيف `source_key` فريدًا داخل الحجز (`hourly-completion` أو
  نهاية الفترة الشهرية) وحالة `invalidated`، لمنع إنشاء نفس استحقاق الفترة مرتين.

**اتعمله اختبار حي جديد كامل**: `domestic-worker-earning-approval.spec.ts` (8 اختبارات) — تأكيد
حجز بالساعة يخصم العميل بس (صفر pending، صفر رصيد للشغالة)؛ اكتمال الزيارة يسجّل صف pending
بالمبلغ الصح (85% بعد عمولة 15%)؛ approve×approve وapprove×reject؛ رفض بلا تحويل؛ إلغاء يبطل
pending ويمنع اعتماد صفحة قديمة؛ نسختان من `sweep()` تنتجان تحصيلًا واستحقاقًا واحدًا فقط؛
وخطأ بنية عابر يرجع transaction كاملة ثم ينجح بأثر واحد في الدورة التالية.
الاختبار يعمل ضد PostgreSQL TEST مع `--detectOpenHandles` وينهي العملية طبيعيًا.

## بَقّتين حقيقيتين اتلقطوا واتصلحوا (2026-08-13)

- **`chargeCustomerAndPayWorker()` كانت بتنادي `WalletsService.doubleEntry()` مرتين منفصلتين من
  غير `manager` مشترك** (خصم العميل، بعدين إيداع الشغالة) — لو الأولى نجحت والتانية فشلت (خطأ DB
  عابر)، العميل بيتخصم منه فعليًا والشغالة ما بتاخدش فلوسها، من غير rollback. الإصلاح: الاتنين
  دلوقتي جوّه `dataSource.transaction()` واحدة (نفس نمط `PaymentsService.settleAndComplete()`) —
  فشل أي طرف بيرجع الاتنين مع بعض.
- **`addMonths()` (تجديد العقد الشهري المُقيم) كانت عندها نفس بَقّة فيضان الأيام** الموثّقة في
  `../orders/README.md` (§"الجدولة المستقبلية/المتكررة") — `setMonth` بيفيض بصمت لو اليوم مش
  موجود في الشهر الجديد. الإصلاح: نفس أسلوب `clamp` على آخر يوم فعلي في الشهر الجديد.

مرجع كامل: `../../../../docs/08-pricing-engine-and-platform-vision.md` §12 و`../../../../docs/adr/0004-domestic-workers-vertical.md`.

## فحص تعارض جدولي حقيقي — إصلاح فجوة صحة بيانات (ADR-0030)

**اكتشاف حي (Explore agent) أثناء تصميم ميزة إظهار المرشّحين المتعارضين**: صفر فحص تعارض جدولي
من أي نوع لحجز الشغالة كان موجود قبل كده — لا في المسار القديم (`DomesticWorkerBookingsService.create()`)
ولا في مسار الطلبات الموحّد الجديد (`OrdersService.create()`، ADR-0029 Slice 2a). عميلين كانوا
يقدروا يحجزوا نفس الشغالة لنفس الوقت بالظبط بلا أي رفض — بَقّة صحة بيانات حقيقية، مش مجرد فجوة UX.

- **`DomesticWorkersService.assertNoSchedulingConflict(workerId, startsAt, durationHours, opts?)`
  جديدة** — بتفحص المسارين (القديم `domestic_worker_bookings` والجديد
  `orders.domestic_worker_profile_id`) عن أي حجز/طلب نشط بيتقاطع زمنيًا. حجز `hourly` بمداه الحقيقي؛
  حجز `monthly_live_in` نشط بيُعتبر شاغل كل وقت الفني طول مدته. `durationHours=null` معناها فترة
  مفتوحة (حجز شهري جديد بيبدأ الآن).
- **مطبَّقة على المسارين** — `DomesticWorkerBookingsService.create()` (الفرعين hourly وmonthly) و
  `OrdersService.create()`'s فرع الشغالة، نفس الدالة، صفر منطق مكرر.
- **`orders.domestic_worker_duration_hours` عمود جديد** (migration 0167) — كان ناقص من Slice 2a
  (اتحسب للسعر بس واتفقد)، لازم لفحص التعارض يشتغل على المسار الجديد.
- اختبار حي جديد: `scheduling-conflict.spec.ts` (5/5).

القرار الكامل (بما فيه الشريحة الأكبر التالية — سياسة إظهار المرشّحين المتعارضين للعميل بدل
إخفائهم تمامًا) في `../../../../docs/adr/0030-schedule-conflict-visibility-policy.md`.

## هجرة للمحرك الموحّد (docs/08 §42 Phase A.4، ADR-0029) — قيد التنفيذ، صفر تغيير هنا لسه

طلب مالك (2026-08-21): المسار النهائي لحجز الشغالة يستخدم بنية Service/Order/Pricing/Payment/
Scheduling المشتركة (نفس محرك الحجز العادي)، مع الحفاظ على قدراته الخاصة. القرار الكامل والشرائح
الآمنة في `../../../../docs/adr/0029-domestic-worker-unified-booking-migration.md`. **الموديول ده
(الجدول/الـservices/الـcontrollers) صفر لمس فيه لحد كده** — Slice 1 (الوحيدة المنفّذة لحد الآن)
لمست بس `Service.pricingModel` (قيمة جديدة `worker_rate`) و`orders.domestic_worker_profile_id`
(عمود جديد، مش مقروء/مكتوب من أي كود هنا أو هناك لسه). أي حجز شغالة موجود دلوقتي يفضل يتقرا/يتعدّل
بنفس الكود هنا للأبد — قرار "migrate forward" صريح، صفر migration رجعي للبيانات التاريخية.
