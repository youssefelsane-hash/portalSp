# Script 2 — Security, Realtime, Durable Events, Storage & Release Hardening

هذا الملف سجل checkpoints للـScript 2 فقط. الأساس هو Script 1 SHA `6ebbe88`، والعمل بدأ على
`codex/script-2-security-release-hardening` (Phase A/B مذكورين تحت)، اتدمج في `main` عبر PR #122،
واستُكمل بعدها على `claude/home-services-app-plan-v13gb2` (Phase C/D review + Part F/G).

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

**الحالة الحقيقية دلوقتي (Part-by-part)**: A ✅ B ✅ C ✅ (مراجَعة) D ✅ (مراجَعة) E ✅ (#26/#27، الباقي
#28-30 مراجَعة سريعة: delivery states موجودة، dedup غير مؤكدة صراحة لكل مسار) F ✅ G ✅ (#34-36،
باقي #37-39/41 لسه محتاجين مراجعة صريحة لكل الخمس مسارات) H ✅ (#43، #42/44/45 موجودين من قبل) I
✅ (#46-48) J ✅ (#50، #49/51-53 مراجَعة وموجودة من قبل) L ✅ (مراجَعة، موجودة من قبل) M جزئي
(#66 مراجَعة، #63/64/65/67 محتاجين مرور صريح). **K (#54-58، تفعيل الإنتاج الفعلي) وN (مصفوفة أمان
كاملة) وO (أداء) وP (المراجعة الذاتية النهائية الكاملة) لسه محتاجين مرور صريح — الجزء الأكبر من K
مغطّى فعليًا بجلسة تفعيل بيانات اعتماد خارجية منفصلة (Firebase/R2/Twilio/SMTP اتأكدوا حيًا،
Paymob/Fawry موثّقين كمؤجّلين صراحة)، لكن مفيش checklist صريح اتعمل هنا بالحرف زي الموثّق في
Part K.**

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

## Remaining phases

Durable outbox and workers, notifications/support concurrency, storage, pricing/provider/config/web
release hardening, security matrix, and performance gates remain in progress.
