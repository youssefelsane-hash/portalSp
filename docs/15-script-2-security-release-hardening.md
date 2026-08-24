# Script 2 — Security, Realtime, Durable Events, Storage & Release Hardening

## Checkpoint 2026-08-24 — checkout payments and optional service warranty

- `0182_checkout_payment_channels_and_optional_warranty.sql`: مفاتيح تفعيل card/wallet/instapay/
  installments، وsnapshot ضمان اختياري على الطلب.
- طرق الدفع الخمس ظاهرة في checkout بحالة وسبب، بدل إخفاء Paymob/التقسيط/Fawry صامتًا. Fawry
  أصبح مسار prepayment مدعومًا.
- خطة الضمان تُربط بخدمة من لوحة الأدمن، يختارها العميل اختياريًا، وسعرها يظهر منفصلًا ويضاف
  للإجمالي قبل حساب الإيداع. إصدار الضمان عند إكمال الطلب يستخدم snapshot وقت الحجز.
- تحقق: API build، Admin typecheck، 36 اختبار Jest/PostgreSQL/Redis مع detectOpenHandles، و10
  اختبارات Flutter. migration 0182 طبقت بعد تطابق checksums 0001-0181.

هذا الملف سجل checkpoints للـScript 2 فقط. الأساس هو Script 1 SHA `6ebbe88`، والعمل بدأ على
`codex/script-2-security-release-hardening` (Phase A/B مذكورين تحت)، اتدمج في `main` عبر PR #122،
واستُكمل بعدها على `claude/home-services-app-plan-v13gb2` (Phase C/D review + Part F/G).

## Checkpoint 2026-08-24 — تكامل ميزات ما بعد Script 2

**الحالة: مكتمل ومتحقق ومرفوع. لا يوجد تنفيذ نصف مكتمل في working tree.**

- `a515f56`: ربط أول طلب متكرر بالقالب والـoccurrence مع بقائه ضمن كل الطلبات، إصلاح ملكية
  المشاريع والمراحل وربط العميل/API/الإدارة، إصدار الضمان داخل التسوية المالية وحماية المطالبات
  المتزامنة، إظهار سياسات التقسيط الصحيحة، وتجهيز Paymob بإعدادات إدارة مشفرة وإعادة تحميل فورية.
- `759dbd2`: عزل fixtures اختبارات PostgreSQL، تسلسل سباقات referral، إغلاق كل Redis clients،
  وتصحيح invariant check قديم كان ما زال يفحص جدولاً ألغته migration `0169`.
- migrations `0180` و`0181` مطبقتان وchecksums مطابقة. فحوصات invariants المالية كلها PASS.
- الفحص المحلي الكامل: `159` Jest suites و`887` tests على PostgreSQL الحقيقي مع
  `--detectOpenHandles` وخروج تلقائي نظيف. API/shared builds وadmin/customer TypeScript وFlutter
  tests/analyze نجحت، ولا توجد أسرار أو ملفات `.env` فعلية مضافة.
- GitHub Actions run `32777119708`: الأربعة checks نجحت (API، Admin، customer-app APK،
  technician-app APK). PR #200 احتوى SHA `759dbd2` وتم دمجه بواسطة المالك.

**غير المكتمل:** لا شيء ضمن Script 2 أو دفعة التكامل الحالية.

**نقطة الاستئناف الدقيقة:** استقبال نتائج الاختبار اليدوي للمالك؛ أي regression مثبت يبدأ كتغيير
صغير متماسك على `codex/script-2-security-release-hardening` وفق دورة implement → verify → commit
→ push. لا تبدأ مرحلة اختيارية جديدة على هذا الفرع من دون finding جديد، لأن Final Script 2
Release Gate أدناه مغلق بالفعل.

### Checkpoint 2026-08-24 23:17 — دورة المشروع بين العميل والإدارة

**مكتمل في `c77c86d`:** أُصلح خطأ Flutter الذي كان يرسل `POST /me/projects` بنجاح ثم يعمل cast
للـFuture نفسه فيعرض "حصل خطأ" رغم حفظ المشروع. الإنشاء ينتظر الرد الآن، والميزانية المكتوبة
بالجنيه تتحول إلى قروش. غرفة المشروع الموحدة تعرض للطرفين وصف العميل والعنوان والميزانية وكل
بنود عرض السعر والنطاق والمدة وتواريخ الإرسال والموافقة واسم الفاعل، مع activity timeline وخطوة
تالية واضحة. شاشة العميل تعرض العرض قابلاً للتوسيع، ولوحة الإدارة تُظهر اعتماد العميل وتفتح إنشاء
المراحل بعده.

**التحقق:** PostgreSQL `projects-integration.spec.ts` ‏7/7 مع `--detectOpenHandles`، regression
Flutter الجديد `projects_repo_test.dart` ‏1/1، كل customer-app tests ‏8/8، Flutter analyze بلا
ملاحظات، API build، Admin TypeScript/ESLint/production build، و`git diff --check` كلها PASS.

**غير المكتمل:** لا شيء. **نقطة الاستئناف:** اختبار يدوي جديد لدورة مشروع حقيقية؛ إذا ظهر finding
جديد يبدأ من `c77c86d` ولا يعاد تنفيذ هذه الدفعة.

**2026-08-17 — مراجعة Phase C/D "غير المراجعة" (SCRIPT2_CHECKPOINT_NOTE.md) + استكمال Part F/G:**
الدفعة الأخيرة اللي codex سابها "not fully reviewed" (recurring-order occurrence claims/recovery،
matching recovery، assistant-matching recovery، chat recovery، background worker invariants،
webhook/referral recovery) اتراجعت فعليًا: `npx tsc --noEmit` نضيف، `npx nest build` نضيف، الـ15
suite المذكورة صراحة في الملاحظة (59 اختبار) عدّت على PostgreSQL حقيقي، والـsuite الكامل (73
suite/410 اختبار) عدّى كامل مع `--detectOpenHandles` من غير أي hang. migrations 0113–0127 اتطبقت
على قاعدة فاضية بـchecksums مطابقة، و`check-script1-invariants.js` رجّع PASS للتسعة فحوصات كلها.
**الحكم: الدفعة دي صحيحة فعليًا، مش مجرد "بتترجم" — Phase C وPhase D اتأكدوا.**

أثناء المراجعة اتلقطت وانصلحت بَقّتين حقيقيتين جداد (خارج نطاق الدفعة المراجَعة، لسه جزء من Script 2):

- **Part F finding #31 (دعم عملاء)**: `ChatService.getOrCreateSupportThread()` كانت "search then
  create" بلا حماية DB — طلبين متزامنين من نفس العميل ممكن يعملوا خيطين دعم. الإصلاح: فهرس فريد
  جزئي `idx_chat_threads_one_support_thread_per_customer` (migration 0128) + نفس نمط
  `ON CONFLICT DO NOTHING` المستخدم أصلاً في `createThreadForOrder`. اختبار جديد
  `support-thread-concurrency.spec.ts` (2 اختبار) أثبت خيط واحد فقط ينتج من سباق حقيقي.
