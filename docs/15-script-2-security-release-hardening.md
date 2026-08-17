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

**الحالة الحقيقية دلوقتي (Part-by-part)**: A ✅ B ✅ C ✅ (مراجَعة) D ✅ (مراجَعة) F #31 ✅ G #36 ✅.
باقي Part E (إشعارات #26-30)، باقي Part G (#33-35/37-39/41 — orphan storage cleanup، E2E attachment
matrix)، Part H (pricing rounding policy تحديدًا #43، الباقي #42/44/45 مؤكدين موجودين من كود سابق)،
Part I (#46-48)، Part J (#49-53 — أغلبها مُنفَّذ من سيشن سابقة عبر `env.validation.ts`، محتاج تأكيد
صريح)، Part K-P (خارج نطاق هذه الدفعة) — **لسه محتاجين مراجعة/تنفيذ صريح، مش مفترَضين "خلصوا".**

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