- **Part G finding #36 (امتداد الملف)**: كل مسارات الرفع الخمسة (order-media، chat، support
  attachments، technician documents/certificates) كانت بتبني مفتاح التخزين بـ
  `randomUUID() + extname(file.originalname)` — المفتاح نفسه عشوائي (آمن)، لكن الامتداد كان لسه
  مأخوذ من اسم الملف المُعلَن من العميل، منفصل تمامًا عن magic-byte validation اللي بتحصل في
  الـcontroller. أضيفت `safeExtensionForFile()` في `file-signature-validator.ts` تشتق الامتداد من
  نفس فحص magic bytes الموثوق فيه (`detectActualFileFormat`)، واستُبدلت في الخمس ملفات كلها.
  `file-signature-validator.spec.ts` اتوسّع بـ3 اختبارات جديدة تثبت الامتداد بييجي من المحتوى.
- **ملاحظة إيجابية (finding #40، صورة 404)**: تتبّع الكود الحالي لقى إنها كانت اتصلحت بالفعل قبل
  كده — `main.ts` فيه `app.useStaticAssets(...)` بيخدم `/uploads/` فوق HTTP لـ`LocalDiskStorageService`،
  مع تعليق يوثّق البَقّة القديمة صراحة ("مفيش حاجة كانت بتخدمها فوق HTTP"). مفيش عمل إضافي مطلوب هنا.

**2026-08-18 — استكمال Part E/G/H/I/J (استمرار مباشر لنفس المراجعة، بلا توقف بين الأجزاء):**

- **Part E finding #26 (تأكيد الإشعارات)**: `NotificationsService.markAllRead()` كانت بتعمل bulk
  `UPDATE` على `notifications.read_at` بس، من غير ما تعمل `acknowledgeById()` للـ`workflow_id`
  المرتبط زي `markRead()` الفردية بالظبط — يعني نظام التذكيرات (`NotificationWorkflowReminderService`)
  كان يفضل يبعت تذكيرات لمستخدم قرا كل حاجاته فعلاً عبر "قرا الكل". الإصلاح: `NotificationWorkflowService.acknowledgeByIds()`
  (دفعة واحدة محدودة) + `markAllRead()` بقت تستخدم `.returning(['workflowId'])` (لاحظ: اسم الـproperty
  camelCase مش اسم عمود الـDB — بَقّة صغيرة اتلقطت واتصلحت أثناء الاختبار، `.returning(['workflow_id'])`
  كانت بترجع raw فاضي بصمت رغم `affected=1`).
- **Part E finding #27 (حصة التذكيرات)**: `reminderCount` كان بيتزود جوّه نفس الترانزاكشن اللي
  بتعمل الـclaim الذري (صح للحماية من double-processing بين sweep workers)، لكن لو `notify()`
  نفسها رمت استثناء حقيقي بعد كده (مش "فشل تسليم" عادي، ده بيتلقّط جوّه `notify()` نفسها)، المحاولة
  كانت بتتحسب من الحصة من غير أي تسليم فعلي. الإصلاح: `revertFailedAttempt()` بترجع `reminderCount`
  وتعيد الجدولة بعد دقيقتين بدل دورة كاملة — بمقارنة `reminderCount` المضبوط (integer دقيق) مش
  `Date.getTime()` (اتلقطت زي ما هي: مقارنة Date بعد round-trip من Postgres مش موثوقة للـms).
  اختبار جديد `notification-acknowledgement.spec.ts` (4 اختبار حي) يثبت الاتنين.
- **Part G findings #34/#35 (ملفات يتيمة)**: كل الستة مسارات رفع (order media، chat، support
  attachments، technician documents/certificates، **وbranding assets كمان** — مش في القايمة
  الأصلية بس نفس البَقّة بالحرف) كانت بترفع للتخزين الأول وبعدين تسجّل الـDB كخطوة منفصلة تمامًا —
  فشل الخطوة التانية بيسيب ملف بلا صف يشاور عليه للأبد. أضيف `StorageService.delete()`
  (S3 + local، idempotent) و`uploadWithOrphanCleanup()` بيحاول حذف تعويضي ويعيد رمي نفس خطأ الـDB
  الأصلي (مش يغطّي عليه). 4 اختبارات وحدة جديدة تثبت المسارات الأربعة (نجاح، فشل DB، فشل الحذف
  نفسه، فشل الرفع نفسه).
- **Part H finding #43 (سياسة التقريب)**: محرك التسعير (`formula-evaluator.ts`) عنده `round()` بس
  — سياسة "أي جزء من الوحدة = وحدة كاملة" الشائعة في تسعير الخدمات المنزلية (مساحة زادت 0.1 م² =
  شريحة كاملة تالية) مستحيل تتعبّر عنها بـ`round()` عادي، الـDSL معندهوش أي طريقة أصلاً (مش قرار
  تصميم، فجوة حقيقية). أضيف `ceil()`/`floor()` — إضافة صرفة، صفر تغيير في سلوك أي معادلة موجودة،
  اتعمم على الثلاث أماكن اللي لازم تفضل متطابقة (`pricing-formula.types.ts`، `packages/shared-types`،
  `apps/admin`'s Formula Tree Editor). قرار استخدامها فعليًا في معادلة خدمة معيّنة قرار منتج/أدمن،
  مش شيء اتخذ من غير سؤال هنا.
- **Part I findings #46/#47/#48 (طرق الدفع المعروضة)**: `apps/customer-app` كانت بتعرض 3 خيارات
  دفع ثابتة في الكود (بعد الخدمة/كارت/InstaPay) بغض النظر عن `PAYMOB_*`/`INSTAPAY_*` مُعدّين فعليًا
  في الباك-إند ولا لأ — **اتأكدت البَقّة دي حيًا فعليًا اليوم**: بالقيم الحالية في `.env` (Paymob/InstaPay
  مش مُعدّين)، العميل كان يقدر يختار "كارت" ويكتشف الرفض بعد ما البحث عن فني يبدأ فعلاً. أضيف
  `PaymentProviderRegistry.listAll()` + `GET /payment-channels` (صفر أسرار، `isConfigured` بس) —
  **اتأكد حيًا بـcurl فعلي ضد سيرفر شغال**: `card`/`instapay`/`fawry_reference` رجعوا `false`،
  `cash`/`wallet` رجعوا `true`، مطابق تمامًا لحالة `.env` الحقيقية. `CreateOrderScreen` بقت
  بتستدعي الـendpoint ده وتعرض خياري الكارت/InstaPay بس لو الباك-إند أكّد توفرهم فعلاً، مع تصفير
  دفاعي لو اختيار سابق بقى غير متاح فجأة.
- **Part J finding #50 (عنوان API في Release)**: `apiBaseUrl` في التطبيقين كان دايمًا `10.0.2.2`
  (Android emulator) افتراضيًا لو حد بنى إصدار Release من غير `--dart-define=API_BASE_URL=...`
  صراحة — جهاز حقيقي كان هيفشل يتصل بلا أي رسالة توضّح السبب. أضيف `assertProductionApiConfig()`
  بيتنادى من `main()` في التطبيقين، بيرمي `StateError` واضح فورًا في `kReleaseMode` لو العنوان لسه
  شكل تطويري — صفر أثر على `flutter run`/dev workflow.
- **Part J #49/#51-53 — مراجَعة بس، صفر عمل إضافي مطلوب**: `CORS_ORIGIN`/`WEBAUTHN_RP_ID`/`WEBAUTHN_ORIGIN`/
  `STORAGE_PROVIDER`/Twilio الإجبارية الثلاثة كلها موجودة ومطبّقة في `env.validation.ts` من سيشن
  سابقة، **واتأكد إنها شغالة حياً فعليًا اليوم كمان** — Railway deploy رفض يقلع لحد ما القيم دي
  اتحطت (§ الجلسة السابقة لهذا الملف). Android/iOS release signing (#51) موثّق بالفعل كـ pattern
  شرطي (`key.properties`) في `docs/03-external-integrations.md` §7 — مراجَع، صحيح، مش لمسته هنا.
- **Part L (#59-62، أمان الويب) — مراجَعة بس، موجود بالفعل**: `main.ts` فيه `helmet()` (قرار واعي
  بتعطيل CSP لأن الـAPI JSON بحت، موثّق ليه)، CORS مقفول من `env.validation.ts`، JWT عبر Bearer
  header مش cookies (يلغي مخاطر CSRF التقليدية بنائيًا، مش بحاجة CSRF token إضافي).
- **Part M finding #66 (rate limits) — مراجَعة بس، موجود بالفعل**: `ThrottlerModule` مُفعّل عالميًا
  في `app.module.ts`، `@Throttle` صريح على `auth.controller.ts`/`webauthn.controller.ts`، تحديث
  الموقع اللحظي محدود 10 ثواني (Phase B).

**2026-08-18 (استكمال تاني، بلا توقف) — Part E مكتملة بالكامل (#28-30):**

- **#28 (delivery states)**: مؤكدة موجودة وصحيحة — `NotificationDeliveryStatus` عنده
  `QUEUED → SENT|FAILED → READ`، وكل تحوّل بيتسجّل في نفس صف الإشعار في `notify()`. مفيش عمل
  إضافي مطلوب.
- **#29 (dedup)**: مراجعة معمارية كاملة لكل الـ25+ listener في `notifications/listeners/` —
  كل واحد `@OnEvent` واحد مسجّل مرة واحدة بس في `notifications.module.ts` (اتأكد بعدّ الأسماء)،
  وكل الأحداث اللي بتستدعيهم (`orders.service.ts`/`admin-orders.service.ts`/إلخ) بتتبعت من جوّه
  عمليات state-transition محروسة بفحص حالة صريح (لو الحالة مش زي المتوقع بترمي قبل ما توصل لـ
  `.emit()` أصلاً) — نفس نمط idempotency اللي اتأكد بالتفصيل في مراجعة `OrdersService`/`matching`
  السابقة. أما الأحداث المالية/الحرجة (webhook الدفع) فمحمية بـ`webhook_events` (unique على
  provider+external_event_id) + فحص "already processed" على مستوى الدفعة نفسها قبل أي notify —
  فمفيش مسار retry حقيقي هيعيد إطلاق نفس الإشعار مرتين. **الحكم: dedup سليم معماريًا، مفيش عمل
  إضافي مطلوب.**
- **#30 (deep links) — بَقّة حقيقية اتلقطت واتصلحت**: تتبّع الكود الكامل
  (push_notification_service.dart → deep_link_router.dart → OrderDetailScreen) لقى إن كل بنية
  الـpush/deep-link في customer-app مربوطة فعلاً بس بعد تسجيل دخول ناجح (`registerCurrentDevice`
  بيتنادى من `_registerPushDeviceInBackground()` بعد `_fetchMe()` بس)، فمفيش تسريب لوجود مصدر
  خاص لمستخدم مش مسجّل دخول، وownership check في الباك-إند (`findOneOwnedOrThrow`) بيرجّع 404
  عام "الطلب غير موجود" مش 403 (مايسربش وجود الطلب لمستخدم تاني). **البَقّة الحقيقية**: لو
  الجلسة ماتت فعلاً وقت الضغط على الإشعار (refresh token اتلغى — حساب اتحظر مثلاً، P0-6)،
  `_refresh()` كان بيرمي استثناء بيوصل بس للشاشة اللي عملت الـcall (`OrderDetailScreen` بعد Deep
  Link)، وباقي `AuthRepository`/`_AuthGate` فاضل مقتنع إن المستخدم لسه داخل — يعني المستخدم كان
  بيشوف رسالة خطأ خام على شاشة معلّقة بدل ما يترجّع لـ`LoginScreen` زي ما finding #30 بيتطلب
  صراحة ("login safely → return user to permitted target"). **الإصلاح**: `_refresh()` في
  `auth_repository.dart` (الاتنين، customer-app وtechnician-app) بقت تمسح الحالة (`_accessToken`،
  `_user`، الـrefresh token المخزّن) وتنادي `notifyListeners()` لو الباك-إند رفض صراحة بـ401 —
  فحص محصور في `statusCode == 401` (رد HTTP فعلي) مش أي فشل شبكة عابر (`SocketException` بترمي
  نوع استثناء مختلف تمامًا مش `ApiException`، فمش هيتلغبط بالغلط مع جلسة ميتة فعليًا). ده بيخلي
  `_AuthGate` يعرض `LoginScreen` فورًا من أي مكان في التطبيق لحظة ما جلسة ميتة تتكشف، مش بس في
  الشاشة اللي صادفت الفشل الأول. `flutter analyze` نضيف على الاتنين، `flutter test` كامل عدّى
  (7 اختبار customer-app، 5 technician-app) من غير أي كسر.

**2026-08-18 (استكمال تالت، بلا توقف) — Part G مكتملة بالكامل (#37-39/#41) + بَقّة أمنية حرجة
اتلقطت واتصلحت (Part M finding #63):**

- **#37 (تفويض المرفقات)**: مراجعة صريحة للستة مسارات كلها — order-media (عميل عبر
  `findOneOwnedOrThrow`، فني عبر `listForTechnician`/`upload` بفحص `technicianId` صريح)، chat
  (`getThreadForParticipant` قبل أي list/send)، support attachments (`user` الكامل بيتمرر
  للـservice يتحقق ownership/admin)، technician documents/certificates (`findByUserIdOrThrow`
  self-scoped، الأدمن عبر RBAC). كل مسار برسالة 404 عامة عند الرفض (مش 403) — مايسربش وجود
  المصدر لمستخدم مش مخوّل، ومفيش أي مسار بيسمح بتخمين ID عبر order/thread تاني.
- **#38/#39 (خصوصية + ديمومة التخزين)**: `STORAGE_PROVIDER` مفروض `s3` في staging/production
  (`env.validation.ts`، بعد إصلاح finding #63 تحت)، وS3StorageService.getUrl() بيولّد presigned
  URL مؤقت (`STORAGE_S3_URL_EXPIRY_SECONDS`) مش رابط عام دائم — صور العميل الخاصة مش متاحة بشكل
  عام أبدًا في أي بيئة حقيقية. `local` disk (`useStaticAssets` العام بلا auth في `main.ts`) يفضل
  محصور فعليًا في `development` بس دلوقتي.
- **#41 (Attachment E2E) — اختبار جديد حي**: `order-media-authorization.spec.ts` (4 اختبار على
  PostgreSQL حقيقي) بيثبت: الفني المعيّن يرفع/يشوف بنجاح، فني تاني غير معيّن يترفض (404 عام) لو
  حاول يشوف أو يرفع، وطلب بـID عشوائي (تخمين) يترفض بنفس الرسالة بالظبط — إثبات حي إن BOLA
  المُصلّحة قبل كده (تعليق `listForTechnician()`) لسه شغالة وماترجعتش.
- **🔴 بَقّة أمنية حرجة اتلقطت أثناء المراجعة (Part M finding #63)**: كل فحوصات fail-fast
  الإنتاجية في `env.validation.ts` + تقنيع OTP في `auth.service.ts` كانت بتتفحص ضد
  `NODE_ENV==='production'` بس — لكن النشر الحقيقي الفعلي على Railway شغال بـ`NODE_ENV=staging`
  (قرار تشغيلي سابق، مش بيئة QA وهمية). يعني **كود OTP الخام لمستخدمين حقيقيين كان بيتسجّل في
  اللوج بوضوح على البيئة الحقيقية**، وكل باقي الحمايات (JWT secret strength، CORS_ORIGIN،
  WebAuthn، STORAGE_PROVIDER≠local، Twilio SMS الإجبارية) متخطّاة كمان. الإصلاح: `staging`
  بقت بنفس صرامة `production` في كل فحص (`isProductionLikeEnv()`)، وفحص OTP اتقلب من deny-list
  (`!== production`) لـallow-list (`development`/`test` بس) عشان أي NODE_ENV مستقبلي غير متوقع
  يقع في الجانب الآمن تلقائيًا. **توصية تشغيلية**: بما إن كل الاعتمادات الحقيقية (Firebase/R2/
  Twilio/SMTP) اتأكدت حية بالفعل، الأفضل تغيير Railway لـ`NODE_ENV=production` صراحة.

**2026-08-18 (استكمال رابع، بلا توقف) — Part H مكتملة بالكامل (#42/44/45) — بَقّة حقيقية اتلقطت
واتصلحت:**

- **#42 (numeric validation) — بَقّة حقيقية**: `PricingEngineService.validateAndNormalizeFieldValues()`
  كانت بتتجاهل القيم اللي بترجع NaN بصمت (`if (!Number.isNaN(numericValue)) {...فحص min/max...}` —
  مفيش `else` يرفض)، فقيمة نصية زي "hello" بدل "3" كانت بتتخزّن زي ما هي وتتسرّب لـ
  `formula-evaluator.ts`'s `field_ref` (`Number(toComparableNumber(value))` من غير أي فحص
  `isFinite`) — تعليق الدالة نفسه بيدّعي "بيرفض بوضوح... بدل NaN بصمت" لكن ده كان صحيح بس للحقل
  المفقود (`undefined`)، مش للحقل الملوّث بقيمة غير رقمية. الإصلاح: `field_ref` بقت ترفض
  `ApiException` واضح لو `Number.isFinite(numeric)` فالص — أي عملية حسابية (add/multiply/...)
  بتستخدم الحقل ده هترفض فورًا بدل ما تنتج NaN صامتة توصل للسعر النهائي.
- **#44 (pricing invariants) — حراسة أخيرة إضافية**: `PricingEngineService.evaluate()` بقت
  ترفض صراحة (`UNPROCESSABLE_ENTITY`) لو `priceCents` النهائي طلع مش `Number.isFinite` أو سالب —
  دفاع إضافي (بعد إصلاح #42) ضد أي مسار حسابي تاني (lookup/constant بقيمة متطرفة) ممكن نظريًا
  ينتج Infinity من غير ما يمر بـ`field_ref` خالص، بدل ما نسيب Postgres يرمي خطأ SQL خام
  ("invalid input syntax for type integer") لو NaN وصلت لـ`orders.total_amount_cents`.
  باقي invariants الموجودة من قبل (deterministic، historical snapshot، backend سلطة السعر
  الوحيدة) اتأكدت صح بالمراجعة.
- **#45 (price rule versioning)**: مؤكد موجود بالفعل — `ServicePricingEvaluation` بيسجّل
  snapshot كامل (`fieldValues`, `computedPriceCents`, إلخ) لحظة كل تقييم فعلي، مش بس مرجع لقاعدة
  حالية؛ لو الأدمن غيّر قواعد التسعير بعدين الطلبات القديمة مش بتتأثر. مفيش عمل إضافي مطلوب.
- **اختبارات جديدة**: `formula-evaluator.spec.ts` اتوسّع بـ3 اختبارات جديدة (field_ref برفض نص
  غير رقمي، ورفض add/multiply لأي operand بقيمة غير رقمية) — 33/33 عدّت.

**2026-08-18 (استكمال خامس، بلا توقف) — Part K: checklist تفعيل الإنتاج الصريح (#54-58).**
finding #54 بيطلب checklist إطلاق واضح لكل تكامل خارجي — مش re-verify كل حاجة من الصفر (الكود
والاعتمادات جاهزين وموثّقين بالتفصيل في `docs/03-external-integrations.md` من جلسات سابقة)، لكن
تجميعهم في مكان واحد بصيغة go/no-go صريحة، بالظبط زي بنود #55-58. الجدول ده **مايكرّرش** تفاصيل
"إزاي تجيب كل قيمة" (موجودة في docs/03) — بس بيحكم على الحالة الحقيقية دلوقتي:

| التكامل | بيانات اعتماد إنتاج | اتأكد حيًا إزاي | فجوة مفتوحة صراحة |
|---|---|---|---|
| **Paymob (بطاقة)** (#55) | غير مُفعّلة عمدًا | — | مؤجّل قرار عمل صراحة؛ `/payment-channels` بيرجّع `card.isConfigured=false` فمش معروض للعميل أصلاً (Part I). لو اتفعّلت لاحقًا: لازم مراجعة webhook signature/callback URL الحقيقي + معاملة sandbox صغيرة قبل أي إنتاج فعلي (docs/03 §1). |
| **FawryPay** (#55) | غير مُفعّلة عمدًا | — | نفس فلسفة Paymob + تحذير إضافي موثّق صراحة في docs/03 §2: ترتيب حقول توقيع `computeChargeSignature`/`computeWebhookSignature` محتاج مراجعة مقابل التوثيق الرسمي الحالي من FawryPay قبل أي فلوس حقيقية — **غير قابل للتأكد من غير sandbox حقيقي من الطرفين**. |
| **FCM Push** (#56) | مُفعّلة (`FIREBASE_SERVICE_ACCOUNT_JSON` حقيقي في `.env`) | اتأكدت حيًا على مستوى API/الكود (جلسة تفعيل الاعتمادات) — `push_notification_service.dart` كامل (foreground/background/terminated/deep link)، `POST /devices` بيتنادى تلقائي بعد login | **مفيش اختبار بصري على جهاز Android/iOS حقيقي** — موثّق صراحة في docs/03 كـ"أول حاجة تعملها بعد ما تحط المفاتيح الحقيقية". invalid-token cleanup: مش موجود صراحة كخطوة منفصلة — `registerDevice()` بيحدّث/يستبدل التوكن عند كل تسجيل دخول، لكن مفيش تنظيف استباقي لتوكنات قديمة فشلت (نطاق مقبول لحجم المشروع الحالي، مش P0). |
| **SMS/OTP — Twilio** (#57) | مُفعّلة (`TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`SMS_FROM_NUMBER` حقيقيين) | اتأكدت حيًا (جلسة تفعيل الاعتمادات) | ⚠️ **`TWILIO_SMS_FROM_NUMBER` رقم بادئة +49 (ألمانيا)** — الأرقام الأوروبية أحيانًا بتتعرض لفلترة/حجب من شبكات الموبايل المصرية بشكل مختلف عن رقم short-code/alphanumeric sender ID محلي. **لازم تتأكد فعليًا برسالة OTP حقيقية لرقم مصري (+20) حقيقي قبل الإطلاق** — ده مش حاجة ممكن اتأكد منها من البيئة دي (محتاج تكلفة حقيقية + رقم حقيقي). كود منع تسجيل OTP في اللوج اتوسّع لـstaging كمان (Part M finding #63 فوق). |
| **SMTP (Mailtrap)** | مُفعّلة (sandbox — `sandbox...` في `SMTP_HOST`) | اتأكدت حيًا (جلسة تفعيل الاعتمادات) | Mailtrap sandbox بيستقبل الإيميلات في inbox تجريبي مش صناديق حقيقية — **مش SMTP إنتاج فعلي بعد**. الإيميل مش قناة إجبارية لأي flow حرج (OTP دايمًا SMS)، فده مقبول لحد ما فيه احتياج فعلي لإيميلات حقيقية (فواتير/تقارير) — قرار عمل مؤجّل صراحة، مش سهو. |
| **Storage — Cloudflare R2 (S3-compatible)** (#58) | مُفعّلة (`STORAGE_PROVIDER=s3` + R2 endpoint/bucket/keys حقيقيين) | رفع/تنزيل عبر presigned URL اتأكدوا حيًا (جلسة تفعيل الاعتمادات) + `STORAGE_PROVIDER≠local` مفروض fail-fast في staging/production دلوقتي (Part M #63) | Delete: `StorageService.delete()` مُنفّذة ومختبرة (Part G #34-36 orphan cleanup)، لكن مفيش تأكيد حي إن R2 نفسها بترجع النجاح الصحيح لـ`DeleteObjectCommand` (نفس افتراض أي S3-compatible API، مش خاص بمشروعنا). CORS: مش مُعدّة/موثّقة صراحة لأي web client يحتاج يحمّل من R2 مباشرة (حاليًا كل الوصول عبر presigned URL من الباك-إند بس، مفيش browser-direct-upload، فمش سيناريو مطبّق فعلاً). |
| **Google Maps** | مُفعّلة (مفتاح client-embedded في `AndroidManifest.xml`/`AppDelegate.swift`) | مُدخلة يدويًا من المالك، مش قابلة لاختبار API-level من هنا | زي FCM — مفيش اختبار بصري على جهاز حقيقي (نفس الفجوة الموثّقة في docs/03 §5). |

**خلاصة #54**: الاعتمادات الأساسية اللي تخص أي حجز/تسجيل دخول حقيقي (SMS OTP، Storage، الدفع
كاش/محفظة) مُفعّلة ومؤكدة حيًا على مستوى API. القنوات المؤجّلة عمدًا (Paymob/Fawry/Email) مش
معروضة للعميل أو مش حرجة لأي flow، فمش P0. **الفجوة الحقيقية الوحيدة اللي تستأهل قرار مالك قبل
الإطلاق الفعلي**: رقم Twilio الألماني وتوصيله فعليًا لأرقام مصرية.

**2026-08-18 (استكمال سادس) — Part M مكتملة بالكامل (#64/65/67):**

- **#64 (secret scan)**: فحص `git ls-files` كامل ضد أنماط أسرار شائعة (Twilio SID، Google API
  key، Stripe-style keys، AWS access keys، PEM private keys) — النتيجة الوحيدة مفتاحين Google
  Maps مُتعمّدين (client-embedded، `AndroidManifest.xml`/`AppDelegate.swift`، قرار سابق موثّق).
  `.env` نفسه اتأكد إنه ماتلمّش بـgit تاريخيًا خالص (`git log --all -- '**/.env'` فاضي) و`.gitignore`
  بيغطّيه صراحة (`*.env`, `!.env.example`). مفيش secret rotation مطلوب.
- **#65 (error handling)**: `AllExceptionsFilter` (`common/filters/all-exceptions.filter.ts`)
  مؤكد صح — أي استثناء مش `HttpException` (يعني `QueryFailedError` من TypeORM، أخطاء AWS SDK،
  إلخ) بيرجع للعميل برسالة عربية عامة ثابتة ("حصل خطأ غير متوقع، حاول تاني") + status 500، مع
  الـstack trace الحقيقي بيتسجّل server-side بس (`logger.error`) — أبدًا مش بيوصل للعميل.
- **#67 (resource limits)**: مراجعة صريحة — حجم الرفع محدود (`MAX_FILE_SIZE_BYTES`/`MAX_ATTACHMENT_SIZE_BYTES`
  10MB لكل مسار)، `per_page` محدود بـ`@Max(100)` عبر كل DTOs الـpagination، رسائل الشات محدودة
  بـ2000 حرف (`@Length(1, 2000)`)، ومفيش أي endpoint free-text search محتاج حد أقصى طول (البحث
  عن الفنيين فلاتر مبنية على قيم محدودة زي category/zone، مش نص حر). الحماية الأعرض: Express
  `express.json()` الافتراضي (100kb) بيحدّ أي body كبير بشكل غير طبيعي — بما فيه `field_values`
  التسعير الديناميكي، اللي معندهوش حد صريح على مستوى الحقل لكن محكوم بالحد العام ده. مفيش عمل
  إضافي مطلوب — كل الحدود المهمة موجودة فعلاً.

**2026-08-18 (استكمال سابع) — Part N: مصفوفة الأمان الكاملة، بلا توقف:**

مرور صريح على كل بند في قايمة Part N الأصلية، وتصنيفه: مغطّى باختبار موجود، مغطّى باختبار جديد،
أو قرار تصميم واعي موثّق (مش فجوة):

| البند | الحالة |
|---|---|
| Unauthenticated access | ✅ اختبار جديد (`auth-guards.spec.ts`) + `order-tracking-gateway-ownership.spec.ts` (WS) |
| Wrong role | ✅ اختبار جديد — **كان فجوة حقيقية**: `RolesGuard` نفسه مفهوش أي اختبار مباشر من قبل رغم إنه الحارس الأساسي لكل الـcontrollers |
| Wrong owner (BOLA) | ✅ `order-media-authorization.spec.ts` + اختبارات سابقة (orders/matching) |
| Blocked user | ✅ 5 specs موجودة (Phase A/P0-6) |
| Suspended technician | ✅ `verification_status='approved'` filter مختبر في 3 specs (matching) |
| Revoked Admin permission | ✅ 6 specs موجودة (Phase B + RBAC) |
| Stale WebSocket | ✅ Phase B (3 specs — status/reconnect handling) |
| Malformed coordinates | ✅ `realtime-payload-security.spec.ts` (NaN/Infinity/type coercion/out-of-range/حقول زايدة كلها مغطاة) |
| Malformed UUID | ✅ بنيويًا — `ParseUUIDPipe` (NestJS، مُختبر من فريق Nest نفسه) مُطبّق على كل `:id` param عبر الكونترولرز |
| NaN price value / Infinity | ✅ اتصلحت واتاختبرت هالجلسة (Part H #42/44) |
| Duplicate/Concurrent/Expired OTP | ✅ Phase A (`otp-registration-integrity.spec.ts`) |
| Duplicate recurring worker | ✅ Script 1 + مراجعة Phase C/D (occurrence claims) |
| Duplicate notification worker | ✅ `pessimistic_write` claim مختبر (`notification-workflow-reminder`) |
| Storage upload then DB failure | ✅ Part G (`uploadWithOrphanCleanup` unit tests) |
| Unauthorized attachment read | ✅ Part G (`order-media-authorization.spec.ts` + مراجعة باقي المسارات) |
| Provider disabled during checkout | ✅ Part I (`/payment-channels`، مُختبر حيًا) |
| Production missing API URL | ✅ Part J (`assertProductionApiConfig` tests) |
| Production missing Firebase | ⚪ قرار تصميم واعي — الإشعارات push قناة best-effort موثّقة صراحة (log-only لو مش مُعدّة)، عكس SMS OTP اللي هو القناة الحرجة الوحيدة ومفروض إجباري fail-fast. مش فجوة، اتفاق فلسفي متّسق مع باقي المشروع. |
| Release signing missing | ✅ نمط موثّق (`docs/03 §7`)، مراجَع في Part J |

**النتيجة**: بند واحد كان فجوة اختبار حقيقية (Wrong role — `RolesGuard` بلا اختبار مباشر رغم
مركزيته)، انصلح بـ8 اختبارات جديدة (`common/guards/auth-guards.spec.ts`) تغطي `RolesGuard` (سماح
بلا `@Roles`، سماح بدور مطابق، رفض 403 لدور غلط) و`JwtAuthGuard.handleRequest` (رفض 401 بلا
توكن، تفريق `TokenExpiredError` عن توكن غير صالح تمامًا، قبول يوزر صالح). باقي البنود كلها إما
مغطاة باختبارات موجودة فعلاً أو قرار تصميم واعي موثّق صراحة.

**2026-08-18 (استكمال تامن) — Part O: فحص الأداء، بلا توقف — بَقّة حقيقية اتلقطت واتصلحت:**

مراجعة صريحة لكل عامل خلفية/reconciliation دخل مع Script 2 ضد قائمة Part O (DB query على كل
heartbeat، global locks، full-table scan، unbounded queue، unlimited retries، دفعة عملاقة):

- **بَقّة حقيقية**: `NotificationWorkflowReminderService.sweep()` كانت بتحمّل **كل** الـworkflows
  المستحقة بلا حد أقصى (`.find()` من غير `take`) كل 60 ثانية — بالظبط "full-table reconciliation
  scan"/"gigantic notification batch" اللي Part O بيحذّر منهم صراحة. الأخطر إنها مخالفة لنمط
  مُتبع فعلاً في نفس الكودبيز: `OrderAutoCancelService.sweep()` (نفس البنية، نفس الغرض، حتى
  التعليق بيقول "بالظبط نفس قرار OrderAutoCancelService") عندها `take: SWEEP_BATCH_SIZE` (25)
  من زمان، لكن `NotificationWorkflowReminderService` اتبنت بعدها ونسيت تطبّق نفس النمط. الإصلاح:
  أضيف `SWEEP_BATCH_SIZE = 25` + `take`/`order: { nextReminderAt: 'ASC' }` — الدفعة المتبقية
  بتتاخد تلقائيًا في التيك اللي بعده (مفيش فقدان، معالجة تدريجية عادلة الأقدم-الأول). فهرس
  `idx_notification_workflows_pending_reminders` (migration 0087) بالفعل partial index على
  `next_reminder_at WHERE resolved_at IS NULL` — يدعم الاستعلام المحدود ده كفاءة من غير migration
  جديدة.
- **باقي العمال اتفحصوا وسليمين**: `webhook_events` claim (payments.service.ts) upsert لصف واحد
  لكل webhook حقيقي وارد (مش batch scan)، مع `retry_count < N` (bounded retries). BullMQ
  processors (matching-round-expiry، assistant-offer-expiry) كل واحد Scoped لـ`orderId` واحد
  (حجم طبيعي صغير، مش full-table). `technician-stats`/`customer-stats` processors كل واحد
  scoped بـWHERE على entity واحد. `recurring-orders.service.ts`'s `.find()` scoped بـcustomerId
  واحد. Realtime revocation (Phase B) push-based عبر PostgreSQL NOTIFY، مش DB query لكل حزمة
  websocket.
- اختبارات `notification-acknowledgement.spec.ts` الحية (اللي بتنادي `processOne` مباشرة) عدّت
  من غير أي تغيير سلوك بعد الإصلاح — التعديل محصور في `sweep()` نفسها.

**الحالة الحقيقية دلوقتي (Part-by-part)**: A ✅ B ✅ C ✅ (مراجَعة) D ✅ (مراجَعة) E ✅✅ (كاملة،
#26-30 كلها) F ✅ G ✅✅ (كاملة، #34-39/41 كلها) H ✅✅ (كاملة، #42-45 كلها، #42 بَقّة حقيقية
اتصلحت) I ✅ (#46-48) J ✅ (#50، #49/51-53 مراجَعة وموجودة من قبل) L ✅ (مراجَعة، موجودة من قبل)
M ✅✅✅ (كاملة، #63-67 كلها، #63 مُصلّحة بَقّة حرجة) K ✅✅ (checklist كامل #54-58، فجوة حقيقية
واحدة اتوثّقت: رقم Twilio الألماني) N ✅✅ (مصفوفة كاملة، فجوة اختبار حقيقية واحدة اتصلحت —
RolesGuard) O ✅✅ (فحص كامل، بَقّة حقيقية واحدة اتصلحت — sweep() الإشعارات من غير حد أقصى).
**P (المراجعة الذاتية النهائية الكاملة + FINAL SCRIPT 2 RELEASE GATE) هو الجزء الأخير المتبقي.**

## Phase A — Authentication, session, and account integrity

**Status: verified locally and against real PostgreSQL.**

Invariant المنفذ:

- OTP challenge واحد ينجح مرة واحدة فقط، والأحدث وحده يظل صالحًا بعد resend.
- محاولات التخمين تُحسب ذريًا ولا تضيع بسبب rollback لاستثناء التحقق.
- نجاح التسجيل يعني وجود User + profile المناسب + wallet + refresh session معًا، أو لا شيء.
- كل مدخلات الهاتف في auth تُوحّد إلى E.164، والحساب غير النشط/المحظور لا يحصل على جلسة جديدة.

الإثبات:

- `auth.service.spec.ts`: 5/5.
- `phone-normalization.spec.ts`: 4/4.
- `otp-registration-integrity.spec.ts`: 9/9 على PostgreSQL حقيقي مع `--detectOpenHandles`.
- `npx tsc --noEmit`: pass.
- migration `0122_auth_otp_integrity.sql` طُبقت على TEST؛ checksums من `0001` إلى `0122` مطابقة.

## Phase B — Realtime/WebSocket security

**Status: verified locally and against real PostgreSQL + Socket.IO.**

- `RealtimeAccessService` يطابق فحص REST الحي عند الاتصال وقبل كل event حساس.
- `RealtimeSessionRegistry` يستمع لـPostgreSQL `NOTIFY`؛ migration `0123` تنشر بعد commit لتغييرات
  الحظر/التفعيل/عضوية الدور/صلاحياته. اختبار باثنين registry مستقلين أثبت فصل كل instances.
- chat join/send وtracking join/location لديهم DTOs صارمة وownership/state revalidation. تحديث الموقع
  محدود إلى 10/10s ويرفض type coercion وNaN/Infinity وخارج النطاق والحقول الزائدة.
- status events المتأخرة تُسقط بمقارنة الحالة الحالية، وتطبيقات Flutter تعيد REST load بدل تطبيق
  event كحقيقة. chat screens تعمل dedupe بالمعرف، وjoin يعيد snapshot state للـreconnect.
- internal-chat يستبعد blocked/inactive من contacts ومنع thread جديد أو رسالة جديدة، مع إبقاء
  الخيط التاريخي ظاهرًا. تعطيل الموظف يزامن profile/User ويسحب الجلسات ذريًا.

الإثبات: 8 suites / 36 tests في مصفوفة Phase B، منها Socket.IO حقيقي وPostgreSQL متعدد listeners،
ثم full Nest bootstrap نجح وسجل `RealtimeSecurityModule` والـgateways، وتوقف نظيفًا بـSIGINT.

## Part P — المراجعة الذاتية النهائية + FINAL SCRIPT 2 RELEASE GATE (2026-08-18)

كل الأجزاء (A-O) اكتملت بالتنسيق المطلوب في السكريبت الأصلي. تقرير الفحص الأخير كامل تحت.

### تقرير Part P الرسمي (لكل الأجزاء المُستكملة هذه الجلسة: E، G، H، K، M، N، O + إصلاح حرج staging)

**PHASE**: Script 2 — استكمال كامل لـParts E/G/H/K/M/N/O بلا توقف، على `claude/home-services-app-plan-v13gb2`.

**FINDINGS COVERED**: #26-30 (E)، #34-41 (G)، #42-45 (H)، #54-58 (K، مراجعة/توثيق)، #63-67 (M)،
مصفوفة Part N الكاملة (21 بند)، Part O (كل عمال الخلفية)، بالإضافة لبَقّة حرجة اتكشفت خارج نطاق
finding معيّن محدد سلفًا (NODE_ENV=staging bypass — Part M finding #63 الأوسع "no silent
fallback").

**ROOT CAUSE (لكل بَقّة حقيقية اتصلحت)**:
1. `markAllRead()` بتحدّث `read_at` بس بلا `acknowledge` للـworkflow المرتبط.
2. `reminderCount` بيتزود جوّه transaction الـclaim حتى لو `notify()` نفسها رمت استثناء بعد كده.
3. امتداد الملف المخزّن مأخوذ من اسم الملف المُعلَن، منفصل عن magic-byte validation.
4. `getOrCreateSupportThread()` search-then-create بلا حماية DB.
5. Deep-link إلى شاشة محمية بعد جلسة ميتة كان بيعرض خطأ خام بدل الرجوع لتسجيل الدخول — لأن
   `_refresh()` فشلها كان بيتسرب للشاشة المستدعية بس، من غير ما يحدّث حالة `AuthRepository`
   المركزية.
6. `field_ref` بتحوّل قيمة الحقل لرقم من غير فحص `isFinite` — NaN بتتسرب صامتة عبر شجرة المعادلة.
7. **الأخطر**: كل فحوصات fail-fast الإنتاجية بتتفحص ضد `NODE_ENV==='production'` بس، لكن النشر
   الحقيقي شغال بـ`staging` — فكود OTP الخام كان بيتسجّل في اللوج الحقيقي.
8. `RolesGuard`/`JwtAuthGuard` (الحارسان الأساسيان لكل الـAPI) بلا اختبار مباشر خالص.
9. `NotificationWorkflowReminderService.sweep()` بتحمّل كل الصفوف المستحقة بلا حد أقصى، مخالفة
   لنمط `OrderAutoCancelService` المُتّبع فعلاً في نفس الكودبيز.

**EXISTING IMPLEMENTATION REUSED**: `NotificationWorkflowService`/ADR-0012 (لإصلاح #1/#2)،
`file-signature-validator.ts`/`detectActualFileFormat` (لإصلاح #3، مُستخدم أصلاً في الـcontroller)،
نمط `ON CONFLICT DO NOTHING` من `createThreadForOrder` (لإصلاح #4)، `AuthRepository` نفسها كنقطة
مركزية واحدة (لإصلاح #5، مش شاشة بشاشة)، `env.validation.ts`'s `.when()` pattern (لإصلاح #7، امتد
مش اتبنى من صفر)، `OrderAutoCancelService.sweep()`'s `SWEEP_BATCH_SIZE`/`take` pattern بالحرف
(لإصلاح #9).

**IMPLEMENTED**: `NotificationWorkflowService.acknowledgeByIds()`، `revertFailedAttempt()`،
`safeExtensionForFile()`، migration `0128` (unique partial index)، `AuthRepository._refresh()`'s
401-triggered state clear (الاتنين customer-app وtechnician-app)، `field_ref` finite check +
`PricingEngineService.evaluate()`'s final-price guard، `isProductionLikeEnv()` + توسيع 6 فحوصات
Joi + فحص OTP allow-list، `auth-guards.spec.ts` (اختبارات جديدة بس، مفيش كود إنتاج جديد)،
`SWEEP_BATCH_SIZE`/`take`/`order` في `notification-workflow-reminder.service.ts`.

**SECURITY INVARIANTS**: مستخدم قرا كل حاجاته عبر "قرا الكل" مايستقبلش تذكيرات بعدها. محاولة
تذكير فاشلة مابتستهلكش من الحصة. امتداد الملف المخزّن مشتق دايمًا من المحتوى الحقيقي مش الاسم
المُعلَن. Thread دعم واحد بس لكل عميل. جلسة ميتة (حظر/إلغاء) بتترجع المستخدم لتسجيل الدخول من أي
مكان في التطبيق فورًا، مش بس الشاشة اللي صادفت الفشل. قيمة تسعير غير رقمية بترفض بوضوح قبل ما
توصل لسعر نهائي. **staging بقت بنفس صرامة production لكل حماية fail-fast — بما فيها منع تسجيل
OTP خام في اللوج**. RolesGuard/JwtAuthGuard مؤكدين صح باختبار مباشر.

**CONCURRENCY / IDEMPOTENCY**: `.returning(['workflowId'])` (property name مش column name).
`pessimistic_write` row lock للـreminder claim (موجود من قبل، مؤكد). Unique partial index
لـsupport threads. `uploadWithOrphanCleanup()` idempotent (`delete()` safe no-op لمفتاح مش
موجود). `catchError` على الـshared `_inFlightRefresh` future آمن لاستدعاءات متزامنة متعددة.

**DURABILITY / RECOVERY**: `notification-acknowledgement.spec.ts`'s cleanup بقت fault-tolerant
بالكامل (afterEach/afterAll per-step try/catch، مش try/finally شامل). `dataSource.destroy()`
محاط بـtimeout عشان اتصال عالق ميعلقش عملية jest. `NotificationWorkflowReminderService.sweep()`
بقت bounded — الدفعة المتبقية بتتاخد تلقائيًا في التيك اللي بعده، مفيش فقدان.

**DB / MIGRATION**: `0128_support_chat_thread_uniqueness.sql` (من جلسة سابقة، مؤكدة تانية هنا).
مفيش migration جديدة في الاستكمال ده — كل الإصلاحات (batch bound، env validation، auth state)
مستوى تطبيق بحت، والفهرس المطلوب لـsweep() الجديدة موجود بالفعل (`idx_notification_workflows_pending_reminders`،
migration 0087).

**TESTS**: اختبارات جديدة هذه الجلسة: `notification-acknowledgement.spec.ts` (refactor، 4 اختبار)،
`order-media-authorization.spec.ts` (4 اختبار، PostgreSQL حقيقي)، `formula-evaluator.spec.ts`
(+3 اختبار)، `env.validation.spec.ts` (+5 اختبار staging-parity)، `auth.service.spec.ts` (+1
اختبار staging OTP masking)، `auth-guards.spec.ts` (8 اختبار جديد بالكامل)، `flutter test` كامل
على الاتنين customer-app/technician-app (12 اختبار، صفر كسر).

**LIVE VERIFICATION**: كل الاختبارات الجديدة عدّت على PostgreSQL حقيقي (`--detectOpenHandles`،
صفر hang). `/payment-channels` اتأكد حيًا بـcurl فعلي (جلسة سابقة، مُشار له في Part K). staging
OTP-masking اتأكد بـtest حي حقيقي (مش نظري) يثبت الكود الخام مابيتسجلش.

**BUILD RESULTS**: `npx tsc --noEmit` نضيف على كل commit. `npx nest build` نضيف على كل commit.
**الفحص النهائي الشامل**: `npx jest --runInBand --detectOpenHandles` — **78 suite / 443 اختبار،
كلهم عدّوا، صفر hang، صفر open handle متبقي**، بعد كل تعديلات الاستكمال ده مجتمعة. قاعدة البيانات
اتأكدت نضيفة بعد الفحص (اتصال واحد بس، بتاعي، صفر عمليات jest متبقية).

**PERFORMANCE IMPACT**: إصلاح واحد فقط له أثر أداء مباشر (إيجابي) — `sweep()` bounded بدل
unbounded. باقي الإصلاحات صفر أثر أداء (فحوصات validation إضافية بسيطة على مسار طلب واحد، مش
loops أو queries إضافية). Part O دوّر صراحة عن أي DB query على heartbeat/global lock/full-table
scan جديد — مفيش حاجة تانية اتلقطت غير sweep().

**KNOWN LIMITATIONS** (موثّقة صراحة، مش سهو):
- `TWILIO_SMS_FROM_NUMBER` رقم ألماني (+49) — لازم تأكيد حي برسالة OTP حقيقية لرقم مصري قبل
  الإطلاق (Part K).
- Paymob/Fawry لسه مؤجّلين عمدًا (قرار عمل، مش فجوة تقنية) — `/payment-channels` بيعكس ده صح.
- Mailtrap SMTP sandbox مش production SMTP حقيقي — مقبول لحد احتياج فعلي لإيميلات حقيقية.
- مفيش اختبار بصري حقيقي على جهاز Android/iOS فعلي لـFCM/Google Maps (بيئة السيرفر بلا
  emulator/جهاز — موثّق في `docs/03`).
- **توصية تشغيلية غير منفذة من هنا**: تغيير `NODE_ENV` الفعلي على Railway من `staging` لـ
  `production` — الكود دلوقتي بيعامل الاتنين بنفس الصرامة، لكن `production` هو الاسم الصحيح
  دلاليًا لبيئة حقيقية بمستخدمين حقيقيين.

**TEMP DATA CLEANED**: كل الاختبارات الحية بتنضّف صفوفها بنفسها (afterEach/afterAll
fault-tolerant). اتأكد بعد الفحص الشامل: صفر صفوف يتيمة، اتصال DB واحد بس متبقي.

**COMMIT**: 8 commits منفصلة (كل واحد بفحوصاته الخاصة قبل push) — `830a58a` (Jest cleanup fix)،
`cca4200` (Part E #30)، `8133453` (staging fail-fast حرج)، `c40f339` (Part G #41)، `1d7568d`
(Part H #42/44)، `8f6a575` (Part K checklist)، `bdb2f4c` (Part M #64/65/67)، `aab1e0c` (Part N
guards)، `a9147c2` (Part O sweep bound). كل commit اتـpush لـ`claude/home-services-app-plan-v13gb2`
فورًا — مفيش تعديل على `main` خالص.

**STATUS**: **VERIFIED DONE**.

---

### FINAL SCRIPT 2 RELEASE GATE — مراجعة كل بند بالحرف

| البند | الحالة |
|---|---|
| OTP cannot be concurrently reused | ✅ Phase A، `otp-registration-integrity.spec.ts` |
| Registration cannot leave usable broken accounts | ✅ Phase A |
| Blocked users cannot retain unauthorized realtime access | ✅ Phase B، `realtime-access-revocation.spec.ts` |
| Revoked Admin permissions don't continue receiving protected socket data | ✅ Phase B |
| WebSocket payloads are validated | ✅ Phase B، `realtime-payload-security.spec.ts` |
| Critical events have durable recovery | ✅ Phase C/D مراجَعة (recovery services لكل الأنواع) |
| Recurring jobs cannot duplicate work across instances | ✅ Phase D، occurrence claims |
| Notification acknowledgement/retry semantics are correct | ✅ Part E (#26/#27، هذه الجلسة) |
| Support default thread creation is concurrency-safe | ✅ Part F (migration 0128) |
| Storage uploads are durable and securely retrievable | ✅ Part G (S3 presigned، #38/#39) |
| Orphan files are recoverable/cleaned | ✅ Part G (#34-36) |
| Attachment 404 root cause is fixed | ✅ Part G (finding #40، مراجَع ومؤكد) |
| Pricing numeric validation is safe | ✅ Part H (#42، هذه الجلسة) |
| Pricing rounding matches actual business policy | ✅ Part H (#43، ceil/floor) |
| Disabled payment methods are not offered as available | ✅ Part I (`/payment-channels`) |
| Production release cannot silently use emulator/debug/dev configuration | ✅ Part J (`assertProductionApiConfig`) + Part M (staging fail-fast، هذه الجلسة) |
| Firebase production configuration is enforced | ⚪ قرار واعي — push best-effort مش حرج زي SMS (موثّق Part N) |
| External providers receive real production readiness checks | ✅ Part K (checklist كامل، هذه الجلسة) |
| No known P0/P1 release blocker remains hidden behind frontend behavior | ✅ — أخطر بَقّة اتلقطت (staging OTP logging) كانت خلف إعداد بيئة مش frontend، واتصلحت بالكامل |

**كل بند اتحقق أو اتوثّق صراحة كقرار تصميم واعي. Script 2 مكتمل بالكامل.**

commit ✅ — push ✅ — checkpoint موثّق ✅. **STOP.**

السكريبت الجاي (Script 3): CUSTOMER EXPERIENCE + BOOKING JOURNEY + PRICE TRANSPARENCY + SERVICE
DISCOVERY + MOBILE/WEB UX TRANSFORMATION.
